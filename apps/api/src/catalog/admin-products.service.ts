import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Product } from '@prisma/client';
import { CheckoutPolicyService } from '../checkout/checkout-policy.service';
import { PrismaService } from '../database/prisma.service';
import {
  approvedPublicationImageWhere,
  availablePublicationQuantity,
  publicationInventoryWhere,
  publicationNotReady,
} from './catalog-publication-readiness';
import type {
  AdminProductListQueryDto,
  ConfirmProductMediaReviewDto,
  CreateProductDto,
  MutablePublicationStatus,
  UpdateProductDto,
} from './dto/admin-product.dto';

export interface AdminMutationContext {
  userId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

type CatalogDatabase = PrismaService | Prisma.TransactionClient;

const PUBLICATION_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 10_000,
} as const;

const isTransactionConflict = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034';

const mutableProductFields = [
  'categoryId',
  'brandId',
  'nameFr',
  'nameAr',
  'slug',
  'productType',
  'sku',
  'barcode',
  'shortDescriptionFr',
  'shortDescriptionAr',
  'descriptionFr',
  'descriptionAr',
  'containsNicotine',
  'flavor',
  'deviceType',
  'puffCount',
  'deviceCompatibility',
  'baseCostMillimes',
  'basePriceMillimes',
  'promotionalPriceMillimes',
  'taxCategory',
  'taxRateBps',
  'warningFr',
  'warningAr',
  'minimumAge',
  'featured',
] as const;

const adminProductResponse = (product: Product) => ({
  data: {
    id: product.id,
    categoryId: product.categoryId,
    brandId: product.brandId,
    nameFr: product.nameFr,
    nameAr: product.nameAr,
    slug: product.slug,
    sku: product.sku,
    barcode: product.barcode,
    productType: product.productType,
    shortDescriptionFr: product.shortDescriptionFr,
    shortDescriptionAr: product.shortDescriptionAr,
    descriptionFr: product.descriptionFr,
    descriptionAr: product.descriptionAr,
    containsNicotine: product.containsNicotine,
    flavor: product.flavor,
    deviceType: product.deviceType,
    puffCount: product.puffCount,
    deviceCompatibility: product.deviceCompatibility,
    baseCostMillimes: product.baseCostMillimes,
    basePriceMillimes: product.basePriceMillimes,
    promotionalPriceMillimes: product.promotionalPriceMillimes,
    taxCategory: product.taxCategory,
    taxRateBps: product.taxRateBps,
    warningFr: product.warningFr,
    warningAr: product.warningAr,
    minimumAge: product.minimumAge,
    publicationStatus: product.publicationStatus,
    featured: product.featured,
    requiresPricing: product.requiresPricing,
    requiresStock: product.requiresStock,
    needsMediaReview: product.needsMediaReview,
    publishedAt: product.publishedAt?.toISOString() ?? null,
    suspendedAt: product.suspendedAt?.toISOString() ?? null,
    archivedAt: product.archivedAt?.toISOString() ?? null,
    version: product.version,
    currency: 'TND' as const,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  },
});

const adminProductListSelect = (now: Date) =>
  ({
    id: true,
    nameFr: true,
    nameAr: true,
    slug: true,
    sku: true,
    productType: true,
    flavor: true,
    publicationStatus: true,
    basePriceMillimes: true,
    promotionalPriceMillimes: true,
    version: true,
    createdAt: true,
    updatedAt: true,
    brand: { select: { name: true } },
    variants: {
      where: { archivedAt: null, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        sku: true,
        priceMillimes: true,
        promotionalPriceMillimes: true,
        inventoryItems: {
          where: {
            OR: [
              { batchId: null },
              { batch: { is: { OR: [{ expiryDate: null }, { expiryDate: { gt: now } }] } } },
            ],
          },
          select: {
            onHandQuantity: true,
            reservations: {
              where: { state: 'ACTIVE', expiresAt: { gt: now } },
              select: { quantity: true },
            },
          },
        },
      },
    },
  }) satisfies Prisma.ProductSelect;

type AdminProductListRecord = Prisma.ProductGetPayload<{
  select: ReturnType<typeof adminProductListSelect>;
}>;

const availableAdminQuantity = (product: AdminProductListRecord): number =>
  product.variants.reduce(
    (productTotal, variant) =>
      productTotal +
      variant.inventoryItems.reduce((variantTotal, inventory) => {
        const reserved = inventory.reservations.reduce(
          (total, reservation) => total + reservation.quantity,
          0,
        );
        return variantTotal + Math.max(0, inventory.onHandQuantity - reserved);
      }, 0),
    0,
  );

const adminSellingPrice = (product: AdminProductListRecord): number | null => {
  const prices: number[] = [];
  if (product.basePriceMillimes !== null) {
    prices.push(
      product.promotionalPriceMillimes !== null &&
        product.promotionalPriceMillimes <= product.basePriceMillimes
        ? product.promotionalPriceMillimes
        : product.basePriceMillimes,
    );
  }
  for (const variant of product.variants) {
    prices.push(
      variant.promotionalPriceMillimes !== null &&
        variant.promotionalPriceMillimes <= variant.priceMillimes
        ? variant.promotionalPriceMillimes
        : variant.priceMillimes,
    );
  }
  return prices.length > 0 ? Math.min(...prices) : null;
};

const auditMetadata = (context: AdminMutationContext) => ({
  actorUserId: context.userId,
  actorType: 'ADMIN' as const,
  outcome: 'SUCCESS' as const,
  requestId: context.requestId,
  ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
  ...(context.userAgent ? { userAgent: context.userAgent } : {}),
});

@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: CheckoutPolicyService,
  ) {}

  async list(query: AdminProductListQueryDto, locale: 'fr' | 'ar') {
    const page = query.page;
    const pageSize = query.limit;
    const search = query.q?.trim().replace(/\s+/g, ' ');
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { nameFr: { contains: search } },
              { nameAr: { contains: search } },
              { slug: { contains: search } },
              { sku: { contains: search } },
              { barcode: { contains: search } },
              { variants: { some: { sku: { contains: search }, deletedAt: null } } },
            ],
          }
        : {}),
    };
    const now = new Date();
    const [records, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: adminProductListSelect(now),
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: {
        items: records.map((product) => ({
          id: product.id,
          sku: product.sku ?? product.variants[0]?.sku ?? null,
          name: locale === 'ar' ? product.nameAr : product.nameFr,
          slug: product.slug,
          brandName: product.brand?.name ?? null,
          productType: product.productType,
          flavor: product.flavor,
          publicationStatus: product.publicationStatus,
          availableQuantity: availableAdminQuantity(product),
          sellingPriceMillimes: adminSellingPrice(product),
          version: product.version,
          createdAt: product.createdAt.toISOString(),
          updatedAt: product.updatedAt.toISOString(),
        })),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async get(id: string) {
    this.assertId(id);
    return adminProductResponse(await this.findCurrent(id));
  }

  async create(input: CreateProductDto, context: AdminMutationContext) {
    this.validatePrices(input.basePriceMillimes ?? null, input.promotionalPriceMillimes ?? null);
    await this.ensureReferences(input.categoryId, input.brandId ?? null, false);

    const data: Prisma.ProductUncheckedCreateInput = {
      categoryId: input.categoryId,
      brandId: input.brandId ?? null,
      nameFr: input.nameFr.trim(),
      nameAr: input.nameAr.trim(),
      slug: input.slug,
      productType: input.productType,
      publicationStatus: 'DRAFT',
      ...(input.sku === undefined ? {} : { sku: input.sku?.trim() || null }),
      ...(input.barcode === undefined ? {} : { barcode: input.barcode?.trim() || null }),
      ...(input.shortDescriptionFr === undefined
        ? {}
        : { shortDescriptionFr: input.shortDescriptionFr?.trim() || null }),
      ...(input.shortDescriptionAr === undefined
        ? {}
        : { shortDescriptionAr: input.shortDescriptionAr?.trim() || null }),
      ...(input.descriptionFr === undefined
        ? {}
        : { descriptionFr: input.descriptionFr?.trim() || null }),
      ...(input.descriptionAr === undefined
        ? {}
        : { descriptionAr: input.descriptionAr?.trim() || null }),
      ...(input.containsNicotine === undefined ? {} : { containsNicotine: input.containsNicotine }),
      ...(input.flavor === undefined ? {} : { flavor: input.flavor?.trim() || null }),
      ...(input.deviceType === undefined ? {} : { deviceType: input.deviceType?.trim() || null }),
      ...(input.puffCount === undefined ? {} : { puffCount: input.puffCount }),
      ...(input.deviceCompatibility === undefined
        ? {}
        : { deviceCompatibility: input.deviceCompatibility?.trim() || null }),
      ...(input.baseCostMillimes === undefined ? {} : { baseCostMillimes: input.baseCostMillimes }),
      ...(input.basePriceMillimes === undefined
        ? {}
        : { basePriceMillimes: input.basePriceMillimes }),
      ...(input.promotionalPriceMillimes === undefined
        ? {}
        : { promotionalPriceMillimes: input.promotionalPriceMillimes }),
      ...(input.taxCategory === undefined
        ? {}
        : { taxCategory: input.taxCategory?.trim() || null }),
      ...(input.taxRateBps === undefined ? {} : { taxRateBps: input.taxRateBps }),
      ...(input.warningFr === undefined ? {} : { warningFr: input.warningFr?.trim() || null }),
      ...(input.warningAr === undefined ? {} : { warningAr: input.warningAr?.trim() || null }),
      ...(input.minimumAge === undefined ? {} : { minimumAge: input.minimumAge }),
      ...(input.featured === undefined ? {} : { featured: input.featured }),
    };

    try {
      const product = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.product.create({ data });
        await transaction.auditLog.create({
          data: {
            ...auditMetadata(context),
            action: 'catalog.product.create',
            resourceType: 'Product',
            resourceId: created.id,
            afterSummary: {
              slug: created.slug,
              categoryId: created.categoryId,
              publicationStatus: created.publicationStatus,
              version: created.version,
            },
          },
        });
        return created;
      });
      return adminProductResponse(product);
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async update(id: string, input: UpdateProductDto, context: AdminMutationContext) {
    this.assertId(id);
    if (
      !mutableProductFields.some((field) => input[field] !== undefined) &&
      !input.publicationStatus &&
      input.mediaReviewConfirmed !== true
    ) {
      throw new BadRequestException({
        code: 'NO_PRODUCT_CHANGES',
        message: 'At least one product field must be changed.',
      });
    }

    const current = await this.findCurrent(id);
    this.assertVersion(current.version, input.version);
    if (current.publicationStatus === 'ARCHIVED') {
      throw new ConflictException({
        code: 'PRODUCT_ARCHIVED',
        message: 'Restore the archived product before editing it.',
      });
    }
    const categoryId = input.categoryId ?? current.categoryId;
    const brandId = input.brandId === undefined ? current.brandId : input.brandId;
    const targetStatus = input.publicationStatus ?? current.publicationStatus;
    if (
      input.mediaReviewConfirmed === true &&
      (targetStatus !== 'PUBLISHED' || !current.needsMediaReview)
    ) {
      throw new BadRequestException({
        code: 'MEDIA_REVIEW_CONFIRMATION_NOT_APPLICABLE',
        message: 'Media review confirmation is accepted only when a flagged product is published.',
      });
    }
    await this.ensureReferences(categoryId, brandId, targetStatus === 'PUBLISHED');

    const basePrice =
      input.basePriceMillimes === undefined ? current.basePriceMillimes : input.basePriceMillimes;
    const promotionalPrice =
      input.promotionalPriceMillimes === undefined
        ? current.promotionalPriceMillimes
        : input.promotionalPriceMillimes;
    this.validatePrices(basePrice, promotionalPrice);
    if (targetStatus === 'PUBLISHED') {
      if (current.publicationStatus === 'PUBLISHED') {
        await this.validateMediaReview(current, input.mediaReviewConfirmed === true);
        await this.validatePublishedUpdate(current, basePrice, promotionalPrice);
      } else {
        await this.validatePublication(
          current,
          basePrice,
          promotionalPrice,
          input.mediaReviewConfirmed === true,
        );
      }
    }

    const data = this.buildUpdateData(input, current);
    let updated: Product;
    try {
      updated = await this.prisma.$transaction(
        async (transaction) => {
          if (targetStatus === 'PUBLISHED') {
            await this.lockProductForUpdate(transaction, id, input.version);
            await this.ensureReferences(categoryId, brandId, true, transaction);
            if (current.publicationStatus === 'PUBLISHED') {
              await this.validateMediaReview(
                current,
                input.mediaReviewConfirmed === true,
                transaction,
              );
              await this.validatePublishedUpdate(current, basePrice, promotionalPrice, transaction);
            } else {
              await this.validatePublication(
                current,
                basePrice,
                promotionalPrice,
                input.mediaReviewConfirmed === true,
                transaction,
              );
            }
          }

          const result = await transaction.product.updateMany({
            where: { id, version: input.version, deletedAt: null },
            data,
          });
          if (result.count !== 1) throw this.versionConflict();
          const product = await transaction.product.findUnique({ where: { id } });
          if (!product) throw this.productNotFound();
          await transaction.auditLog.create({
            data: {
              ...auditMetadata(context),
              action: 'catalog.product.update',
              resourceType: 'Product',
              resourceId: id,
              beforeSummary: {
                publicationStatus: current.publicationStatus,
                basePriceMillimes: current.basePriceMillimes,
                promotionalPriceMillimes: current.promotionalPriceMillimes,
                needsMediaReview: current.needsMediaReview,
                version: current.version,
              },
              afterSummary: {
                publicationStatus: product.publicationStatus,
                basePriceMillimes: product.basePriceMillimes,
                promotionalPriceMillimes: product.promotionalPriceMillimes,
                needsMediaReview: product.needsMediaReview,
                mediaReviewConfirmed: input.mediaReviewConfirmed === true,
                version: product.version,
              },
            },
          });
          return product;
        },
        targetStatus === 'PUBLISHED' ? PUBLICATION_TRANSACTION_OPTIONS : undefined,
      );
    } catch (error) {
      if (isTransactionConflict(error)) throw this.versionConflict();
      this.rethrowUnique(error);
    }
    return adminProductResponse(updated);
  }

  async confirmMediaReview(
    id: string,
    input: ConfirmProductMediaReviewDto,
    context: AdminMutationContext,
  ) {
    this.assertId(id);
    const preflight = await this.findCurrent(id);
    this.assertVersion(preflight.version, input.version);
    const reason = input.reason.trim();
    if (reason.length < 4) {
      throw new BadRequestException({
        code: 'MEDIA_REVIEW_REASON_INVALID',
        message: 'A meaningful media review reason is required.',
      });
    }

    let confirmed: Product;
    try {
      confirmed = await this.prisma.$transaction(async (transaction) => {
        await this.lockProductForUpdate(transaction, id, input.version);
        const current = await transaction.product.findFirst({
          where: { id, deletedAt: null },
        });
        if (!current) throw this.productNotFound();
        if (current.publicationStatus !== 'DRAFT') {
          throw new ConflictException({
            code: 'PRODUCT_MEDIA_REVIEW_REQUIRES_DRAFT',
            message: 'Media review must be confirmed while the product remains a draft.',
          });
        }
        if (!current.needsMediaReview) {
          throw new ConflictException({
            code: 'PRODUCT_MEDIA_REVIEW_NOT_REQUIRED',
            message: 'This product does not have an open media review.',
          });
        }

        const ownerWhere: Prisma.ProductImageWhereInput['OR'] = [
          { productId: id, variantId: null },
          { productId: null, variant: { is: { productId: id, deletedAt: null } } },
        ];
        const eligibleOwnerWhere: Prisma.ProductImageWhereInput['OR'] = [
          { productId: id, variantId: null },
          {
            productId: null,
            variant: {
              is: {
                productId: id,
                publicationStatus: { in: ['DRAFT', 'PUBLISHED'] },
                archivedAt: null,
                deletedAt: null,
              },
            },
          },
        ];
        const [unresolvedImageCount, approvedImageCount] = await Promise.all([
          transaction.productImage.count({
            where: {
              deletedAt: null,
              moderationStatus: { in: ['PENDING', 'QUARANTINED'] },
              OR: ownerWhere,
            },
          }),
          transaction.productImage.count({
            where: {
              ...approvedPublicationImageWhere,
              OR: eligibleOwnerWhere,
            },
          }),
        ]);
        const blockers: string[] = [];
        if (unresolvedImageCount > 0) blockers.push('MEDIA_REVIEW_PENDING');
        if (approvedImageCount === 0) blockers.push('APPROVED_IMAGE_MISSING');
        if (blockers.length > 0) {
          throw new ConflictException({
            code: 'PRODUCT_MEDIA_REVIEW_NOT_READY',
            message:
              'Resolve every pending media item and retain an approved eligible image before confirming review.',
            blockers,
          });
        }

        const result = await transaction.product.updateMany({
          where: {
            id,
            version: input.version,
            publicationStatus: 'DRAFT',
            needsMediaReview: true,
            deletedAt: null,
          },
          data: { needsMediaReview: false, version: { increment: 1 } },
        });
        if (result.count !== 1) throw this.versionConflict();
        const product = await transaction.product.findUnique({ where: { id } });
        if (!product) throw this.productNotFound();
        await transaction.auditLog.create({
          data: {
            ...auditMetadata(context),
            action: 'catalog.product.media_review.confirm',
            resourceType: 'Product',
            resourceId: id,
            beforeSummary: {
              publicationStatus: current.publicationStatus,
              needsMediaReview: current.needsMediaReview,
              version: current.version,
            },
            afterSummary: {
              publicationStatus: product.publicationStatus,
              needsMediaReview: product.needsMediaReview,
              approvedImageCount,
              unresolvedImageCount,
              reason,
              version: product.version,
            },
          },
        });
        return product;
      }, PUBLICATION_TRANSACTION_OPTIONS);
    } catch (error) {
      if (isTransactionConflict(error)) throw this.versionConflict();
      throw error;
    }
    return adminProductResponse(confirmed);
  }

  async archive(id: string, version: number, context: AdminMutationContext) {
    return this.changeArchiveState(id, version, 'ARCHIVED', context);
  }

  async restore(id: string, version: number, context: AdminMutationContext) {
    return this.changeArchiveState(id, version, 'DRAFT', context);
  }

  private async changeArchiveState(
    id: string,
    version: number,
    target: 'ARCHIVED' | 'DRAFT',
    context: AdminMutationContext,
  ) {
    this.assertId(id);
    const current = await this.findCurrent(id);
    this.assertVersion(current.version, version);
    if (target === 'ARCHIVED' && current.publicationStatus === 'ARCHIVED') {
      throw new ConflictException({
        code: 'PRODUCT_ALREADY_ARCHIVED',
        message: 'The product is already archived.',
      });
    }
    if (target === 'DRAFT' && current.publicationStatus !== 'ARCHIVED') {
      throw new ConflictException({
        code: 'PRODUCT_NOT_ARCHIVED',
        message: 'Only an archived product can be restored.',
      });
    }
    const now = new Date();
    const product = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.product.updateMany({
        where: { id, version, deletedAt: null },
        data: {
          publicationStatus: target,
          archivedAt: target === 'ARCHIVED' ? now : null,
          suspendedAt: null,
          ...(target === 'DRAFT' ? { publishedAt: null } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw this.versionConflict();
      const changed = await transaction.product.findUnique({ where: { id } });
      if (!changed) throw this.productNotFound();
      await transaction.auditLog.create({
        data: {
          ...auditMetadata(context),
          action: target === 'ARCHIVED' ? 'catalog.product.archive' : 'catalog.product.restore',
          resourceType: 'Product',
          resourceId: id,
          beforeSummary: {
            publicationStatus: current.publicationStatus,
            version: current.version,
          },
          afterSummary: {
            publicationStatus: changed.publicationStatus,
            version: changed.version,
          },
        },
      });
      return changed;
    });
    return adminProductResponse(product);
  }

  private buildUpdateData(
    input: UpdateProductDto,
    current: Product,
  ): Prisma.ProductUncheckedUpdateManyInput {
    const data: Prisma.ProductUncheckedUpdateManyInput = { version: { increment: 1 } };
    for (const field of mutableProductFields) {
      const value = input[field];
      if (value !== undefined) {
        (data as Record<string, unknown>)[field] =
          typeof value === 'string' && field !== 'slug' && field !== 'categoryId'
            ? value.trim() || null
            : value;
      }
    }
    if (input.publicationStatus) {
      data.publicationStatus = input.publicationStatus;
      this.applyPublicationTimestamps(data, input.publicationStatus, current);
      if (input.publicationStatus === 'PUBLISHED') {
        data.requiresPricing = false;
        data.requiresStock = false;
        data.needsMediaReview = false;
      }
    }
    if (
      input.mediaReviewConfirmed === true &&
      current.publicationStatus === 'PUBLISHED' &&
      !input.publicationStatus
    ) {
      data.needsMediaReview = false;
    }
    return data;
  }

  private applyPublicationTimestamps(
    data: Prisma.ProductUncheckedUpdateManyInput,
    status: MutablePublicationStatus,
    current: Product,
  ): void {
    if (status === 'PUBLISHED') {
      data.publishedAt = current.publishedAt ?? new Date();
      data.suspendedAt = null;
      data.archivedAt = null;
    } else if (status === 'SUSPENDED') {
      data.suspendedAt = new Date();
      data.archivedAt = null;
    } else {
      data.publishedAt = null;
      data.suspendedAt = null;
      data.archivedAt = null;
    }
  }

  private async validatePublication(
    current: Product,
    basePrice: number | null,
    promotionalPrice: number | null,
    mediaReviewConfirmed: boolean,
    database: CatalogDatabase = this.prisma,
  ): Promise<void> {
    const now = new Date();
    const [variants, productImageCount, unresolvedImageCount, deliveryBlocker] = await Promise.all([
      database.productVariant.findMany({
        where: {
          productId: current.id,
          publicationStatus: 'PUBLISHED',
          archivedAt: null,
          deletedAt: null,
        },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          sku: true,
          priceMillimes: true,
          promotionalPriceMillimes: true,
          images: {
            where: approvedPublicationImageWhere,
            take: 1,
            select: { id: true },
          },
          inventoryItems: {
            where: publicationInventoryWhere(now),
            select: {
              onHandQuantity: true,
              reservations: {
                where: { state: 'ACTIVE', expiresAt: { gt: now } },
                select: { quantity: true },
              },
            },
          },
        },
      }),
      database.productImage.count({
        where: {
          productId: current.id,
          variantId: null,
          ...approvedPublicationImageWhere,
        },
      }),
      database.productImage.count({
        where: {
          deletedAt: null,
          moderationStatus: { in: ['PENDING', 'QUARANTINED'] },
          OR: [
            { productId: current.id, variantId: null },
            { productId: null, variant: { is: { productId: current.id, deletedAt: null } } },
          ],
        },
      }),
      this.deliveryPublicationBlocker(database, now),
    ]);

    const hasApprovedImage =
      productImageCount > 0 || variants.some((variant) => variant.images.length > 0);
    const hasPositivePrice =
      (basePrice !== null && basePrice > 0) ||
      variants.some((variant) => variant.priceMillimes > 0);
    const totalAvailableQuantity = variants.reduce(
      (total, variant) => total + availablePublicationQuantity(variant.inventoryItems),
      0,
    );
    const blockers: string[] = [];
    if (current.requiresPricing && !hasPositivePrice) blockers.push('PRICING_REVIEW_REQUIRED');
    if (current.requiresStock && totalAvailableQuantity <= 0) {
      blockers.push('STOCK_REVIEW_REQUIRED');
    }
    if (current.needsMediaReview && !hasApprovedImage) blockers.push('MEDIA_REVIEW_REQUIRED');
    if (unresolvedImageCount > 0) blockers.push('MEDIA_REVIEW_PENDING');
    if (current.needsMediaReview && !mediaReviewConfirmed) {
      blockers.push('MEDIA_REVIEW_CONFIRMATION_REQUIRED');
    }
    if (variants.length === 0) blockers.push('SELLABLE_VARIANT_MISSING');
    if (
      (basePrice !== null && basePrice <= 0) ||
      (promotionalPrice !== null && promotionalPrice <= 0)
    ) {
      blockers.push('NON_POSITIVE_PRICE');
    }

    const skus = new Set<string>();
    for (const variant of variants) {
      const normalizedSku = variant.sku.trim().toLocaleLowerCase('en-US');
      if (!normalizedSku) {
        blockers.push('VARIANT_SKU_INVALID');
      } else if (skus.has(normalizedSku)) {
        blockers.push('VARIANT_SKU_DUPLICATE');
      } else {
        skus.add(normalizedSku);
      }
      if (
        variant.priceMillimes <= 0 ||
        (variant.promotionalPriceMillimes !== null && variant.promotionalPriceMillimes <= 0)
      ) {
        blockers.push('NON_POSITIVE_PRICE');
      }
      const variantAvailableQuantity = availablePublicationQuantity(variant.inventoryItems);
      if (variantAvailableQuantity <= 0) {
        blockers.push('AVAILABLE_STOCK_MISSING');
      }
    }

    if (!hasApprovedImage) {
      blockers.push('APPROVED_IMAGE_MISSING');
    }
    if (deliveryBlocker) blockers.push(deliveryBlocker);
    if (blockers.length > 0) throw publicationNotReady('product', blockers);
  }

  private async validateMediaReview(
    current: Product,
    confirmed: boolean,
    database: CatalogDatabase = this.prisma,
  ): Promise<void> {
    const unresolvedOwnerWhere: Prisma.ProductImageWhereInput['OR'] = [
      { productId: current.id, variantId: null },
      { productId: null, variant: { is: { productId: current.id, deletedAt: null } } },
    ];
    const approvedPublicOwnerWhere: Prisma.ProductImageWhereInput['OR'] = [
      { productId: current.id, variantId: null },
      {
        productId: null,
        variant: {
          is: {
            productId: current.id,
            publicationStatus: 'PUBLISHED',
            archivedAt: null,
            deletedAt: null,
          },
        },
      },
    ];
    const [unresolvedImages, approvedImages] = await Promise.all([
      database.productImage.count({
        where: {
          deletedAt: null,
          moderationStatus: { in: ['PENDING', 'QUARANTINED'] },
          OR: unresolvedOwnerWhere,
        },
      }),
      database.productImage.count({
        where: {
          deletedAt: null,
          moderationStatus: 'APPROVED',
          OR: approvedPublicOwnerWhere,
        },
      }),
    ]);
    const blockers: string[] = [];
    if (unresolvedImages > 0) blockers.push('MEDIA_REVIEW_PENDING');
    if (current.needsMediaReview && approvedImages === 0) {
      blockers.push('APPROVED_IMAGE_MISSING');
    }
    if (current.needsMediaReview && !confirmed) {
      blockers.push('MEDIA_REVIEW_CONFIRMATION_REQUIRED');
    }
    if (blockers.length > 0) throw publicationNotReady('product', blockers);
  }

  private async validatePublishedUpdate(
    current: Product,
    basePrice: number | null,
    promotionalPrice: number | null,
    database: CatalogDatabase = this.prisma,
  ): Promise<void> {
    if (
      (basePrice !== null && basePrice <= 0) ||
      (promotionalPrice !== null && promotionalPrice <= 0)
    ) {
      throw publicationNotReady('product', ['NON_POSITIVE_PRICE']);
    }
    if (basePrice !== null) return;
    const publishedVariantCount = await database.productVariant.count({
      where: {
        productId: current.id,
        publicationStatus: 'PUBLISHED',
        archivedAt: null,
        deletedAt: null,
      },
    });
    if (publishedVariantCount === 0) {
      throw new ConflictException({
        code: 'PRODUCT_PUBLICATION_REQUIREMENTS_MISSING',
        message: 'A product needs a price or a published priced variant before publication.',
      });
    }
  }

  private async ensureReferences(
    categoryId: string,
    brandId: string | null,
    requirePublished: boolean,
    database: CatalogDatabase = this.prisma,
  ): Promise<void> {
    const [category, brand] = await Promise.all([
      database.category.findFirst({
        where: {
          id: categoryId,
          archivedAt: null,
          deletedAt: null,
          ...(requirePublished
            ? { publicationStatus: 'PUBLISHED' as const, suspendedAt: null }
            : {}),
        },
        select: { id: true },
      }),
      brandId
        ? database.brand.findFirst({
            where: {
              id: brandId,
              archivedAt: null,
              deletedAt: null,
              ...(requirePublished
                ? { publicationStatus: 'PUBLISHED' as const, suspendedAt: null }
                : {}),
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    if (!category || (brandId && !brand)) {
      throw new BadRequestException({
        code: 'INVALID_CATALOG_REFERENCE',
        message: 'The selected category or brand is not available for this product.',
      });
    }
  }

  private async lockProductForUpdate(
    transaction: Prisma.TransactionClient,
    id: string,
    version: number,
  ): Promise<void> {
    const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM Product
      WHERE id = ${id} AND version = ${version} AND deletedAt IS NULL
      FOR UPDATE
    `);
    if (locked.length !== 1) throw this.versionConflict();
  }

  private async deliveryPublicationBlocker(
    database: CatalogDatabase,
    now: Date,
  ): Promise<'DELIVERY_METHOD_MISSING' | null> {
    const policy = await this.policies.evaluate(now, database);
    return policy.blockers.includes('DELIVERY_METHOD_MISSING') ? 'DELIVERY_METHOD_MISSING' : null;
  }

  private validatePrices(basePrice: number | null, promotionalPrice: number | null): void {
    if (promotionalPrice !== null && (basePrice === null || promotionalPrice > basePrice)) {
      throw new BadRequestException({
        code: 'INVALID_PROMOTIONAL_PRICE',
        message: 'The promotional price cannot exceed or exist without the base price.',
      });
    }
  }

  private rethrowUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = error.meta?.target;
      const fields = (Array.isArray(target) ? target : [target]).flatMap((value) =>
        typeof value === 'string' ? [value.toLocaleLowerCase('en-US')] : [],
      );
      if (fields.some((field) => field.includes('slug'))) {
        const message = 'The product slug is already assigned to another product.';
        throw new ConflictException({
          code: 'PRODUCT_SLUG_CONFLICT',
          message,
          errors: { slug: [message] },
        });
      }
      throw new ConflictException({
        code: 'PRODUCT_IDENTIFIER_CONFLICT',
        message: 'The product SKU or barcode is already assigned to another product.',
      });
    }
    throw error;
  }

  private async findCurrent(id: string): Promise<Product> {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!product) throw this.productNotFound();
    return product;
  }

  private assertVersion(actual: number, expected: number): void {
    if (actual !== expected) throw this.versionConflict();
  }

  private assertId(id: string): void {
    if (id.length < 1 || id.length > 30 || !/^[A-Za-z0-9_-]+$/.test(id)) {
      throw this.productNotFound();
    }
  }

  private productNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'PRODUCT_NOT_FOUND',
      message: 'The requested product does not exist.',
    });
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: 'The product changed since it was loaded. Reload it and retry.',
    });
  }
}
