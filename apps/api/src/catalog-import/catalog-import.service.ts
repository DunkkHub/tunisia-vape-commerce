import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CatalogImportSource,
  Prisma,
  type CatalogImportBatch,
  type Product,
  type ProductVariant,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  CatalogImportIssue,
  CatalogImportRowInput,
  ParsedCatalogImport,
} from './catalog-import-contract';
import { canonicalJson, catalogueSlug, payloadHash, sha256 } from './catalog-identity';

export interface CatalogImportActor {
  userId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface CatalogImportOptions {
  importKey: string;
  format: 'CSV' | 'JSON' | 'WOTOFO';
  source: 'ADMIN_UPLOAD' | 'WOTOFO_OFFICIAL';
  partialMode: boolean;
  overridePrice: boolean;
  overrideStatus: boolean;
  overrideImages: boolean;
}

interface StoredPreviewPayload {
  schemaVersion: '1.0';
  rows: Array<{
    rowNumber: number;
    input: CatalogImportRowInput | null;
    issues: CatalogImportIssue[];
  }>;
}

interface ImportCounters {
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  rowsSkipped: number;
}

interface RollbackRow {
  id: string;
  status: string;
  productId: string | null;
  variantId: string | null;
  productPostVersion: number | null;
  postVersion: number | null;
}

const WOTOFO_CATEGORY_LABELS: Readonly<Record<string, { fr: string; ar: string }>> = {
  accessories: { fr: 'Accessoires', ar: 'إكسسوارات' },
  coils: { fr: 'Résistances', ar: 'ملفات التسخين' },
  devices: { fr: 'Appareils', ar: 'أجهزة' },
  disposables: { fr: 'Puffs jetables', ar: 'أجهزة فيب للاستخدام مرة واحدة' },
  'e-liquids': { fr: 'E-liquides', ar: 'سوائل إلكترونية' },
  'other-products': { fr: 'Autres produits', ar: 'منتجات أخرى' },
  pods: { fr: 'Kits pods rechargeables', ar: 'أطقم بود قابلة لإعادة التعبئة' },
  'prefilled-pod-kits': { fr: 'Kits pods préremplis', ar: 'أطقم بود معبأة مسبقاً' },
  'prefilled-replacement-pods': {
    fr: 'Cartouches préremplies',
    ar: 'خراطيش معبأة مسبقاً',
  },
};

const auditMetadata = (actor: CatalogImportActor) => ({
  actorUserId: actor.userId,
  actorType: 'ADMIN' as const,
  outcome: 'SUCCESS' as const,
  requestId: actor.requestId,
  ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
  ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
});

const inputJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const stableIdentity = (row: CatalogImportRowInput): string =>
  `${row.productKey}:${row.variantKey}`;

const productFields = (row: CatalogImportRowInput) => ({
  productKey: row.productKey,
  brand: row.brand,
  categorySlug: row.categorySlug,
  family: row.family,
  model: row.model,
  productType: row.productType,
  nameFr: row.nameFr,
  nameAr: row.nameAr,
  slug: row.slug,
  puffCount: row.puffCount,
  liquidCapacityMl: row.liquidCapacityMl,
  containsNicotine: row.containsNicotine,
  nicotineStrengthMg: row.nicotineStrengthMg,
  officialProductUrl: row.officialProductUrl,
  productImageUrl: row.productImageUrl,
});

const productSnapshot = (product: Product | null) =>
  product
    ? {
        id: product.id,
        brandId: product.brandId,
        categoryId: product.categoryId,
        nameFr: product.nameFr,
        nameAr: product.nameAr,
        slug: product.slug,
        family: product.family,
        model: product.model,
        productType: product.productType,
        containsNicotine: product.containsNicotine,
        nicotineStrengthMg: product.nicotineStrengthMg?.toString() ?? null,
        puffCount: product.puffCount,
        liquidCapacityMl: product.liquidCapacityMl?.toString() ?? null,
        publicationStatus: product.publicationStatus,
        requiresPricing: product.requiresPricing,
        requiresStock: product.requiresStock,
        needsMediaReview: product.needsMediaReview,
        version: product.version,
      }
    : null;

const variantSnapshot = (variant: ProductVariant | null) =>
  variant
    ? {
        id: variant.id,
        productId: variant.productId,
        flavorId: variant.flavorId,
        nameFr: variant.nameFr,
        nameAr: variant.nameAr,
        sku: variant.sku,
        color: variant.color,
        nicotineStrengthMg: variant.nicotineStrengthMg?.toString() ?? null,
        costMillimes: variant.costMillimes,
        priceMillimes: variant.priceMillimes,
        publicationStatus: variant.publicationStatus,
        version: variant.version,
      }
    : null;

const emptyCounters = (): ImportCounters => ({
  productsCreated: 0,
  productsUpdated: 0,
  variantsCreated: 0,
  variantsUpdated: 0,
  rowsSkipped: 0,
});

@Injectable()
export class CatalogImportService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(
    parsed: ParsedCatalogImport,
    options: CatalogImportOptions,
    actor: CatalogImportActor,
  ) {
    this.assertImportKey(options.importKey);
    const semantic = this.validatePayload(parsed);
    const invalidCount = semantic.rows.filter(({ input }) => !input).length;
    const validCount = semantic.rows.length - invalidCount;
    const status =
      validCount > 0 && (invalidCount === 0 || options.partialMode)
        ? ('PREVIEW_VALID' as const)
        : ('PREVIEW_INVALID' as const);
    const storedPayload: StoredPreviewPayload = {
      schemaVersion: '1.0',
      rows: semantic.rows,
    };
    const hash = payloadHash({ storedPayload, options });
    const existing = await this.prisma.catalogImportBatch.findUnique({
      where: { importKey_dryRun: { importKey: options.importKey, dryRun: true } },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
    if (existing) {
      if (existing.payloadHash !== hash) throw this.importKeyConflict();
      return this.serialize(existing);
    }

    const batch = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.catalogImportBatch.create({
        data: {
          importKey: options.importKey,
          dryRun: true,
          payloadHash: hash,
          format: options.format,
          source: options.source,
          schemaVersion: parsed.schemaVersion,
          status,
          partialMode: options.partialMode,
          overridePrice: options.overridePrice,
          overrideStatus: options.overrideStatus,
          overrideImages: options.overrideImages,
          rowCount: semantic.rows.length,
          payload: inputJson(storedPayload),
          result: {
            validCount,
            invalidCount,
            duplicateCount: semantic.duplicateCount,
            canApply: status === 'PREVIEW_VALID',
          },
          createdByUserId: actor.userId,
          completedAt: new Date(),
          rows: {
            create: semantic.rows.map((row) => ({
              rowNumber: row.rowNumber,
              stableIdentity: row.input
                ? stableIdentity(row.input)
                : `invalid-row:${row.rowNumber}`,
              payloadHash: payloadHash(row.input ?? row.issues),
              status: row.input ? 'VALID' : 'INVALID',
              action: row.input ? 'CREATE_OR_UPDATE' : 'REJECT',
              issues: inputJson(row.issues),
            })),
          },
        },
        include: { rows: { orderBy: { rowNumber: 'asc' } } },
      });
      await transaction.auditLog.create({
        data: {
          ...auditMetadata(actor),
          action: 'catalog.import.preview',
          resourceType: 'CatalogImportBatch',
          resourceId: created.id,
          afterSummary: {
            importKey: options.importKey,
            source: options.source,
            rowCount: semantic.rows.length,
            validCount,
            invalidCount,
            partialMode: options.partialMode,
            status,
          },
        },
      });
      return created;
    });
    return this.serialize(batch);
  }

  async apply(previewBatchId: string, actor: CatalogImportActor) {
    const preview = await this.prisma.catalogImportBatch.findFirst({
      where: { id: previewBatchId, dryRun: true },
    });
    if (!preview) throw this.notFound();
    if (preview.status !== 'PREVIEW_VALID' || !preview.payload) {
      throw new ConflictException({
        code: 'CATALOG_IMPORT_PREVIEW_NOT_APPLICABLE',
        message: 'Only a valid server-side catalogue preview can be applied.',
      });
    }
    const stored = this.storedPayload(preview.payload);
    const expectedHash = payloadHash({
      storedPayload: stored,
      options: {
        importKey: preview.importKey,
        format: preview.format,
        source: preview.source,
        partialMode: preview.partialMode,
        overridePrice: preview.overridePrice,
        overrideStatus: preview.overrideStatus,
        overrideImages: preview.overrideImages,
      },
    });
    if (expectedHash !== preview.payloadHash) {
      throw new ConflictException({
        code: 'CATALOG_IMPORT_PREVIEW_FINGERPRINT_MISMATCH',
        message: 'The stored catalogue preview fingerprint is invalid.',
      });
    }
    const existing = await this.prisma.catalogImportBatch.findUnique({
      where: { importKey_dryRun: { importKey: preview.importKey, dryRun: false } },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
    if (existing) {
      if (existing.payloadHash !== preview.payloadHash) throw this.importKeyConflict();
      return this.serialize(existing);
    }
    const validRows = stored.rows.filter(
      (row): row is typeof row & { input: CatalogImportRowInput } => Boolean(row.input),
    );
    if (validRows.length === 0) {
      throw new ConflictException({
        code: 'CATALOG_IMPORT_NO_VALID_ROWS',
        message: 'The catalogue preview contains no valid rows.',
      });
    }

    try {
      const batch = await this.prisma.$transaction(
        async (transaction) => {
          const created = await transaction.catalogImportBatch.create({
            data: {
              importKey: preview.importKey,
              dryRun: false,
              payloadHash: preview.payloadHash,
              format: preview.format,
              source: preview.source,
              schemaVersion: preview.schemaVersion,
              status: 'APPLYING',
              partialMode: preview.partialMode,
              overridePrice: preview.overridePrice,
              overrideStatus: preview.overrideStatus,
              overrideImages: preview.overrideImages,
              rowCount: validRows.length,
              payload: inputJson(preview.payload),
              result: { stage: 'applying' },
              previewBatchId: preview.id,
              createdByUserId: actor.userId,
            },
          });
          const counters = emptyCounters();
          const grouped = this.groupRows(validRows);
          const appliedRows: Prisma.CatalogImportRowCreateManyInput[] = [];
          for (const group of grouped) {
            await this.applyProductGroup(
              transaction,
              created,
              group,
              preview,
              counters,
              appliedRows,
            );
          }
          await transaction.catalogImportRow.createMany({ data: appliedRows });
          const pendingProductMedia = new Set(
            validRows.flatMap(({ input }) =>
              input.productImageUrl ? [input.productImageUrl] : [],
            ),
          ).size;
          const pendingVariantMedia = validRows.filter(({ input }) => input.variantImageUrl).length;
          const result = {
            ...counters,
            rowsApplied: appliedRows.filter(({ status }) => status !== 'SKIPPED').length,
            pendingProductMedia,
            pendingVariantMedia,
            manualPricingRequired: true,
            manualStockRequired: true,
          };
          const completed = await transaction.catalogImportBatch.update({
            where: { id: created.id },
            data: {
              status: 'APPLIED_WITH_WARNINGS',
              appliedCount: result.rowsApplied,
              result: inputJson(result),
              completedAt: new Date(),
            },
            include: { rows: { orderBy: { rowNumber: 'asc' } } },
          });
          await transaction.auditLog.create({
            data: {
              ...auditMetadata(actor),
              action: 'catalog.import.apply',
              resourceType: 'CatalogImportBatch',
              resourceId: created.id,
              afterSummary: {
                importKey: created.importKey,
                source: created.source,
                ...result,
              },
            },
          });
          return completed;
        },
        { maxWait: 10_000, timeout: 90_000 },
      );
      return this.serialize(batch);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.catalogImportBatch
          .findUnique({
            where: { importKey_dryRun: { importKey: preview.importKey, dryRun: false } },
            include: { rows: { orderBy: { rowNumber: 'asc' } } },
          })
          .catch(() => null);
        if (winner) {
          if (winner.payloadHash !== preview.payloadHash) throw this.importKeyConflict();
          return this.serialize(winner);
        }
      }
      throw new ConflictException({
        code: 'CATALOG_IMPORT_APPLY_FAILED',
        message: 'The catalogue batch was rolled back because it could not be applied atomically.',
      });
    }
  }

  async history(page: number, pageSize: number) {
    const where = {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.catalogImportBatch.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.catalogImportBatch.count({ where }),
    ]);
    return {
      data: {
        items: items.map((batch) => this.serialize(batch).data),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async rollback(batchId: string, actor: CatalogImportActor) {
    const batch = await this.prisma.catalogImportBatch.findUnique({
      where: { id: batchId },
      include: {
        rows: {
          orderBy: { rowNumber: 'asc' },
          select: {
            id: true,
            status: true,
            productId: true,
            variantId: true,
            productPostVersion: true,
            postVersion: true,
          },
        },
      },
    });
    if (!batch || batch.dryRun) throw this.notFound();
    if (batch.status === 'ROLLED_BACK') return this.get(batch.id);
    if (batch.status !== 'APPLIED' && batch.status !== 'APPLIED_WITH_WARNINGS') {
      throw new ConflictException({
        code: 'CATALOG_IMPORT_NOT_ROLLBACKABLE',
        message: 'Only a completed catalogue import can be rolled back.',
      });
    }
    this.assertCreateOnlyRollback(batch.rows);

    const rolledBack = await this.prisma.$transaction(
      async (transaction) => {
        const locked = await transaction.catalogImportBatch.updateMany({
          where: {
            id: batch.id,
            status: { in: ['APPLIED', 'APPLIED_WITH_WARNINGS'] },
            rolledBackAt: null,
          },
          data: { status: 'APPLYING' },
        });
        if (locked.count !== 1) throw this.rollbackConflict();

        for (const row of batch.rows) {
          const variant = await transaction.productVariant.updateMany({
            where: {
              id: row.variantId!,
              version: row.postVersion!,
              deletedAt: null,
              archivedAt: null,
            },
            data: {
              publicationStatus: 'DRAFT',
              archivedAt: new Date(),
              version: { increment: 1 },
            },
          });
          if (variant.count !== 1) throw this.rollbackConflict();
        }

        const products = this.rollbackProducts(batch.rows);
        for (const product of products) {
          const archived = await transaction.product.updateMany({
            where: {
              id: product.id,
              version: product.version,
              deletedAt: null,
              archivedAt: null,
            },
            data: {
              publicationStatus: 'ARCHIVED',
              publishedAt: null,
              suspendedAt: null,
              archivedAt: new Date(),
              version: { increment: 1 },
            },
          });
          if (archived.count !== 1) throw this.rollbackConflict();
        }

        await transaction.catalogImportRow.updateMany({
          where: { batchId: batch.id },
          data: { status: 'ROLLED_BACK', action: 'ARCHIVE_CREATED' },
        });
        const completed = await transaction.catalogImportBatch.update({
          where: { id: batch.id },
          data: {
            status: 'ROLLED_BACK',
            rolledBackAt: new Date(),
            result: inputJson({
              rollback: 'CREATE_ONLY_ARCHIVE',
              productsArchived: products.length,
              variantsArchived: batch.rows.length,
            }),
          },
          include: { rows: { orderBy: { rowNumber: 'asc' } } },
        });
        await transaction.auditLog.create({
          data: {
            ...auditMetadata(actor),
            action: 'catalog.import.rollback',
            resourceType: 'CatalogImportBatch',
            resourceId: batch.id,
            beforeSummary: { status: batch.status, appliedCount: batch.appliedCount },
            afterSummary: {
              status: completed.status,
              productsArchived: products.length,
              variantsArchived: batch.rows.length,
            },
          },
        });
        return completed;
      },
      { maxWait: 10_000, timeout: 90_000 },
    );
    return this.serialize(rolledBack);
  }

  async get(id: string) {
    const batch = await this.prisma.catalogImportBatch.findUnique({
      where: { id },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
    if (!batch) throw this.notFound();
    return this.serialize(batch);
  }

  private validatePayload(parsed: ParsedCatalogImport) {
    const rows = parsed.rows.map((row) => ({
      rowNumber: row.rowNumber,
      input: row.input,
      issues: [...row.issues],
    }));
    const seenIdentities = new Map<string, number>();
    const seenSkus = new Map<string, number>();
    const productSignatures = new Map<string, string>();
    let duplicateCount = 0;
    for (const row of rows) {
      if (!row.input) continue;
      const identity = stableIdentity(row.input);
      const duplicateIdentity = seenIdentities.get(identity);
      const duplicateSku = seenSkus.get(row.input.sku);
      const signature = canonicalJson(productFields(row.input));
      const existingSignature = productSignatures.get(row.input.productKey);
      if (duplicateIdentity !== undefined) {
        row.issues.push({
          code: 'DUPLICATE_VARIANT_IDENTITY',
          message: `The variant identity duplicates row ${duplicateIdentity}.`,
        });
      }
      if (duplicateSku !== undefined) {
        row.issues.push({
          code: 'DUPLICATE_SKU',
          field: 'sku',
          message: `The SKU duplicates row ${duplicateSku}.`,
        });
      }
      if (existingSignature && existingSignature !== signature) {
        row.issues.push({
          code: 'INCONSISTENT_PRODUCT_GROUP',
          message: 'Rows with the same productKey must have identical product metadata.',
        });
      }
      if (row.issues.length > 0) {
        row.input = null;
        duplicateCount += 1;
      } else {
        seenIdentities.set(identity, row.rowNumber);
        seenSkus.set(row.input.sku, row.rowNumber);
        productSignatures.set(row.input.productKey, signature);
      }
    }
    return { rows, duplicateCount };
  }

  private groupRows(
    rows: Array<{ rowNumber: number; input: CatalogImportRowInput; issues: CatalogImportIssue[] }>,
  ) {
    const groups = new Map<
      string,
      Array<{ rowNumber: number; input: CatalogImportRowInput; issues: CatalogImportIssue[] }>
    >();
    for (const row of rows) {
      const group = groups.get(row.input.productKey) ?? [];
      group.push(row);
      groups.set(row.input.productKey, group);
    }
    return [...groups.values()];
  }

  private async applyProductGroup(
    transaction: Prisma.TransactionClient,
    batch: CatalogImportBatch,
    rows: Array<{ rowNumber: number; input: CatalogImportRowInput; issues: CatalogImportIssue[] }>,
    preview: CatalogImportBatch,
    counters: ImportCounters,
    appliedRows: Prisma.CatalogImportRowCreateManyInput[],
  ) {
    const first = rows[0]!.input;
    const { brandId, categoryId } = await this.resolveTaxonomy(transaction, first, batch.source);
    const sourceRecord = await transaction.catalogSourceRecord.findUnique({
      where: {
        source_entityType_externalKey: {
          source: batch.source,
          entityType: 'PRODUCT',
          externalKey: first.productKey,
        },
      },
      select: { productId: true },
    });
    let current = sourceRecord?.productId
      ? await transaction.product.findFirst({
          where: { id: sourceRecord.productId, deletedAt: null },
        })
      : await transaction.product.findFirst({ where: { slug: first.slug, deletedAt: null } });
    const beforeProduct = productSnapshot(current);
    if (current && current.slug !== first.slug) {
      throw new ConflictException({
        code: 'CATALOG_IMPORT_PRODUCT_IDENTITY_CONFLICT',
        message: `The source identity ${first.productKey} is already linked to another product slug.`,
      });
    }
    if (!current) {
      current = await transaction.product.create({
        data: {
          brandId,
          categoryId,
          nameFr: first.nameFr,
          nameAr: first.nameAr,
          slug: first.slug,
          productType: first.productType,
          family: first.family,
          model: first.model,
          containsNicotine: first.containsNicotine,
          nicotineStrengthMg: first.nicotineStrengthMg,
          flavor: null,
          puffCount: first.puffCount,
          liquidCapacityMl: first.liquidCapacityMl,
          basePriceMillimes: null,
          publicationStatus: 'DRAFT',
          requiresPricing: true,
          requiresStock: true,
          needsMediaReview: true,
          minimumAge: 18,
          warningFr: first.containsNicotine
            ? 'Ce produit contient de la nicotine, une substance addictive.'
            : null,
          warningAr: first.containsNicotine
            ? 'يحتوي هذا المنتج على النيكوتين، وهي مادة تسبب الإدمان.'
            : null,
        },
      });
      counters.productsCreated += 1;
    } else {
      current = await transaction.product.update({
        where: { id: current.id },
        data: {
          brandId,
          categoryId,
          nameFr: first.nameFr,
          nameAr: first.nameAr,
          family: first.family,
          model: first.model,
          productType: first.productType,
          containsNicotine: first.containsNicotine,
          nicotineStrengthMg: first.nicotineStrengthMg,
          flavor: null,
          puffCount: first.puffCount,
          liquidCapacityMl: first.liquidCapacityMl,
          version: { increment: 1 },
        },
      });
      counters.productsUpdated += 1;
    }
    if (first.officialProductUrl) {
      await transaction.catalogSourceRecord.upsert({
        where: {
          source_entityType_externalKey: {
            source: batch.source,
            entityType: 'PRODUCT',
            externalKey: first.productKey,
          },
        },
        update: {
          sourceUrl: first.officialProductUrl,
          sourceUrlHash: sha256(first.officialProductUrl),
          verifiedAt: batch.source === 'WOTOFO_OFFICIAL' ? new Date() : null,
          productId: current.id,
          variantId: null,
          imageId: null,
          metadata: {
            importBatchId: batch.id,
            payloadHash: batch.payloadHash,
            verificationStatus:
              batch.source === 'WOTOFO_OFFICIAL'
                ? 'OFFICIAL_SOURCE_VERIFIED'
                : 'OPERATOR_SUPPLIED_UNVERIFIED',
          },
        },
        create: {
          source: batch.source,
          entityType: 'PRODUCT',
          externalKey: first.productKey,
          sourceUrl: first.officialProductUrl,
          sourceUrlHash: sha256(first.officialProductUrl),
          verifiedAt: batch.source === 'WOTOFO_OFFICIAL' ? new Date() : null,
          productId: current.id,
          metadata: {
            importBatchId: batch.id,
            payloadHash: batch.payloadHash,
            verificationStatus:
              batch.source === 'WOTOFO_OFFICIAL'
                ? 'OFFICIAL_SOURCE_VERIFIED'
                : 'OPERATOR_SUPPLIED_UNVERIFIED',
          },
        },
      });
    }

    for (const row of rows) {
      const before = await this.findVariant(transaction, batch.source, current.id, row.input);
      const beforeVariant = variantSnapshot(before);
      const flavorId = await this.resolveFlavor(transaction, row.input);
      let variant: ProductVariant;
      let action: string;
      if (!before) {
        const requestedStatus = preview.overrideStatus ? row.input.publicationStatus : null;
        if (requestedStatus === 'PUBLISHED') {
          throw new ConflictException({
            code: 'CATALOG_IMPORT_CANNOT_PUBLISH',
            message: 'Catalogue imports cannot publish variants before stock and media review.',
          });
        }
        variant = await transaction.productVariant.create({
          data: {
            productId: current.id,
            flavorId,
            nameFr: row.input.variantNameFr,
            nameAr: row.input.variantNameAr,
            sku: row.input.sku,
            color: row.input.color,
            nicotineStrengthMg: row.input.nicotineStrengthMg,
            costMillimes: null,
            priceMillimes:
              preview.overridePrice && row.input.priceMillimes !== null
                ? row.input.priceMillimes
                : 0,
            publicationStatus: requestedStatus ?? 'DRAFT',
            sortOrder: row.rowNumber,
          },
        });
        counters.variantsCreated += 1;
        action = 'CREATE';
      } else {
        if (before.productId !== current.id) {
          throw new ConflictException({
            code: 'CATALOG_IMPORT_SKU_CONFLICT',
            message: `SKU ${row.input.sku} already belongs to another product.`,
          });
        }
        if (preview.overrideStatus && row.input.publicationStatus === 'PUBLISHED') {
          throw new ConflictException({
            code: 'CATALOG_IMPORT_CANNOT_PUBLISH',
            message: 'Catalogue imports cannot publish variants before stock and media review.',
          });
        }
        variant = await transaction.productVariant.update({
          where: { id: before.id },
          data: {
            flavorId,
            nameFr: row.input.variantNameFr,
            nameAr: row.input.variantNameAr,
            color: row.input.color,
            nicotineStrengthMg: row.input.nicotineStrengthMg,
            ...(preview.overridePrice && row.input.priceMillimes !== null
              ? { priceMillimes: row.input.priceMillimes }
              : {}),
            ...(preview.overrideStatus && row.input.publicationStatus
              ? { publicationStatus: row.input.publicationStatus }
              : {}),
            version: { increment: 1 },
          },
        });
        counters.variantsUpdated += 1;
        action = 'UPDATE';
      }
      if (row.input.officialProductUrl) {
        await transaction.catalogSourceRecord.upsert({
          where: {
            source_entityType_externalKey: {
              source: batch.source,
              entityType: 'VARIANT',
              externalKey: stableIdentity(row.input),
            },
          },
          update: {
            sourceUrl: row.input.officialProductUrl,
            sourceUrlHash: sha256(row.input.officialProductUrl),
            verifiedAt: batch.source === 'WOTOFO_OFFICIAL' ? new Date() : null,
            variantId: variant.id,
            productId: null,
            imageId: null,
            metadata: {
              importBatchId: batch.id,
              productKey: row.input.productKey,
              variantKey: row.input.variantKey,
              verificationStatus:
                batch.source === 'WOTOFO_OFFICIAL'
                  ? 'OFFICIAL_SOURCE_VERIFIED'
                  : 'OPERATOR_SUPPLIED_UNVERIFIED',
            },
          },
          create: {
            source: batch.source,
            entityType: 'VARIANT',
            externalKey: stableIdentity(row.input),
            sourceUrl: row.input.officialProductUrl,
            sourceUrlHash: sha256(row.input.officialProductUrl),
            verifiedAt: batch.source === 'WOTOFO_OFFICIAL' ? new Date() : null,
            variantId: variant.id,
            metadata: {
              importBatchId: batch.id,
              productKey: row.input.productKey,
              variantKey: row.input.variantKey,
              verificationStatus:
                batch.source === 'WOTOFO_OFFICIAL'
                  ? 'OFFICIAL_SOURCE_VERIFIED'
                  : 'OPERATOR_SUPPLIED_UNVERIFIED',
            },
          },
        });
      }
      appliedRows.push({
        batchId: batch.id,
        rowNumber: row.rowNumber,
        stableIdentity: stableIdentity(row.input),
        payloadHash: payloadHash(row.input),
        status: action === 'CREATE' ? 'CREATED' : 'UPDATED',
        action,
        issues: inputJson(row.issues),
        beforeSnapshot: inputJson({ product: beforeProduct, variant: beforeVariant }),
        afterSnapshot: inputJson({
          product: productSnapshot(current),
          variant: variantSnapshot(variant),
        }),
        productId: current.id,
        variantId: variant.id,
        productPostVersion: current.version,
        postVersion: variant.version,
      });
    }
  }

  private async resolveTaxonomy(
    transaction: Prisma.TransactionClient,
    row: CatalogImportRowInput,
    source: CatalogImportSource,
  ) {
    const brandSlug = catalogueSlug(row.brand);
    let brand = await transaction.brand.findFirst({
      where: { slug: brandSlug, deletedAt: null },
      select: { id: true },
    });
    let category = await transaction.category.findFirst({
      where: { slug: row.categorySlug, deletedAt: null },
      select: { id: true },
    });
    if (source === 'WOTOFO_OFFICIAL') {
      brand ??= await transaction.brand.create({
        data: { name: row.brand, slug: brandSlug, publicationStatus: 'DRAFT' },
        select: { id: true },
      });
      if (!category) {
        const labels = WOTOFO_CATEGORY_LABELS[row.categorySlug];
        if (!labels) {
          throw new BadRequestException({
            code: 'CATALOG_IMPORT_CATEGORY_UNREVIEWED',
            message: `The Wotofo category ${row.categorySlug} has no reviewed translation.`,
          });
        }
        category = await transaction.category.create({
          data: {
            slug: row.categorySlug,
            nameFr: labels.fr,
            nameAr: labels.ar,
            publicationStatus: 'DRAFT',
          },
          select: { id: true },
        });
      }
    }
    if (!brand || !category) {
      throw new BadRequestException({
        code: 'CATALOG_IMPORT_TAXONOMY_MISSING',
        message: 'Administrative imports require an existing brand and category.',
      });
    }
    return { brandId: brand.id, categoryId: category.id };
  }

  private async resolveFlavor(
    transaction: Prisma.TransactionClient,
    row: CatalogImportRowInput,
  ): Promise<string | null> {
    if (!row.flavorCanonical) return null;
    const slug = catalogueSlug(row.flavorCanonical);
    const conflicting = await transaction.flavor.findFirst({
      where: { slug, NOT: { canonicalName: row.flavorCanonical } },
      select: { id: true },
    });
    if (conflicting) {
      throw new ConflictException({
        code: 'CATALOG_IMPORT_FLAVOR_SLUG_CONFLICT',
        message: `Flavor slug ${slug} is already assigned to another canonical flavor.`,
      });
    }
    const flavor = await transaction.flavor.upsert({
      where: { canonicalName: row.flavorCanonical },
      update: {
        nameFr: row.flavorNameFr!,
        nameAr: row.flavorNameAr!,
        category: row.flavorCategory!,
      },
      create: {
        canonicalName: row.flavorCanonical,
        slug,
        nameFr: row.flavorNameFr!,
        nameAr: row.flavorNameAr!,
        category: row.flavorCategory!,
      },
      select: { id: true },
    });
    return flavor.id;
  }

  private async findVariant(
    transaction: Prisma.TransactionClient,
    source: CatalogImportSource,
    productId: string,
    row: CatalogImportRowInput,
  ) {
    const sourceRecord = await transaction.catalogSourceRecord.findUnique({
      where: {
        source_entityType_externalKey: {
          source,
          entityType: 'VARIANT',
          externalKey: stableIdentity(row),
        },
      },
      select: { variantId: true },
    });
    if (sourceRecord?.variantId) {
      return transaction.productVariant.findFirst({
        where: { id: sourceRecord.variantId, deletedAt: null },
      });
    }
    return transaction.productVariant.findFirst({
      where: { OR: [{ sku: row.sku }, { productId, sku: row.sku }], deletedAt: null },
    });
  }

  private storedPayload(value: Prisma.JsonValue): StoredPreviewPayload {
    const payload = value as unknown as StoredPreviewPayload;
    if (
      !payload ||
      payload.schemaVersion !== '1.0' ||
      !Array.isArray(payload.rows) ||
      payload.rows.length === 0
    ) {
      throw new ConflictException({
        code: 'CATALOG_IMPORT_PREVIEW_PAYLOAD_INVALID',
        message: 'The stored catalogue preview payload is invalid.',
      });
    }
    return payload;
  }

  private serialize(batch: CatalogImportBatch & { rows?: unknown[] }) {
    return {
      data: {
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
      },
    };
  }

  private assertImportKey(value: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,99}$/.test(value)) {
      throw new BadRequestException({
        code: 'CATALOG_IMPORT_KEY_INVALID',
        message: 'The import key must be 3-100 safe characters.',
      });
    }
  }

  private assertCreateOnlyRollback(rows: readonly RollbackRow[]): void {
    if (
      rows.length === 0 ||
      rows.some(
        (row) =>
          row.status !== 'CREATED' ||
          !row.productId ||
          !row.variantId ||
          row.productPostVersion === null ||
          row.postVersion === null,
      )
    ) {
      throw new ConflictException({
        code: 'CATALOG_IMPORT_ROLLBACK_REQUIRES_MANUAL_REVIEW',
        message:
          'Automatic rollback is limited to unchanged create-only batches so manually maintained records are never overwritten.',
      });
    }
  }

  private rollbackProducts(rows: readonly RollbackRow[]): Array<{ id: string; version: number }> {
    const products = new Map<string, number>();
    for (const row of rows) {
      const existing = products.get(row.productId!);
      if (existing !== undefined && existing !== row.productPostVersion) {
        throw this.rollbackConflict();
      }
      products.set(row.productId!, row.productPostVersion!);
    }
    return [...products].map(([id, version]) => ({ id, version }));
  }

  private rollbackConflict(): ConflictException {
    return new ConflictException({
      code: 'CATALOG_IMPORT_ROLLBACK_CONFLICT',
      message:
        'The imported records changed after the batch completed; rollback stopped without overwriting those changes.',
    });
  }

  private importKeyConflict(): ConflictException {
    return new ConflictException({
      code: 'CATALOG_IMPORT_KEY_REUSED',
      message: 'This import key is already associated with a different payload.',
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'CATALOG_IMPORT_NOT_FOUND',
      message: 'The requested catalogue import was not found.',
    });
  }
}
