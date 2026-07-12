import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Product } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  AdminProductListQueryDto,
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
  constructor(private readonly prisma: PrismaService) {}

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
  }

  async update(id: string, input: UpdateProductDto, context: AdminMutationContext) {
    this.assertId(id);
    if (
      !mutableProductFields.some((field) => input[field] !== undefined) &&
      !input.publicationStatus
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
    await this.ensureReferences(categoryId, brandId, targetStatus === 'PUBLISHED');

    const basePrice =
      input.basePriceMillimes === undefined ? current.basePriceMillimes : input.basePriceMillimes;
    const promotionalPrice =
      input.promotionalPriceMillimes === undefined
        ? current.promotionalPriceMillimes
        : input.promotionalPriceMillimes;
    this.validatePrices(basePrice, promotionalPrice);
    if (targetStatus === 'PUBLISHED') {
      await this.validatePublication(current, input, basePrice);
    }

    const data = this.buildUpdateData(input, current);
    const updated = await this.prisma.$transaction(async (transaction) => {
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
            version: current.version,
          },
          afterSummary: {
            publicationStatus: product.publicationStatus,
            basePriceMillimes: product.basePriceMillimes,
            promotionalPriceMillimes: product.promotionalPriceMillimes,
            version: product.version,
          },
        },
      });
      return product;
    });
    return adminProductResponse(updated);
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
    input: UpdateProductDto,
    basePrice: number | null,
  ): Promise<void> {
    const minimumAge = input.minimumAge === undefined ? current.minimumAge : input.minimumAge;
    const warningFr = input.warningFr === undefined ? current.warningFr : input.warningFr;
    const warningAr = input.warningAr === undefined ? current.warningAr : input.warningAr;
    const publishedVariantCount = await this.prisma.productVariant.count({
      where: {
        productId: current.id,
        publicationStatus: 'PUBLISHED',
        archivedAt: null,
        deletedAt: null,
      },
    });
    if (
      minimumAge === null ||
      minimumAge < 18 ||
      !warningFr?.trim() ||
      !warningAr?.trim() ||
      (basePrice === null && publishedVariantCount === 0)
    ) {
      throw new ConflictException({
        code: 'PRODUCT_PUBLICATION_REQUIREMENTS_MISSING',
        message: 'A product needs approved warnings, minimum age, and a price before publication.',
      });
    }
  }

  private async ensureReferences(
    categoryId: string,
    brandId: string | null,
    requirePublished: boolean,
  ): Promise<void> {
    const [category, brand] = await Promise.all([
      this.prisma.category.findFirst({
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
        ? this.prisma.brand.findFirst({
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

  private validatePrices(basePrice: number | null, promotionalPrice: number | null): void {
    if (promotionalPrice !== null && (basePrice === null || promotionalPrice > basePrice)) {
      throw new BadRequestException({
        code: 'INVALID_PROMOTIONAL_PRICE',
        message: 'The promotional price cannot exceed or exist without the base price.',
      });
    }
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
