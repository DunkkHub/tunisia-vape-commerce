import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ProductVariant } from '@prisma/client';
import type { Request } from 'express';
import { CheckoutPolicyService } from '../checkout/checkout-policy.service';
import { PrismaService } from '../database/prisma.service';
import {
  approvedPublicationImageWhere,
  availablePublicationQuantity,
  publicationInventoryWhere,
  publicationNotReady,
} from './catalog-publication-readiness';
import type { CreateProductVariantDto, UpdateProductVariantDto } from './dto/admin-variant.dto';

type CatalogDatabase = PrismaService | Prisma.TransactionClient;

const PUBLICATION_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 10_000,
} as const;

const metadata = (request: Request) => {
  const userAgent = request.get('user-agent');
  return {
    actorUserId: request.auth!.userId,
    actorType: 'ADMIN' as const,
    outcome: 'SUCCESS' as const,
    requestId: request.requestId,
    ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
    ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
};

const response = (variant: ProductVariant) => ({
  data: {
    ...variant,
    archivedAt: variant.archivedAt?.toISOString() ?? null,
    deletedAt: variant.deletedAt?.toISOString() ?? null,
    createdAt: variant.createdAt.toISOString(),
    updatedAt: variant.updatedAt.toISOString(),
    currency: 'TND' as const,
  },
});

const mutableFields = [
  'nameFr',
  'nameAr',
  'sku',
  'barcode',
  'color',
  'costMillimes',
  'priceMillimes',
  'promotionalPriceMillimes',
  'taxRateBps',
  'weightGrams',
  'lengthMm',
  'widthMm',
  'heightMm',
  'lowStockThreshold',
  'sortOrder',
  'publicationStatus',
] as const;

@Injectable()
export class AdminVariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: CheckoutPolicyService,
  ) {}

  async list(productId: string) {
    await this.requireProduct(productId);
    const variants = await this.prisma.productVariant.findMany({
      where: { productId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        attributes: {
          include: { attributeValue: { include: { attribute: true } } },
          orderBy: { attributeValueId: 'asc' },
        },
      },
    });
    return {
      data: {
        items: variants.map((variant) => ({
          ...response(variant).data,
          attributes: variant.attributes.map(({ attributeValue }) => ({
            attributeId: attributeValue.attribute.id,
            key: attributeValue.attribute.key,
            nameFr: attributeValue.attribute.nameFr,
            nameAr: attributeValue.attribute.nameAr,
            valueId: attributeValue.id,
            valueFr: attributeValue.valueFr,
            valueAr: attributeValue.valueAr,
          })),
        })),
      },
    };
  }

  async create(productId: string, input: CreateProductVariantDto, request: Request) {
    await this.requireProduct(productId);
    this.validatePrices(input.priceMillimes, input.promotionalPriceMillimes ?? null);
    const attributeIds = this.uniqueAttributes(input.attributeValueIds);
    await this.validateAttributes(productId, attributeIds);
    try {
      const variant = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.productVariant.create({
          data: {
            productId,
            nameFr: input.nameFr.trim(),
            nameAr: input.nameAr.trim(),
            sku: input.sku.trim(),
            barcode: input.barcode?.trim() || null,
            color: input.color?.trim() || null,
            costMillimes: input.costMillimes,
            priceMillimes: input.priceMillimes,
            promotionalPriceMillimes: input.promotionalPriceMillimes ?? null,
            taxRateBps: input.taxRateBps ?? 0,
            weightGrams: input.weightGrams ?? 0,
            lengthMm: input.lengthMm ?? null,
            widthMm: input.widthMm ?? null,
            heightMm: input.heightMm ?? null,
            lowStockThreshold: input.lowStockThreshold ?? 0,
            sortOrder: input.sortOrder ?? 0,
            publicationStatus: 'DRAFT',
          },
        });
        if (attributeIds.length > 0) {
          await transaction.productVariantAttribute.createMany({
            data: attributeIds.map((attributeValueId) => ({
              variantId: created.id,
              attributeValueId,
            })),
          });
        }
        await transaction.auditLog.create({
          data: {
            ...metadata(request),
            action: 'catalog.variant.create',
            resourceType: 'ProductVariant',
            resourceId: created.id,
            afterSummary: {
              productId,
              sku: created.sku,
              publicationStatus: created.publicationStatus,
              priceMillimes: created.priceMillimes,
              attributeValueIds: attributeIds,
              version: created.version,
            },
          },
        });
        return created;
      });
      return response(variant);
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async update(
    productId: string,
    variantId: string,
    input: UpdateProductVariantDto,
    request: Request,
  ) {
    const current = await this.requireVariant(productId, variantId);
    if (current.archivedAt) throw this.archivedConflict();
    if (
      !mutableFields.some((field) => input[field] !== undefined) &&
      input.attributeValueIds === undefined
    ) {
      throw new BadRequestException({
        code: 'NO_VARIANT_CHANGES',
        message: 'At least one variant field must be changed.',
      });
    }
    if (current.version !== input.version) throw this.versionConflict();
    const price = input.priceMillimes ?? current.priceMillimes;
    const promotion =
      input.promotionalPriceMillimes === undefined
        ? current.promotionalPriceMillimes
        : input.promotionalPriceMillimes;
    this.validatePrices(price, promotion);
    const sku = input.sku === undefined ? current.sku : input.sku.trim();
    const targetStatus = input.publicationStatus ?? current.publicationStatus;
    if (targetStatus === 'PUBLISHED') {
      if (current.publicationStatus === 'PUBLISHED') {
        this.validatePublishedUpdate(sku, price, promotion);
      } else {
        await this.validatePublication(productId, variantId, sku, price, promotion);
      }
    }
    const attributeIds =
      input.attributeValueIds === undefined
        ? undefined
        : this.uniqueAttributes(input.attributeValueIds);
    if (attributeIds) await this.validateAttributes(productId, attributeIds);
    const data: Prisma.ProductVariantUncheckedUpdateManyInput = { version: { increment: 1 } };
    for (const field of mutableFields) {
      const value = input[field];
      if (value !== undefined) {
        (data as Record<string, unknown>)[field] =
          typeof value === 'string' ? value.trim() || null : value;
      }
    }
    if (input.publicationStatus === 'PUBLISHED') data.archivedAt = null;

    try {
      const variant = await this.prisma.$transaction(
        async (transaction) => {
          if (targetStatus === 'PUBLISHED') {
            await this.lockPublicationOwner(transaction, productId, variantId, input.version);
            if (current.publicationStatus === 'PUBLISHED') {
              this.validatePublishedUpdate(sku, price, promotion);
            } else {
              await this.validatePublication(
                productId,
                variantId,
                sku,
                price,
                promotion,
                transaction,
              );
            }
          }

          const updated = await transaction.productVariant.updateMany({
            where: { id: variantId, productId, version: input.version, deletedAt: null },
            data,
          });
          if (updated.count !== 1) throw this.versionConflict();
          if (attributeIds) {
            await transaction.productVariantAttribute.deleteMany({ where: { variantId } });
            if (attributeIds.length > 0) {
              await transaction.productVariantAttribute.createMany({
                data: attributeIds.map((attributeValueId) => ({ variantId, attributeValueId })),
              });
            }
          }
          const changed = await transaction.productVariant.findUnique({
            where: { id: variantId },
          });
          if (!changed) throw this.notFound();
          await transaction.auditLog.create({
            data: {
              ...metadata(request),
              action: 'catalog.variant.update',
              resourceType: 'ProductVariant',
              resourceId: variantId,
              beforeSummary: {
                sku: current.sku,
                priceMillimes: current.priceMillimes,
                promotionalPriceMillimes: current.promotionalPriceMillimes,
                publicationStatus: current.publicationStatus,
                version: current.version,
              },
              afterSummary: {
                sku: changed.sku,
                priceMillimes: changed.priceMillimes,
                promotionalPriceMillimes: changed.promotionalPriceMillimes,
                publicationStatus: changed.publicationStatus,
                attributeValueIds: attributeIds,
                version: changed.version,
              },
            },
          });
          return changed;
        },
        targetStatus === 'PUBLISHED' ? PUBLICATION_TRANSACTION_OPTIONS : undefined,
      );
      return response(variant);
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  archive(productId: string, variantId: string, version: number, request: Request) {
    return this.changeArchive(productId, variantId, version, true, request);
  }

  restore(productId: string, variantId: string, version: number, request: Request) {
    return this.changeArchive(productId, variantId, version, false, request);
  }

  private async changeArchive(
    productId: string,
    variantId: string,
    version: number,
    archive: boolean,
    request: Request,
  ) {
    const current = await this.requireVariant(productId, variantId);
    if (current.version !== version) throw this.versionConflict();
    if (Boolean(current.archivedAt) === archive) {
      throw new ConflictException({
        code: archive ? 'VARIANT_ALREADY_ARCHIVED' : 'VARIANT_NOT_ARCHIVED',
        message: archive
          ? 'The variant is already archived.'
          : 'Only an archived variant can be restored.',
      });
    }
    const changed = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.productVariant.updateMany({
        where: { id: variantId, productId, version, deletedAt: null },
        data: {
          archivedAt: archive ? new Date() : null,
          publicationStatus: 'DRAFT',
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw this.versionConflict();
      const variant = await transaction.productVariant.findUnique({ where: { id: variantId } });
      if (!variant) throw this.notFound();
      await transaction.auditLog.create({
        data: {
          ...metadata(request),
          action: archive ? 'catalog.variant.archive' : 'catalog.variant.restore',
          resourceType: 'ProductVariant',
          resourceId: variantId,
          beforeSummary: {
            archived: Boolean(current.archivedAt),
            publicationStatus: current.publicationStatus,
            version: current.version,
          },
          afterSummary: {
            archived: Boolean(variant.archivedAt),
            publicationStatus: variant.publicationStatus,
            version: variant.version,
          },
        },
      });
      return variant;
    });
    return response(changed);
  }

  private async requireProduct(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, archivedAt: true },
    });
    if (!product) throw this.notFound();
    if (product.archivedAt) {
      throw new ConflictException({
        code: 'PRODUCT_ARCHIVED',
        message: 'Restore the product before managing variants.',
      });
    }
    return product;
  }

  private async requireVariant(productId: string, variantId: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, deletedAt: null },
    });
    if (!variant) throw this.notFound();
    return variant;
  }

  private uniqueAttributes(ids?: string[]): string[] {
    return [...new Set(ids ?? [])].sort();
  }

  private async validateAttributes(productId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const values = await this.prisma.productAttributeValue.findMany({
      where: { id: { in: ids }, attribute: { productId } },
      select: { id: true, attributeId: true },
    });
    if (
      values.length !== ids.length ||
      new Set(values.map((value) => value.attributeId)).size !== values.length
    ) {
      throw new BadRequestException({
        code: 'INVALID_VARIANT_ATTRIBUTES',
        message:
          'Every attribute value must belong to this product and each attribute may be selected once.',
      });
    }
  }

  private async validatePublication(
    productId: string,
    variantId: string,
    sku: string,
    price: number,
    promotionalPrice: number | null,
    database: CatalogDatabase = this.prisma,
  ): Promise<void> {
    const now = new Date();
    const [
      product,
      duplicateSku,
      inventoryItems,
      imageCount,
      unresolvedImageCount,
      deliveryBlocker,
    ] = await Promise.all([
      database.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: {
          id: true,
          archivedAt: true,
          requiresPricing: true,
          requiresStock: true,
          needsMediaReview: true,
        },
      }),
      database.productVariant.findFirst({
        where: { id: { not: variantId }, sku },
        select: { id: true },
      }),
      database.inventoryItem.findMany({
        where: { variantId, ...publicationInventoryWhere(now) },
        select: {
          onHandQuantity: true,
          reservations: {
            where: { state: 'ACTIVE', expiresAt: { gt: now } },
            select: { quantity: true },
          },
        },
      }),
      database.productImage.count({
        where: {
          ...approvedPublicationImageWhere,
          OR: [
            { productId, variantId: null },
            { productId: null, variantId },
          ],
        },
      }),
      database.productImage.count({
        where: {
          deletedAt: null,
          moderationStatus: { in: ['PENDING', 'QUARANTINED'] },
          OR: [
            { productId, variantId: null },
            { productId: null, variant: { is: { productId, deletedAt: null } } },
          ],
        },
      }),
      this.deliveryPublicationBlocker(database, now),
    ]);
    if (!product) throw this.notFound();
    if (product.archivedAt) {
      throw new ConflictException({
        code: 'PRODUCT_ARCHIVED',
        message: 'Restore the product before publishing a variant.',
      });
    }

    const blockers: string[] = [];
    const availableQuantity = availablePublicationQuantity(inventoryItems);
    if (product.requiresPricing && price <= 0) blockers.push('PRICING_REVIEW_REQUIRED');
    if (product.requiresStock && availableQuantity <= 0) blockers.push('STOCK_REVIEW_REQUIRED');
    if (product.needsMediaReview && imageCount === 0) blockers.push('MEDIA_REVIEW_REQUIRED');
    if (unresolvedImageCount > 0) blockers.push('MEDIA_REVIEW_PENDING');
    if (product.needsMediaReview) blockers.push('MEDIA_REVIEW_CONFIRMATION_REQUIRED');
    if (!sku.trim()) blockers.push('VARIANT_SKU_INVALID');
    if (duplicateSku) blockers.push('VARIANT_SKU_DUPLICATE');
    if (price <= 0 || (promotionalPrice !== null && promotionalPrice <= 0)) {
      blockers.push('NON_POSITIVE_PRICE');
    }
    if (availableQuantity <= 0) {
      blockers.push('AVAILABLE_STOCK_MISSING');
    }
    if (imageCount === 0) blockers.push('APPROVED_IMAGE_MISSING');
    if (deliveryBlocker) blockers.push(deliveryBlocker);
    if (blockers.length > 0) throw publicationNotReady('variant', blockers);
  }

  private async lockPublicationOwner(
    transaction: Prisma.TransactionClient,
    productId: string,
    variantId: string,
    version: number,
  ): Promise<void> {
    const product = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM Product
      WHERE id = ${productId} AND deletedAt IS NULL
      FOR UPDATE
    `);
    if (product.length !== 1) throw this.notFound();
    const variant = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM ProductVariant
      WHERE id = ${variantId}
        AND productId = ${productId}
        AND version = ${version}
        AND deletedAt IS NULL
      FOR UPDATE
    `);
    if (variant.length !== 1) throw this.versionConflict();
  }

  private async deliveryPublicationBlocker(
    database: CatalogDatabase,
    now: Date,
  ): Promise<'DELIVERY_METHOD_MISSING' | null> {
    const policy = await this.policies.evaluate(now, database);
    return policy.blockers.includes('DELIVERY_METHOD_MISSING') ? 'DELIVERY_METHOD_MISSING' : null;
  }

  private validatePrices(price: number, promotion: number | null): void {
    if (promotion !== null && promotion > price) {
      throw new BadRequestException({
        code: 'INVALID_PROMOTIONAL_PRICE',
        message: 'The promotional price cannot exceed the regular variant price.',
      });
    }
  }

  private validatePublishedUpdate(sku: string, price: number, promotion: number | null): void {
    const blockers: string[] = [];
    if (!sku.trim()) blockers.push('VARIANT_SKU_INVALID');
    if (price <= 0 || (promotion !== null && promotion <= 0)) {
      blockers.push('NON_POSITIVE_PRICE');
    }
    if (blockers.length > 0) throw publicationNotReady('variant', blockers);
  }

  private rethrowUnique(error: unknown): never {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') {
      throw this.versionConflict();
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException({
        code: 'VARIANT_IDENTIFIER_CONFLICT',
        message: 'The SKU or barcode is already assigned to another variant.',
      });
    }
    throw error;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'PRODUCT_VARIANT_NOT_FOUND',
      message: 'The requested product or variant does not exist.',
    });
  }

  private archivedConflict(): ConflictException {
    return new ConflictException({
      code: 'VARIANT_ARCHIVED',
      message: 'Restore the variant before editing it.',
    });
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: 'The variant changed since it was loaded. Reload it and retry.',
    });
  }
}
