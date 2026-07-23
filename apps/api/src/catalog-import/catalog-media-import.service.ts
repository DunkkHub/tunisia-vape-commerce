import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma, type CatalogImportBatch, type CatalogImportSource } from '@prisma/client';
import { RedisService } from '../cache/redis.service';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import { ProductMediaService } from '../product-media/product-media.service';
import type { CatalogImportActor } from './catalog-import.service';
import type { CatalogImportRowInput } from './catalog-import-contract';
import { sha256 } from './catalog-identity';
import { CatalogMediaSourceClient } from './catalog-media-source';
import { WotofoSourceClient } from './wotofo-source';

interface StoredMediaPayload {
  schemaVersion: '1.0';
  rows: Array<{
    rowNumber: number;
    input: CatalogImportRowInput | null;
  }>;
}

interface AppliedMediaRow {
  id: string;
  rowNumber: number;
  productId: string | null;
  variantId: string | null;
  productPostVersion: number | null;
  postVersion: number | null;
}

interface RollbackBaseline {
  productVersion: number;
  variantVersions: Map<string, number>;
}

interface RollbackSynchronization {
  synchronized: boolean;
  mediaReviewResolved: boolean;
}

interface MediaReceipt {
  owner: 'PRODUCT' | 'VARIANT';
  productKey: string;
  variantKey?: string;
  sourceUrl?: string;
  imageId?: string;
  code?: string;
}

export interface CatalogMediaImportReport {
  successful: MediaReceipt[];
  missing: MediaReceipt[];
  rejected: MediaReceipt[];
  duplicates: MediaReceipt[];
  productsRequiringManualReview: string[];
}

const inputJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const MEDIA_IMPORT_LOCK_TTL_MS = 10 * 60 * 1_000;
const MEDIA_IMPORT_LOCK_RENEWAL_MS = 60 * 1_000;
const MAX_MEDIA_DOWNLOADS_PER_PRODUCT = 30;
const MAX_MEDIA_DOWNLOADS_PER_BATCH = 150;
const GLOBAL_MEDIA_IMPORT_LOCK_KEY = 'catalog-media-import:global';

const auditMetadata = (actor: CatalogImportActor) => ({
  actorUserId: actor.userId,
  actorType: 'ADMIN' as const,
  outcome: 'SUCCESS' as const,
  requestId: actor.requestId,
  ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
  ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
});

const boundedMap = async <Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
): Promise<Output[]> => {
  const output = new Array<Output>(inputs.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < inputs.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await operation(inputs[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), inputs.length) }, () => worker()),
  );
  return output;
};

const safeErrorCode = (error: unknown): string => {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code.slice(0, 100);
  }
  if (error && typeof error === 'object' && 'getResponse' in error) {
    const response = (error as { getResponse: () => unknown }).getResponse();
    if (response && typeof response === 'object' && 'code' in response) {
      const code = (response as { code?: unknown }).code;
      if (typeof code === 'string') return code.slice(0, 100);
    }
  }
  return 'MEDIA_IMPORT_REJECTED';
};

@Injectable()
export class CatalogMediaImportService {
  private readonly officialSource = new WotofoSourceClient();
  private readonly operatorSource: CatalogMediaSourceClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
    private readonly media: ProductMediaService,
    private readonly redis: RedisService,
  ) {
    this.operatorSource = new CatalogMediaSourceClient(
      config.get('CATALOG_IMPORT_MEDIA_HOSTS', { infer: true }),
    );
  }

  async importBatch(batchId: string, actor: CatalogImportActor) {
    return this.executeImport(batchId, actor);
  }

  async importWotofo(batchId: string, actor: CatalogImportActor) {
    return this.executeImport(batchId, actor, 'WOTOFO_OFFICIAL');
  }

  private async executeImport(
    batchId: string,
    actor: CatalogImportActor,
    expectedSource?: CatalogImportSource,
  ) {
    const lockToken = await this.acquireLock(batchId);
    let lockFailure: Error | undefined;
    const lockGuard = async () => {
      if (lockFailure) throw lockFailure;
      try {
        await this.renewLock(batchId, lockToken);
      } catch (error) {
        lockFailure =
          error instanceof Error
            ? error
            : new ServiceUnavailableException({
                code: 'CATALOG_MEDIA_IMPORT_LOCK_UNAVAILABLE',
                message: 'The media import lock service is unavailable.',
              });
        throw lockFailure;
      }
    };
    const renewal = setInterval(() => {
      void lockGuard().catch(() => undefined);
    }, MEDIA_IMPORT_LOCK_RENEWAL_MS);
    renewal.unref();
    try {
      await lockGuard();
      return await this.runImport(batchId, actor, expectedSource, lockGuard);
    } finally {
      clearInterval(renewal);
      await this.releaseLock(batchId, lockToken);
    }
  }

  private async runImport(
    batchId: string,
    actor: CatalogImportActor,
    expectedSource: CatalogImportSource | undefined,
    lockGuard: () => Promise<void>,
  ) {
    const batch = await this.prisma.catalogImportBatch.findUnique({
      where: { id: batchId },
      include: {
        rows: {
          orderBy: { rowNumber: 'asc' },
          select: {
            id: true,
            rowNumber: true,
            productId: true,
            variantId: true,
            productPostVersion: true,
            postVersion: true,
          },
        },
      },
    });
    if (!batch || batch.dryRun) throw this.notFound();
    if (
      (expectedSource && batch.source !== expectedSource) ||
      !(['WOTOFO_OFFICIAL', 'ADMIN_UPLOAD'] as CatalogImportSource[]).includes(batch.source) ||
      (batch.status !== 'APPLIED' && batch.status !== 'APPLIED_WITH_WARNINGS')
    ) {
      throw new ConflictException({
        code: 'CATALOG_MEDIA_IMPORT_NOT_APPLICABLE',
        message: expectedSource
          ? 'This command accepts only a completed official Wotofo catalogue batch.'
          : 'Only a completed catalogue batch can import media.',
      });
    }
    const payload = this.storedPayload(batch);
    const appliedByRow = new Map(batch.rows.map((row) => [row.rowNumber, row]));
    const groups = this.groupRows(payload, appliedByRow);
    this.assertBoundedMediaWork(groups);
    const reports = await boundedMap(groups, 3, async (group) => {
      await lockGuard();
      return this.importProductGroup(group, actor, batch.source, batch.overrideImages, lockGuard);
    });
    const report: CatalogMediaImportReport = {
      successful: reports.flatMap(({ successful }) => successful),
      missing: reports.flatMap(({ missing }) => missing),
      rejected: reports.flatMap(({ rejected }) => rejected),
      duplicates: reports.flatMap(({ duplicates }) => duplicates),
      productsRequiringManualReview: reports
        .filter(({ manualReview }) => manualReview)
        .map(({ productKey }) => productKey),
    };
    const currentResult =
      batch.result && typeof batch.result === 'object' && !Array.isArray(batch.result)
        ? batch.result
        : {};
    await lockGuard();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const result = {
        ...currentResult,
        media: report,
        mediaSummary: {
          successful: report.successful.length,
          missing: report.missing.length,
          rejected: report.rejected.length,
          duplicates: report.duplicates.length,
          productsRequiringManualReview: report.productsRequiringManualReview.length,
        },
      };
      const changed = await transaction.catalogImportBatch.update({
        where: { id: batch.id },
        data: { result: inputJson(result), completedAt: new Date() },
        include: { rows: { orderBy: { rowNumber: 'asc' } } },
      });
      await transaction.auditLog.create({
        data: {
          ...auditMetadata(actor),
          action: 'catalog.import.media',
          resourceType: 'CatalogImportBatch',
          resourceId: batch.id,
          afterSummary: result.mediaSummary,
        },
      });
      return changed;
    });
    return { data: { batch: this.serializeBatch(updated), report } };
  }

  private async importProductGroup(
    group: Array<{ input: CatalogImportRowInput; applied: AppliedMediaRow }>,
    actor: CatalogImportActor,
    source: CatalogImportSource,
    overrideImages: boolean,
    lockGuard: () => Promise<void> = () => Promise.resolve(),
  ): Promise<CatalogMediaImportReport & { productKey: string; manualReview: boolean }> {
    const first = group[0]!;
    const productId = first.applied.productId;
    const productKey = first.input.productKey;
    const report: CatalogMediaImportReport & { productKey: string; manualReview: boolean } = {
      successful: [],
      missing: [],
      rejected: [],
      duplicates: [],
      productsRequiringManualReview: [],
      productKey,
      manualReview: true,
    };
    if (!productId) {
      report.missing.push({ owner: 'PRODUCT', productKey, code: 'IMPORT_PRODUCT_LINK_MISSING' });
      return report;
    }

    const baseline = await this.rollbackBaseline(productId, group);
    if (!baseline) {
      report.rejected.push({
        owner: 'PRODUCT',
        productKey,
        code: 'IMPORT_OWNER_VERSION_CHANGED',
      });
      return report;
    }
    let productVersion = baseline.productVersion;

    const productImageUrl = first.input.productImageUrl;
    if (!productImageUrl) {
      report.missing.push({ owner: 'PRODUCT', productKey, code: 'SOURCE_IMAGE_MISSING' });
    } else {
      const versions = await this.importOneImage(
        {
          owner: 'PRODUCT',
          productKey,
          productId,
          sourceUrl: productImageUrl,
          externalKey: `${productKey}:primary`,
          altTextFr: first.input.nameFr,
          altTextAr: first.input.nameAr,
          expectedOwnerVersion: productVersion,
          expectedProductVersion: productVersion,
          productCheckpointRowIds: group.map(({ applied }) => applied.id),
          source,
          overrideImages,
        },
        actor,
        report,
        lockGuard,
      );
      productVersion = versions.productVersion;
    }

    for (const row of group) {
      const sourceUrl = row.input.variantImageUrl;
      if (!sourceUrl || sourceUrl === productImageUrl) {
        if (sourceUrl && sourceUrl === productImageUrl) {
          report.duplicates.push({
            owner: 'VARIANT',
            productKey,
            variantKey: row.input.variantKey,
            sourceUrl,
            code: 'USES_PRODUCT_FALLBACK',
          });
        }
        continue;
      }
      if (!row.applied.variantId) {
        report.missing.push({
          owner: 'VARIANT',
          productKey,
          variantKey: row.input.variantKey,
          sourceUrl,
          code: 'IMPORT_VARIANT_LINK_MISSING',
        });
        continue;
      }
      const expectedOwnerVersion = baseline.variantVersions.get(row.applied.variantId);
      if (expectedOwnerVersion === undefined) {
        report.rejected.push({
          owner: 'VARIANT',
          productKey,
          variantKey: row.input.variantKey,
          sourceUrl,
          code: 'IMPORT_OWNER_VERSION_CHANGED',
        });
        continue;
      }
      const resultingOwnerVersion = await this.importOneImage(
        {
          owner: 'VARIANT',
          productKey,
          variantKey: row.input.variantKey,
          productId,
          variantId: row.applied.variantId,
          sourceUrl,
          externalKey: `${productKey}:${row.input.variantKey}`,
          altTextFr: `${first.input.nameFr} — ${row.input.variantNameFr}`,
          altTextAr: `${first.input.nameAr} — ${row.input.variantNameAr}`,
          expectedOwnerVersion,
          expectedProductVersion: productVersion,
          productCheckpointRowIds: group.map(({ applied }) => applied.id),
          variantCheckpointRowId: row.applied.id,
          source,
          overrideImages,
        },
        actor,
        report,
        lockGuard,
      );
      baseline.variantVersions.set(row.applied.variantId, resultingOwnerVersion.ownerVersion);
      productVersion = resultingOwnerVersion.productVersion;
    }

    try {
      await lockGuard();
    } catch (error) {
      report.rejected.push({
        owner: 'PRODUCT',
        productKey,
        code: safeErrorCode(error),
      });
      return report;
    }

    const verifiedProductImage =
      source === 'WOTOFO_OFFICIAL' && productImageUrl
        ? await this.prisma.catalogSourceRecord.findFirst({
            where: {
              source,
              entityType: 'IMAGE',
              externalKey: `${productKey}:primary`,
              sourceUrlHash: sha256(productImageUrl),
              image: { is: { productId, deletedAt: null, moderationStatus: 'APPROVED' } },
            },
            select: { id: true },
          })
        : null;
    const canClearMediaReview =
      Boolean(verifiedProductImage) && report.rejected.length === 0 && report.missing.length === 0;
    const synchronization = await this.synchronizeRollbackVersions(
      productId,
      group,
      productVersion,
      baseline.variantVersions,
      canClearMediaReview,
    );
    if (canClearMediaReview && synchronization.mediaReviewResolved) {
      report.manualReview = false;
    }
    if (source === 'ADMIN_UPLOAD' && synchronization.synchronized) {
      const [productReviewState, unresolvedImageCount] = await Promise.all([
        this.prisma.product.findFirst({
          where: { id: productId, deletedAt: null },
          select: { needsMediaReview: true },
        }),
        this.prisma.productImage.count({
          where: {
            deletedAt: null,
            moderationStatus: { in: ['PENDING', 'QUARANTINED'] },
            OR: [
              { productId, variantId: null },
              { productId: null, variant: { is: { productId, deletedAt: null } } },
            ],
          },
        }),
      ]);
      report.manualReview =
        productReviewState?.needsMediaReview !== false ||
        unresolvedImageCount > 0 ||
        report.missing.length > 0 ||
        report.rejected.length > 0;
    }
    if (!synchronization.synchronized) {
      report.rejected.push({
        owner: 'PRODUCT',
        productKey,
        code: 'IMPORT_OWNER_VERSION_CHANGED',
      });
    }
    return report;
  }

  private async importOneImage(
    input: {
      owner: 'PRODUCT' | 'VARIANT';
      productKey: string;
      variantKey?: string;
      productId: string;
      variantId?: string;
      sourceUrl: string;
      externalKey: string;
      altTextFr: string;
      altTextAr: string;
      expectedOwnerVersion: number;
      expectedProductVersion: number;
      productCheckpointRowIds: string[];
      variantCheckpointRowId?: string;
      source: CatalogImportSource;
      overrideImages: boolean;
    },
    actor: CatalogImportActor,
    report: CatalogMediaImportReport,
    lockGuard: () => Promise<void>,
  ): Promise<{ ownerVersion: number; productVersion: number }> {
    await lockGuard();
    const receipt = {
      owner: input.owner,
      productKey: input.productKey,
      ...(input.variantKey ? { variantKey: input.variantKey } : {}),
      sourceUrl: input.sourceUrl,
    } satisfies MediaReceipt;
    const existing = await this.prisma.catalogSourceRecord.findUnique({
      where: {
        source_entityType_externalKey: {
          source: input.source,
          entityType: 'IMAGE',
          externalKey: input.externalKey,
        },
      },
      include: { image: { select: { id: true, deletedAt: true, moderationStatus: true } } },
    });
    const unchangedSource = existing?.sourceUrlHash === sha256(input.sourceUrl);
    const activeImportedImage =
      existing?.image &&
      !existing.image.deletedAt &&
      (existing.image.moderationStatus === 'APPROVED' ||
        existing.image.moderationStatus === 'PENDING')
        ? existing.image
        : null;
    if (activeImportedImage && unchangedSource && !input.overrideImages) {
      report.duplicates.push({
        ...receipt,
        imageId: activeImportedImage.id,
        code:
          activeImportedImage.moderationStatus === 'PENDING'
            ? 'ALREADY_IMPORTED_AWAITING_REVIEW'
            : 'ALREADY_IMPORTED',
      });
      return {
        ownerVersion: input.expectedOwnerVersion,
        productVersion: input.expectedProductVersion,
      };
    }
    if (activeImportedImage && !input.overrideImages) {
      report.rejected.push({ ...receipt, code: 'SOURCE_IMAGE_CHANGED_REQUIRES_OVERRIDE' });
      return {
        ownerVersion: input.expectedOwnerVersion,
        productVersion: input.expectedProductVersion,
      };
    }

    const manuallyMaintainedImage = await this.prisma.productImage.findFirst({
      where: {
        deletedAt: null,
        ...(existing?.image?.id ? { id: { not: existing.image.id } } : {}),
        ...(input.variantId
          ? { productId: null, variantId: input.variantId }
          : { productId: input.productId, variantId: null }),
      },
      select: { id: true },
    });
    if (manuallyMaintainedImage && !input.overrideImages) {
      report.rejected.push({ ...receipt, code: 'MANUAL_IMAGE_PRESERVED' });
      return {
        ownerVersion: input.expectedOwnerVersion,
        productVersion: input.expectedProductVersion,
      };
    }

    try {
      const maximumBytes = this.config.get('UPLOAD_MAX_BYTES', { infer: true });
      const downloaded = await (
        input.source === 'WOTOFO_OFFICIAL' ? this.officialSource : this.operatorSource
      ).downloadImage(input.sourceUrl, maximumBytes);
      await lockGuard();
      const resolvedSourceUrl =
        'resolvedSourceUrl' in downloaded && typeof downloaded.resolvedSourceUrl === 'string'
          ? downloaded.resolvedSourceUrl
          : downloaded.sourceUrl;
      const existingOriginalChecksum =
        existing?.metadata &&
        typeof existing.metadata === 'object' &&
        !Array.isArray(existing.metadata) &&
        'originalChecksumSha256' in existing.metadata &&
        typeof existing.metadata.originalChecksumSha256 === 'string'
          ? existing.metadata.originalChecksumSha256
          : null;
      if (activeImportedImage && existingOriginalChecksum === downloaded.checksumSha256) {
        await this.prisma.catalogSourceRecord.update({
          where: { id: existing!.id },
          data: {
            sourceUrl: downloaded.sourceUrl,
            sourceUrlHash: sha256(downloaded.sourceUrl),
            verifiedAt: input.source === 'WOTOFO_OFFICIAL' ? new Date() : null,
            metadata: {
              originalChecksumSha256: downloaded.checksumSha256,
              ...(resolvedSourceUrl !== downloaded.sourceUrl ? { resolvedSourceUrl } : {}),
              provenance:
                input.source === 'WOTOFO_OFFICIAL'
                  ? 'OFFICIAL_SOURCE_VERIFIED'
                  : 'OPERATOR_SUPPLIED_UNVERIFIED',
            },
          },
        });
        report.duplicates.push({
          ...receipt,
          imageId: activeImportedImage.id,
          code:
            activeImportedImage.moderationStatus === 'PENDING'
              ? 'ALREADY_IMPORTED_AWAITING_REVIEW'
              : 'ALREADY_IMPORTED_CONTENT',
        });
        return {
          ownerVersion: input.expectedOwnerVersion,
          productVersion: input.expectedProductVersion,
        };
      }
      const uploaded = await this.media.uploadImported(
        input.productId,
        {
          expectedOwnerVersion: input.expectedOwnerVersion,
          ...(input.variantId ? { variantId: input.variantId } : {}),
          altTextFr: input.altTextFr.slice(0, 300),
          altTextAr: input.altTextAr.slice(0, 300),
          isPrimary: input.source === 'WOTOFO_OFFICIAL',
        },
        {
          buffer: downloaded.bytes,
          mimetype: downloaded.contentType,
          originalname: downloaded.originalFilename,
          size: downloaded.bytes.length,
        },
        {
          source: input.source,
          externalKey: input.externalKey,
          sourceUrl: downloaded.sourceUrl,
          sourceUrlHash: sha256(downloaded.sourceUrl),
          originalChecksumSha256: downloaded.checksumSha256,
          ...(resolvedSourceUrl !== downloaded.sourceUrl ? { resolvedSourceUrl } : {}),
          expectedProductVersion: input.expectedProductVersion,
          productCheckpointRowIds: input.productCheckpointRowIds,
          ...(input.variantCheckpointRowId
            ? { variantCheckpointRowId: input.variantCheckpointRowId }
            : {}),
        },
        actor,
      );
      report.successful.push({ ...receipt, imageId: uploaded.data.id });
      return {
        ownerVersion: uploaded.data.ownerVersion,
        productVersion: uploaded.productVersion,
      };
    } catch (error) {
      report.rejected.push({ ...receipt, code: safeErrorCode(error) });
      return {
        ownerVersion: input.expectedOwnerVersion,
        productVersion: input.expectedProductVersion,
      };
    }
  }

  private async rollbackBaseline(
    productId: string,
    group: Array<{ input: CatalogImportRowInput; applied: AppliedMediaRow }>,
  ): Promise<RollbackBaseline | null> {
    const expectedProductVersions = new Set(group.map(({ applied }) => applied.productPostVersion));
    if (expectedProductVersions.size !== 1 || expectedProductVersions.has(null)) return null;
    const expectedProductVersion = [...expectedProductVersions][0]!;
    const expectedVariantVersions = new Map<string, number>();
    for (const { applied } of group) {
      if (!applied.variantId || applied.postVersion === null) return null;
      expectedVariantVersions.set(applied.variantId, applied.postVersion);
    }
    const [product, variants] = await Promise.all([
      this.prisma.product.findFirst({
        where: { id: productId, deletedAt: null, archivedAt: null },
        select: { version: true },
      }),
      this.prisma.productVariant.findMany({
        where: {
          id: { in: [...expectedVariantVersions.keys()] },
          productId,
          deletedAt: null,
          archivedAt: null,
        },
        select: { id: true, version: true },
      }),
    ]);
    if (!product || product.version !== expectedProductVersion) return null;
    const actualVariantVersions = new Map(variants.map((variant) => [variant.id, variant.version]));
    if (
      actualVariantVersions.size !== expectedVariantVersions.size ||
      [...expectedVariantVersions].some(
        ([id, version]) => actualVariantVersions.get(id) !== version,
      )
    ) {
      return null;
    }
    return { productVersion: expectedProductVersion, variantVersions: expectedVariantVersions };
  }

  private async synchronizeRollbackVersions(
    productId: string,
    group: Array<{ input: CatalogImportRowInput; applied: AppliedMediaRow }>,
    expectedProductVersion: number,
    expectedVariantVersions: Map<string, number>,
    clearMediaReview: boolean,
  ): Promise<RollbackSynchronization> {
    return this.prisma.$transaction(
      async (transaction) => {
        const [product, variants] = await Promise.all([
          transaction.product.findFirst({
            where: { id: productId, deletedAt: null, archivedAt: null },
            select: { version: true, needsMediaReview: true },
          }),
          transaction.productVariant.findMany({
            where: {
              id: { in: [...expectedVariantVersions.keys()] },
              productId,
              deletedAt: null,
              archivedAt: null,
            },
            select: { id: true, version: true },
          }),
        ]);
        const actualVariantVersions = new Map(
          variants.map((variant) => [variant.id, variant.version]),
        );
        if (
          !product ||
          product.version !== expectedProductVersion ||
          actualVariantVersions.size !== expectedVariantVersions.size ||
          [...expectedVariantVersions].some(
            ([id, version]) => actualVariantVersions.get(id) !== version,
          )
        ) {
          return { synchronized: false, mediaReviewResolved: false };
        }

        let productPostVersion = expectedProductVersion;
        let mediaReviewResolved = false;
        if (clearMediaReview) {
          const unresolvedImageCount = await transaction.productImage.count({
            where: {
              deletedAt: null,
              moderationStatus: { in: ['PENDING', 'QUARANTINED'] },
              OR: [
                { productId, variantId: null },
                { productId: null, variant: { is: { productId, deletedAt: null } } },
              ],
            },
          });
          mediaReviewResolved = unresolvedImageCount === 0;
          if (mediaReviewResolved && product.needsMediaReview) {
            const changed = await transaction.product.updateMany({
              where: {
                id: productId,
                version: expectedProductVersion,
                needsMediaReview: true,
                deletedAt: null,
                archivedAt: null,
              },
              data: { needsMediaReview: false, version: { increment: 1 } },
            });
            if (changed.count !== 1) {
              return { synchronized: false, mediaReviewResolved: false };
            }
            productPostVersion += 1;
          }
        }
        await Promise.all(
          group.map(({ applied }) =>
            transaction.catalogImportRow.update({
              where: { id: applied.id },
              data: {
                productPostVersion,
                postVersion: applied.variantId
                  ? (expectedVariantVersions.get(applied.variantId) ?? null)
                  : null,
              },
            }),
          ),
        );
        return { synchronized: true, mediaReviewResolved };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private groupRows(
    payload: StoredMediaPayload,
    appliedByRow: Map<number, AppliedMediaRow>,
  ): Array<Array<{ input: CatalogImportRowInput; applied: AppliedMediaRow }>> {
    const groups = new Map<
      string,
      Array<{ input: CatalogImportRowInput; applied: AppliedMediaRow }>
    >();
    for (const row of payload.rows) {
      const applied = appliedByRow.get(row.rowNumber);
      if (!row.input || !applied) continue;
      const group = groups.get(row.input.productKey) ?? [];
      group.push({ input: row.input, applied });
      groups.set(row.input.productKey, group);
    }
    return [...groups.values()];
  }

  private assertBoundedMediaWork(
    groups: Array<Array<{ input: CatalogImportRowInput; applied: AppliedMediaRow }>>,
  ): void {
    let total = 0;
    for (const group of groups) {
      const productImageUrl = group[0]?.input.productImageUrl;
      const count =
        (productImageUrl ? 1 : 0) +
        group.filter(
          ({ input }) =>
            Boolean(input.variantImageUrl) && input.variantImageUrl !== productImageUrl,
        ).length;
      if (count > MAX_MEDIA_DOWNLOADS_PER_PRODUCT) {
        throw new ConflictException({
          code: 'CATALOG_MEDIA_PRODUCT_LIMIT_EXCEEDED',
          message: `A product can import at most ${MAX_MEDIA_DOWNLOADS_PER_PRODUCT} remote images in one synchronous run. Split the catalogue batch and retry.`,
        });
      }
      total += count;
    }
    if (total > MAX_MEDIA_DOWNLOADS_PER_BATCH) {
      throw new ConflictException({
        code: 'CATALOG_MEDIA_BATCH_LIMIT_EXCEEDED',
        message: `A catalogue batch can import at most ${MAX_MEDIA_DOWNLOADS_PER_BATCH} remote images in one synchronous run. Split the batch and retry.`,
      });
    }
  }

  private storedPayload(batch: CatalogImportBatch): StoredMediaPayload {
    const payload = batch.payload as unknown as StoredMediaPayload;
    if (!payload || payload.schemaVersion !== '1.0' || !Array.isArray(payload.rows)) {
      throw new ConflictException({
        code: 'CATALOG_MEDIA_IMPORT_PAYLOAD_INVALID',
        message: 'The stored catalogue payload cannot be used for media import.',
      });
    }
    return payload;
  }

  private serializeBatch(batch: CatalogImportBatch & { rows?: unknown[] }) {
    return {
      id: batch.id,
      importKey: batch.importKey,
      dryRun: batch.dryRun,
      payloadHash: batch.payloadHash,
      format: batch.format,
      source: batch.source,
      schemaVersion: batch.schemaVersion,
      status: batch.status,
      partialMode: batch.partialMode,
      overridePrice: batch.overridePrice,
      overrideStatus: batch.overrideStatus,
      overrideImages: batch.overrideImages,
      rowCount: batch.rowCount,
      appliedCount: batch.appliedCount,
      result: batch.result,
      previewBatchId: batch.previewBatchId,
      createdByUserId: batch.createdByUserId,
      createdAt: batch.createdAt.toISOString(),
      completedAt: batch.completedAt?.toISOString() ?? null,
      rolledBackAt: batch.rolledBackAt?.toISOString() ?? null,
      ...('rows' in batch ? { rows: batch.rows } : {}),
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'CATALOG_IMPORT_NOT_FOUND',
      message: 'The requested catalogue import was not found.',
    });
  }

  private async acquireLock(batchId: string): Promise<string> {
    const token = randomUUID();
    const batchKey = `catalog-media-import:${batchId}`;
    let batchAcquired = false;
    try {
      await this.redis.connect();
      const acquired = await this.redis.client.set(
        batchKey,
        token,
        'PX',
        MEDIA_IMPORT_LOCK_TTL_MS,
        'NX',
      );
      if (acquired !== 'OK') {
        throw new ConflictException({
          code: 'CATALOG_MEDIA_IMPORT_IN_PROGRESS',
          message: 'Media import is already running for this catalogue batch.',
        });
      }
      batchAcquired = true;
      const globalCapacity = await this.redis.client.set(
        GLOBAL_MEDIA_IMPORT_LOCK_KEY,
        token,
        'PX',
        MEDIA_IMPORT_LOCK_TTL_MS,
        'NX',
      );
      if (globalCapacity !== 'OK') {
        await this.releaseLock(batchId, token);
        throw new ConflictException({
          code: 'CATALOG_MEDIA_IMPORT_CAPACITY_IN_USE',
          message: 'Another catalogue media batch is running. Retry after it completes.',
        });
      }
      return token;
    } catch (error) {
      if (batchAcquired) await this.releaseLock(batchId, token);
      if (error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException({
        code: 'CATALOG_MEDIA_IMPORT_LOCK_UNAVAILABLE',
        message: 'The media import lock service is unavailable.',
      });
    }
  }

  private async releaseLock(batchId: string, token: string): Promise<void> {
    await this.redis.client
      .eval(
        "local removed = 0; for i = 1, #KEYS do if redis.call('get', KEYS[i]) == ARGV[1] then removed = removed + redis.call('del', KEYS[i]) end end; return removed",
        2,
        `catalog-media-import:${batchId}`,
        GLOBAL_MEDIA_IMPORT_LOCK_KEY,
        token,
      )
      .catch(() => undefined);
  }

  private async renewLock(batchId: string, token: string): Promise<void> {
    let renewed: unknown;
    try {
      renewed = await this.redis.client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] and redis.call('get', KEYS[2]) == ARGV[1] then redis.call('pexpire', KEYS[1], ARGV[2]); redis.call('pexpire', KEYS[2], ARGV[2]); return 1 else return 0 end",
        2,
        `catalog-media-import:${batchId}`,
        GLOBAL_MEDIA_IMPORT_LOCK_KEY,
        token,
        MEDIA_IMPORT_LOCK_TTL_MS,
      );
    } catch {
      throw new ServiceUnavailableException({
        code: 'CATALOG_MEDIA_IMPORT_LOCK_UNAVAILABLE',
        message: 'The media import lock service is unavailable.',
      });
    }
    if (renewed !== 1) {
      throw new ConflictException({
        code: 'CATALOG_MEDIA_IMPORT_LOCK_LOST',
        message: 'The media import lock was lost; the batch stopped before continuing.',
      });
    }
  }
}
