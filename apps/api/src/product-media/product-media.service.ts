import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildPublicProductWhere } from '../catalog/catalog-policy';
import { PrismaService } from '../database/prisma.service';
import type {
  ProductImageOwnerVersionDto,
  ProductMediaListQueryDto,
  ReorderProductImagesDto,
  ReplaceProductImageDto,
  UpdateProductImageMetadataDto,
  UploadProductImageDto,
} from './dto/product-media.dto';
import {
  ProductImageValidatorService,
  type UploadedProductImage,
  type ValidatedProductImage,
} from './product-image-validator.service';
import { PRODUCT_MEDIA_STORAGE, type MediaStorage } from './storage/media-storage';

const MAX_IMAGES_PER_OWNER = 20;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export interface ProductMediaMutationContext {
  userId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

interface MediaOwner {
  kind: 'product' | 'variant';
  id: string;
  productId: string;
  version: number;
}

const adminImageSelect = {
  id: true,
  productId: true,
  variantId: true,
  objectKey: true,
  objectKeyHash: true,
  bucket: true,
  contentType: true,
  byteSize: true,
  checksumSha256: true,
  width: true,
  height: true,
  altTextFr: true,
  altTextAr: true,
  sortOrder: true,
  isPrimary: true,
  moderationStatus: true,
  createdAt: true,
  deletedAt: true,
  product: { select: { id: true, version: true } },
  variant: { select: { id: true, productId: true, version: true } },
} satisfies Prisma.ProductImageSelect;

type AdminImageRecord = Prisma.ProductImageGetPayload<{ select: typeof adminImageSelect }>;

export const publicProductImageUrl = (objectKeyHash: string): string =>
  `/api/v1/media/${objectKeyHash}`;

@Injectable()
export class ProductMediaService {
  private readonly logger = new Logger(ProductMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: ProductImageValidatorService,
    @Inject(PRODUCT_MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  async list(productId: string, query: ProductMediaListQueryDto) {
    if (query.variantId) {
      await this.resolveOwner(this.prisma, productId, query.variantId);
    } else {
      await this.resolveOwner(this.prisma, productId);
    }
    const where: Prisma.ProductImageWhereInput = {
      deletedAt: null,
      ...(query.variantId
        ? { productId: null, variantId: query.variantId }
        : {
            OR: [
              { productId, variantId: null },
              { productId: null, variant: { is: { productId } } },
            ],
          }),
    };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.productImage.findMany({
        where,
        orderBy: [{ variantId: 'asc' }, { isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: adminImageSelect,
      }),
      this.prisma.productImage.count({ where }),
    ]);
    return {
      data: {
        items: records.map((record) => this.serialize(record)),
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async upload(
    productId: string,
    input: UploadProductImageDto,
    file: UploadedProductImage | undefined,
    context: ProductMediaMutationContext,
  ) {
    const image = await this.validator.validate(file);
    const preflightOwner = await this.resolveOwner(this.prisma, productId, input.variantId);
    this.assertVersion(preflightOwner.version, input.expectedOwnerVersion);
    const stored = this.storedObject(preflightOwner, image);
    await this.store(stored, image);

    try {
      const record = await this.prisma.$transaction(async (transaction) => {
        const owner = await this.lockOwner(transaction, preflightOwner, input.expectedOwnerVersion);
        const where = this.ownerImageWhere(owner);
        const count = await transaction.productImage.count({
          where: { ...where, deletedAt: null },
        });
        if (count >= MAX_IMAGES_PER_OWNER) throw this.imageLimitReached();
        const aggregate = await transaction.productImage.aggregate({
          where: { ...where, deletedAt: null },
          _max: { sortOrder: true },
        });
        const isPrimary = input.isPrimary === true || count === 0;
        if (isPrimary) await this.clearPrimary(transaction, owner);
        const created = await transaction.productImage.create({
          data: {
            ...this.ownerData(owner),
            objectKey: stored.objectKey,
            objectKeyHash: stored.objectKeyHash,
            bucket: this.storage.bucket,
            contentType: image.contentType,
            byteSize: image.byteSize,
            checksumSha256: image.checksumSha256,
            width: image.width,
            height: image.height,
            altTextFr: input.altTextFr,
            altTextAr: input.altTextAr,
            sortOrder: (aggregate._max.sortOrder ?? -1) + 1,
            isPrimary,
            moderationStatus: 'APPROVED',
          },
          select: adminImageSelect,
        });
        await this.bumpOwner(transaction, owner, input.expectedOwnerVersion);
        await transaction.auditLog.create({
          data: {
            ...auditMetadata(context),
            action: 'catalog.product_image.upload',
            resourceType: 'ProductImage',
            resourceId: created.id,
            afterSummary: {
              productId,
              variantId: owner.kind === 'variant' ? owner.id : null,
              contentType: created.contentType,
              byteSize: created.byteSize,
              width: created.width,
              height: created.height,
              checksumSha256: created.checksumSha256,
              isPrimary: created.isPrimary,
              ownerVersion: owner.version + 1,
            },
          },
        });
        return created;
      });
      return { data: this.serialize(record, input.expectedOwnerVersion + 1) };
    } catch (error) {
      await this.cleanupFailedWrite(stored.objectKey);
      throw error;
    }
  }

  async updateMetadata(
    productId: string,
    imageId: string,
    input: UpdateProductImageMetadataDto,
    context: ProductMediaMutationContext,
  ) {
    if (input.altTextFr === undefined && input.altTextAr === undefined) {
      throw new BadRequestException({
        code: 'IMAGE_METADATA_UPDATE_EMPTY',
        message: 'At least one bilingual alternative-text field must be supplied.',
      });
    }
    const record = await this.prisma.$transaction(async (transaction) => {
      const initial = await this.findScopedImage(transaction, productId, imageId);
      const owner = await this.lockOwner(
        transaction,
        this.ownerFromImage(initial),
        input.expectedOwnerVersion,
      );
      const current = await this.findExactImage(transaction, imageId, owner);
      const updated = await transaction.productImage.updateMany({
        where: { id: current.id, ...this.ownerImageWhere(owner), deletedAt: null },
        data: {
          ...(input.altTextFr !== undefined ? { altTextFr: input.altTextFr } : {}),
          ...(input.altTextAr !== undefined ? { altTextAr: input.altTextAr } : {}),
        },
      });
      if (updated.count !== 1) throw this.imageNotFound();
      await this.bumpOwner(transaction, owner, input.expectedOwnerVersion);
      const changed = await this.findExactImage(transaction, imageId, owner);
      await transaction.auditLog.create({
        data: {
          ...auditMetadata(context),
          action: 'catalog.product_image.metadata_update',
          resourceType: 'ProductImage',
          resourceId: current.id,
          beforeSummary: { altTextFr: current.altTextFr, altTextAr: current.altTextAr },
          afterSummary: {
            altTextFr: changed.altTextFr,
            altTextAr: changed.altTextAr,
            ownerVersion: owner.version + 1,
          },
        },
      });
      return changed;
    });
    return { data: this.serialize(record, input.expectedOwnerVersion + 1) };
  }

  async setPrimary(
    productId: string,
    imageId: string,
    input: ProductImageOwnerVersionDto,
    context: ProductMediaMutationContext,
  ) {
    const record = await this.prisma.$transaction(async (transaction) => {
      const initial = await this.findScopedImage(transaction, productId, imageId);
      const owner = await this.lockOwner(
        transaction,
        this.ownerFromImage(initial),
        input.expectedOwnerVersion,
      );
      const current = await this.findExactImage(transaction, imageId, owner);
      if (current.moderationStatus !== 'APPROVED') {
        throw new ConflictException({
          code: 'IMAGE_NOT_APPROVED',
          message: 'Only an approved image can be made primary.',
        });
      }
      await this.clearPrimary(transaction, owner);
      const changedCount = await transaction.productImage.updateMany({
        where: { id: current.id, ...this.ownerImageWhere(owner), deletedAt: null },
        data: { isPrimary: true },
      });
      if (changedCount.count !== 1) throw this.imageNotFound();
      await this.bumpOwner(transaction, owner, input.expectedOwnerVersion);
      const changed = await this.findExactImage(transaction, imageId, owner);
      await transaction.auditLog.create({
        data: {
          ...auditMetadata(context),
          action: 'catalog.product_image.set_primary',
          resourceType: 'ProductImage',
          resourceId: current.id,
          beforeSummary: { isPrimary: current.isPrimary },
          afterSummary: { isPrimary: true, ownerVersion: owner.version + 1 },
        },
      });
      return changed;
    });
    return { data: this.serialize(record, input.expectedOwnerVersion + 1) };
  }

  async reorder(
    productId: string,
    input: ReorderProductImagesDto,
    context: ProductMediaMutationContext,
  ) {
    const records = await this.prisma.$transaction(async (transaction) => {
      const initialOwner = await this.resolveOwner(transaction, productId, input.variantId);
      const owner = await this.lockOwner(transaction, initialOwner, input.expectedOwnerVersion);
      const current = await transaction.productImage.findMany({
        where: { ...this.ownerImageWhere(owner), deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: MAX_IMAGES_PER_OWNER + 1,
        select: adminImageSelect,
      });
      const currentIds = new Set(current.map((image) => image.id));
      if (
        current.length !== input.imageIds.length ||
        input.imageIds.some((imageId) => !currentIds.has(imageId))
      ) {
        throw new BadRequestException({
          code: 'IMAGE_REORDER_SET_MISMATCH',
          message: 'The reorder request must contain every active image for exactly one owner.',
        });
      }
      for (const [sortOrder, imageId] of input.imageIds.entries()) {
        const updated = await transaction.productImage.updateMany({
          where: { id: imageId, ...this.ownerImageWhere(owner), deletedAt: null },
          data: { sortOrder },
        });
        if (updated.count !== 1) throw this.imageNotFound();
      }
      await this.bumpOwner(transaction, owner, input.expectedOwnerVersion);
      await transaction.auditLog.create({
        data: {
          ...auditMetadata(context),
          action: 'catalog.product_image.reorder',
          resourceType: owner.kind === 'product' ? 'Product' : 'ProductVariant',
          resourceId: owner.id,
          beforeSummary: { imageIds: current.map((image) => image.id) },
          afterSummary: { imageIds: input.imageIds, ownerVersion: owner.version + 1 },
        },
      });
      const byId = new Map(current.map((image) => [image.id, image]));
      return input.imageIds.map((id, sortOrder) => ({ ...byId.get(id)!, sortOrder }));
    });
    return {
      data: {
        items: records.map((record) => this.serialize(record, input.expectedOwnerVersion + 1)),
        ownerVersion: input.expectedOwnerVersion + 1,
      },
    };
  }

  async replace(
    productId: string,
    imageId: string,
    input: ReplaceProductImageDto,
    file: UploadedProductImage | undefined,
    context: ProductMediaMutationContext,
  ) {
    const image = await this.validator.validate(file);
    const preflight = await this.findScopedImage(this.prisma, productId, imageId);
    const preflightOwner = this.ownerFromImage(preflight);
    this.assertVersion(preflightOwner.version, input.expectedOwnerVersion);
    const stored = this.storedObject(preflightOwner, image);
    await this.store(stored, image);

    let replacedObjectKey: string | null = null;
    try {
      const replacement = await this.prisma.$transaction(async (transaction) => {
        const initial = await this.findScopedImage(transaction, productId, imageId);
        const owner = await this.lockOwner(
          transaction,
          this.ownerFromImage(initial),
          input.expectedOwnerVersion,
        );
        const current = await this.findExactImage(transaction, imageId, owner);
        const created = await transaction.productImage.create({
          data: {
            ...this.ownerData(owner),
            objectKey: stored.objectKey,
            objectKeyHash: stored.objectKeyHash,
            bucket: this.storage.bucket,
            contentType: image.contentType,
            byteSize: image.byteSize,
            checksumSha256: image.checksumSha256,
            width: image.width,
            height: image.height,
            altTextFr: input.altTextFr ?? current.altTextFr,
            altTextAr: input.altTextAr ?? current.altTextAr,
            sortOrder: current.sortOrder,
            isPrimary: current.isPrimary,
            moderationStatus: 'APPROVED',
          },
          select: adminImageSelect,
        });
        const retired = await transaction.productImage.updateMany({
          where: { id: current.id, ...this.ownerImageWhere(owner), deletedAt: null },
          data: { deletedAt: new Date(), isPrimary: false },
        });
        if (retired.count !== 1) throw this.imageNotFound();
        await this.bumpOwner(transaction, owner, input.expectedOwnerVersion);
        await transaction.auditLog.create({
          data: {
            ...auditMetadata(context),
            action: 'catalog.product_image.replace',
            resourceType: 'ProductImage',
            resourceId: created.id,
            beforeSummary: {
              replacedImageId: current.id,
              checksumSha256: current.checksumSha256,
            },
            afterSummary: {
              checksumSha256: created.checksumSha256,
              contentType: created.contentType,
              byteSize: created.byteSize,
              ownerVersion: owner.version + 1,
            },
          },
        });
        await this.enqueueObjectDeletion(transaction, current);
        replacedObjectKey = current.objectKey;
        return created;
      });
      if (replacedObjectKey) await this.deleteStoredObject(replacedObjectKey);
      return { data: this.serialize(replacement, input.expectedOwnerVersion + 1) };
    } catch (error) {
      await this.cleanupFailedWrite(stored.objectKey);
      throw error;
    }
  }

  async remove(
    productId: string,
    imageId: string,
    expectedOwnerVersion: number,
    context: ProductMediaMutationContext,
  ) {
    let objectKey: string | null = null;
    const result = await this.prisma.$transaction(async (transaction) => {
      const initial = await this.findScopedImage(transaction, productId, imageId);
      const owner = await this.lockOwner(
        transaction,
        this.ownerFromImage(initial),
        expectedOwnerVersion,
      );
      const current = await this.findExactImage(transaction, imageId, owner);
      const deleted = await transaction.productImage.updateMany({
        where: { id: current.id, ...this.ownerImageWhere(owner), deletedAt: null },
        data: { deletedAt: new Date(), isPrimary: false },
      });
      if (deleted.count !== 1) throw this.imageNotFound();
      if (current.isPrimary) {
        const replacement = await transaction.productImage.findFirst({
          where: { ...this.ownerImageWhere(owner), deletedAt: null, moderationStatus: 'APPROVED' },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (replacement) {
          await transaction.productImage.updateMany({
            where: { id: replacement.id, ...this.ownerImageWhere(owner), deletedAt: null },
            data: { isPrimary: true },
          });
        }
      }
      await this.bumpOwner(transaction, owner, expectedOwnerVersion);
      await transaction.auditLog.create({
        data: {
          ...auditMetadata(context),
          action: 'catalog.product_image.delete',
          resourceType: 'ProductImage',
          resourceId: current.id,
          beforeSummary: {
            checksumSha256: current.checksumSha256,
            isPrimary: current.isPrimary,
          },
          afterSummary: { deleted: true, ownerVersion: owner.version + 1 },
        },
      });
      await this.enqueueObjectDeletion(transaction, current);
      objectKey = current.objectKey;
      return { id: current.id, deleted: true as const, ownerVersion: owner.version + 1 };
    });
    if (objectKey) await this.deleteStoredObject(objectKey);
    return { data: result };
  }

  async readPublic(objectKeyHash: string) {
    if (!HASH_PATTERN.test(objectKeyHash)) throw this.publicImageNotFound();
    const now = new Date();
    const publicProduct = buildPublicProductWhere({}, now);
    const image = await this.prisma.productImage.findFirst({
      where: {
        objectKeyHash,
        bucket: this.storage.bucket,
        deletedAt: null,
        moderationStatus: 'APPROVED',
        OR: [
          { productId: { not: null }, variantId: null, product: { is: publicProduct } },
          {
            productId: null,
            variantId: { not: null },
            variant: {
              is: {
                publicationStatus: 'PUBLISHED',
                archivedAt: null,
                deletedAt: null,
                product: { is: publicProduct },
              },
            },
          },
        ],
      },
      select: {
        objectKey: true,
        contentType: true,
        byteSize: true,
        checksumSha256: true,
      },
    });
    if (!image) throw this.publicImageNotFound();

    let bytes: Buffer;
    try {
      bytes = await this.storage.get(image.objectKey);
    } catch (error) {
      if (isMissingStorageObject(error)) throw this.publicImageNotFound();
      throw new ServiceUnavailableException({
        code: 'MEDIA_STORAGE_UNAVAILABLE',
        message: 'The product media service is temporarily unavailable.',
      });
    }
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== image.byteSize || checksum !== image.checksumSha256) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_INTEGRITY_FAILURE',
        message: 'The stored product image failed its integrity check.',
      });
    }
    return { bytes, contentType: image.contentType, byteSize: image.byteSize };
  }

  private async resolveOwner(
    client: PrismaService | Prisma.TransactionClient,
    productId: string,
    variantId?: string,
  ): Promise<MediaOwner> {
    if (variantId) {
      const variant = await client.productVariant.findFirst({
        where: {
          id: variantId,
          productId,
          deletedAt: null,
          product: { is: { deletedAt: null } },
        },
        select: { id: true, productId: true, version: true },
      });
      if (!variant) throw this.ownerNotFound();
      return {
        kind: 'variant',
        id: variant.id,
        productId: variant.productId,
        version: variant.version,
      };
    }
    const product = await client.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, version: true },
    });
    if (!product) throw this.ownerNotFound();
    return { kind: 'product', id: product.id, productId: product.id, version: product.version };
  }

  private async lockOwner(
    transaction: Prisma.TransactionClient,
    owner: MediaOwner,
    expectedVersion: number,
  ): Promise<MediaOwner> {
    if (owner.kind === 'product') {
      await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM Product WHERE id = ${owner.id} AND deletedAt IS NULL FOR UPDATE
      `);
    } else {
      await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM ProductVariant
        WHERE id = ${owner.id} AND productId = ${owner.productId} AND deletedAt IS NULL
        FOR UPDATE
      `);
    }
    const current = await this.resolveOwner(
      transaction,
      owner.productId,
      owner.kind === 'variant' ? owner.id : undefined,
    );
    this.assertVersion(current.version, expectedVersion);
    return current;
  }

  private async bumpOwner(
    transaction: Prisma.TransactionClient,
    owner: MediaOwner,
    expectedVersion: number,
  ): Promise<void> {
    const changed =
      owner.kind === 'product'
        ? await transaction.product.updateMany({
            where: { id: owner.id, deletedAt: null, version: expectedVersion },
            data: { version: { increment: 1 } },
          })
        : await transaction.productVariant.updateMany({
            where: {
              id: owner.id,
              productId: owner.productId,
              deletedAt: null,
              version: expectedVersion,
            },
            data: { version: { increment: 1 } },
          });
    if (changed.count !== 1) throw this.versionConflict();
  }

  private async findScopedImage(
    client: PrismaService | Prisma.TransactionClient,
    productId: string,
    imageId: string,
  ): Promise<AdminImageRecord> {
    const image = await client.productImage.findFirst({
      where: {
        id: imageId,
        deletedAt: null,
        OR: [
          { productId, variantId: null },
          { productId: null, variant: { is: { productId } } },
        ],
      },
      select: adminImageSelect,
    });
    if (!image) throw this.imageNotFound();
    this.ownerFromImage(image);
    return image;
  }

  private async findExactImage(
    transaction: Prisma.TransactionClient,
    imageId: string,
    owner: MediaOwner,
  ): Promise<AdminImageRecord> {
    const image = await transaction.productImage.findFirst({
      where: { id: imageId, ...this.ownerImageWhere(owner), deletedAt: null },
      select: adminImageSelect,
    });
    if (!image) throw this.imageNotFound();
    return image;
  }

  private ownerFromImage(image: AdminImageRecord): MediaOwner {
    if (image.productId && !image.variantId && image.product && !image.variant) {
      return {
        kind: 'product',
        id: image.productId,
        productId: image.productId,
        version: image.product.version,
      };
    }
    if (!image.productId && image.variantId && !image.product && image.variant) {
      return {
        kind: 'variant',
        id: image.variantId,
        productId: image.variant.productId,
        version: image.variant.version,
      };
    }
    throw new ServiceUnavailableException({
      code: 'MEDIA_OWNER_INTEGRITY_ERROR',
      message: 'The product image owner is inconsistent.',
    });
  }

  private ownerImageWhere(owner: MediaOwner): Prisma.ProductImageWhereInput {
    return owner.kind === 'product'
      ? { productId: owner.id, variantId: null }
      : { productId: null, variantId: owner.id };
  }

  private ownerData(owner: MediaOwner): { productId: string | null; variantId: string | null } {
    return owner.kind === 'product'
      ? { productId: owner.id, variantId: null }
      : { productId: null, variantId: owner.id };
  }

  private async clearPrimary(
    transaction: Prisma.TransactionClient,
    owner: MediaOwner,
  ): Promise<void> {
    await transaction.productImage.updateMany({
      where: { ...this.ownerImageWhere(owner), deletedAt: null, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  private storedObject(owner: MediaOwner, image: ValidatedProductImage) {
    const randomName = randomBytes(18).toString('hex');
    const ownerPath = owner.kind === 'product' ? 'product' : `variants/${owner.id}`;
    const objectKey = `products/${owner.productId}/${ownerPath}/${randomName}.${image.extension}`;
    return {
      objectKey,
      objectKeyHash: createHash('sha256').update(objectKey).digest('hex'),
    };
  }

  private async store(stored: { objectKey: string }, image: ValidatedProductImage): Promise<void> {
    try {
      await this.storage.put({
        objectKey: stored.objectKey,
        contentType: image.contentType,
        checksumSha256: image.checksumSha256,
        bytes: image.bytes,
      });
    } catch {
      throw new ServiceUnavailableException({
        code: 'MEDIA_STORAGE_UNAVAILABLE',
        message: 'The product media service is temporarily unavailable.',
      });
    }
  }

  private async cleanupFailedWrite(objectKey: string): Promise<void> {
    try {
      await this.storage.delete(objectKey);
    } catch {
      this.logger.warn(
        'A staged product image could not be removed after a failed database write.',
      );
    }
  }

  private async deleteStoredObject(objectKey: string): Promise<void> {
    try {
      await this.storage.delete(objectKey);
    } catch {
      // The transaction has already written a durable outbox event; the worker will retry safely.
      this.logger.warn('A soft-deleted product image remains queued for object-storage cleanup.');
    }
  }

  private enqueueObjectDeletion(
    transaction: Prisma.TransactionClient,
    image: Pick<AdminImageRecord, 'id' | 'objectKey' | 'bucket'>,
  ) {
    const deterministicKey = `media-object-delete:v1:${image.id}`;
    return transaction.outboxEvent.upsert({
      where: { deterministicKey },
      update: {},
      create: {
        deterministicKey,
        aggregateType: 'ProductImage',
        aggregateId: image.id,
        eventType: 'media.object.delete.requested',
        eventVersion: 1,
        payload: { objectKey: image.objectKey, bucket: image.bucket },
        maxAttempts: 8,
      },
    });
  }

  private serialize(record: AdminImageRecord, ownerVersion?: number) {
    const owner = this.ownerFromImage(record);
    return {
      id: record.id,
      productId: record.productId,
      variantId: record.variantId,
      url: publicProductImageUrl(record.objectKeyHash),
      contentType: record.contentType,
      byteSize: record.byteSize,
      checksumSha256: record.checksumSha256,
      width: record.width,
      height: record.height,
      altTextFr: record.altTextFr,
      altTextAr: record.altTextAr,
      sortOrder: record.sortOrder,
      isPrimary: record.isPrimary,
      moderationStatus: record.moderationStatus,
      ownerVersion: ownerVersion ?? owner.version,
      createdAt: record.createdAt.toISOString(),
    };
  }

  private assertVersion(actual: number, expected: number): void {
    if (actual !== expected) throw this.versionConflict();
  }

  private imageLimitReached(): ConflictException {
    return new ConflictException({
      code: 'PRODUCT_IMAGE_LIMIT_REACHED',
      message: `A product or variant can have at most ${MAX_IMAGES_PER_OWNER} active images.`,
    });
  }

  private ownerNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'PRODUCT_MEDIA_OWNER_NOT_FOUND',
      message: 'The requested product media owner was not found.',
    });
  }

  private imageNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'PRODUCT_IMAGE_NOT_FOUND',
      message: 'The requested product image was not found.',
    });
  }

  private publicImageNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'MEDIA_NOT_FOUND',
      message: 'The requested product media is not available.',
    });
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      code: 'PRODUCT_MEDIA_VERSION_CONFLICT',
      message: 'The product or variant changed since it was loaded. Reload it and retry.',
    });
  }
}

const auditMetadata = (context: ProductMediaMutationContext) => ({
  actorUserId: context.userId,
  actorType: 'ADMIN' as const,
  outcome: 'SUCCESS' as const,
  requestId: context.requestId,
  ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
  ...(context.userAgent ? { userAgent: context.userAgent } : {}),
});

const isMissingStorageObject = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    code?: unknown;
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    candidate.code === 'ENOENT' ||
    candidate.name === 'NoSuchKey' ||
    candidate.$metadata?.httpStatusCode === 404
  );
};
