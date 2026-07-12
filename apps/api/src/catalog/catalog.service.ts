import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { AgeGateService } from '../compliance/age-gate.service';
import { PrismaService } from '../database/prisma.service';
import {
  buildPublicProductWhere,
  catalogProductOrderBy,
  normalizeCatalogFilter,
} from './catalog-policy';
import type { BoundedPageQueryDto, CatalogProductsQueryDto } from './dto/catalog-query.dto';

export type StorefrontLocale = 'fr' | 'ar';

const PUBLIC_FACET_LIMIT = 50;
const DATABASE_INT_MAX = 2_147_483_647;

const publicProductSelect = (now: Date) =>
  ({
    id: true,
    nameFr: true,
    nameAr: true,
    slug: true,
    sku: true,
    shortDescriptionFr: true,
    shortDescriptionAr: true,
    descriptionFr: true,
    descriptionAr: true,
    containsNicotine: true,
    productType: true,
    flavor: true,
    basePriceMillimes: true,
    promotionalPriceMillimes: true,
    warningFr: true,
    warningAr: true,
    minimumAge: true,
    featured: true,
    brand: { select: { name: true, slug: true } },
    variants: {
      where: {
        publicationStatus: 'PUBLISHED',
        archivedAt: null,
        deletedAt: null,
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        nameFr: true,
        nameAr: true,
        sku: true,
        priceMillimes: true,
        promotionalPriceMillimes: true,
        lowStockThreshold: true,
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
    attributes: {
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        nameFr: true,
        nameAr: true,
        values: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { valueFr: true, valueAr: true },
        },
      },
    },
  }) satisfies Prisma.ProductSelect;

type PublicProductRecord = Prisma.ProductGetPayload<{
  select: ReturnType<typeof publicProductSelect>;
}>;
type PublicVariantRecord = PublicProductRecord['variants'][number];

const availableQuantity = (variant: PublicVariantRecord): number =>
  variant.inventoryItems.reduce((total, inventory) => {
    const reserved = inventory.reservations.reduce(
      (quantity, reservation) => quantity + reservation.quantity,
      0,
    );
    return total + Math.max(0, inventory.onHandQuantity - reserved);
  }, 0);

const displayPrice = (product: PublicProductRecord) => {
  const candidates: Array<{
    list: number;
    promotional: number | null;
    effective: number;
  }> = [];
  if (product.basePriceMillimes !== null && product.basePriceMillimes >= 0) {
    const promotional =
      product.promotionalPriceMillimes !== null &&
      product.promotionalPriceMillimes >= 0 &&
      product.promotionalPriceMillimes <= product.basePriceMillimes
        ? product.promotionalPriceMillimes
        : null;
    candidates.push({
      list: product.basePriceMillimes,
      promotional,
      effective: promotional ?? product.basePriceMillimes,
    });
  }
  for (const variant of product.variants) {
    if (variant.priceMillimes < 0) continue;
    const promotional =
      variant.promotionalPriceMillimes !== null &&
      variant.promotionalPriceMillimes >= 0 &&
      variant.promotionalPriceMillimes <= variant.priceMillimes
        ? variant.promotionalPriceMillimes
        : null;
    candidates.push({
      list: variant.priceMillimes,
      promotional,
      effective: promotional ?? variant.priceMillimes,
    });
  }
  candidates.sort((left, right) => left.effective - right.effective || left.list - right.list);
  return candidates[0] ?? { list: 0, promotional: null, effective: 0 };
};

const serializeSummary = (product: PublicProductRecord, locale: StorefrontLocale) => {
  const price = displayPrice(product);
  const variants = product.variants.map((variant) => ({
    available: availableQuantity(variant),
    threshold: variant.lowStockThreshold,
  }));
  const totalAvailable = variants.reduce((total, variant) => total + variant.available, 0);
  return {
    id: product.id,
    name: locale === 'ar' ? product.nameAr : product.nameFr,
    slug: product.slug,
    shortDescription: locale === 'ar' ? product.shortDescriptionAr : product.shortDescriptionFr,
    brandName: product.brand?.name ?? null,
    brandSlug: product.brand?.slug ?? null,
    productType: product.productType,
    flavor: product.flavor?.trim() || null,
    priceMillimes: price.list,
    promotionalPriceMillimes: price.promotional,
    availableQuantity: totalAvailable,
    lowStock:
      variants.length === 0 || variants.some((variant) => variant.available <= variant.threshold),
    ageRestricted: product.minimumAge !== null || product.containsNicotine,
    // Object-storage keys are intentionally not exposed. A media-delivery adapter can populate this.
    primaryImage: null,
  };
};

const serializeDetail = (product: PublicProductRecord, locale: StorefrontLocale) => ({
  ...serializeSummary(product, locale),
  description: locale === 'ar' ? product.descriptionAr : product.descriptionFr,
  sku: product.sku ?? product.variants[0]?.sku ?? '',
  images: [],
  variants: product.variants.map((variant) => ({
    id: variant.id,
    name: locale === 'ar' ? variant.nameAr : variant.nameFr,
    sku: variant.sku,
    priceMillimes: variant.priceMillimes,
    promotionalPriceMillimes:
      variant.promotionalPriceMillimes !== null &&
      variant.promotionalPriceMillimes >= 0 &&
      variant.promotionalPriceMillimes <= variant.priceMillimes
        ? variant.promotionalPriceMillimes
        : null,
    availableQuantity: availableQuantity(variant),
    image: null,
  })),
  warningText: locale === 'ar' ? product.warningAr : product.warningFr,
  attributes: product.attributes.flatMap((attribute) =>
    attribute.values.map((value) => ({
      name: locale === 'ar' ? attribute.nameAr : attribute.nameFr,
      value: locale === 'ar' ? value.valueAr : value.valueFr,
    })),
  ),
});

const jsonBoolean = (value: Prisma.JsonValue | undefined): boolean => value === true;
const jsonInteger = (value: Prisma.JsonValue | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
const jsonString = (value: Prisma.JsonValue | undefined): string =>
  typeof value === 'string' ? value : '';

interface PublicPriceRangeRow {
  minimumMillimes: bigint | number | null;
  maximumMillimes: bigint | number | null;
}

const safeDatabaseInteger = (value: bigint | number | null | undefined): number | null => {
  if (typeof value === 'bigint') {
    const converted = Number(value);
    return Number.isSafeInteger(converted) && converted >= 0 ? converted : null;
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
};

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ageGate: AgeGateService,
  ) {}

  async status(request: Request) {
    const [storeSettings, complianceSettings] = await Promise.all([
      this.prisma.storeSetting.findMany({
        where: {
          key: {
            in: ['store.name', 'maintenance.mode', 'prelaunch.mode', 'checkout.enabled'],
          },
        },
        select: { key: true, value: true },
      }),
      this.prisma.complianceSetting.findMany({
        where: { key: { in: ['minimum_purchase_age', 'legal_review.completed'] } },
        select: { key: true, value: true },
      }),
    ]);
    const store = new Map(storeSettings.map((setting) => [setting.key, setting.value]));
    const compliance = new Map(complianceSettings.map((setting) => [setting.key, setting.value]));
    const minimumAge = jsonInteger(compliance.get('minimum_purchase_age')) ?? 0;
    const ageConfirmed = minimumAge >= 18 && this.ageGate.isConfirmed(request, minimumAge);
    const minimumAgeConfigured = minimumAge >= 18;

    return {
      data: {
        storeName: jsonString(store.get('store.name')),
        maintenanceMode: jsonBoolean(store.get('maintenance.mode')),
        prelaunchMode: jsonBoolean(store.get('prelaunch.mode')) || !minimumAgeConfigured,
        checkoutEnabled: jsonBoolean(store.get('checkout.enabled')),
        legalReviewCompleted: jsonBoolean(compliance.get('legal_review.completed')),
        minimumAge,
        ageGateRequired: minimumAgeConfigured && !ageConfirmed,
        ageConfirmed,
      },
    };
  }

  async home(locale: StorefrontLocale) {
    const now = new Date();
    const productWhere = buildPublicProductWhere({ featured: true }, now);
    const categoryWhere = this.publicCategoryWhere(now);
    const [featured, categories] = await Promise.all([
      this.prisma.product.findMany({
        where: productWhere,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        take: 8,
        select: publicProductSelect(now),
      }),
      this.prisma.category.findMany({
        where: categoryWhere,
        orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }, { id: 'asc' }],
        take: 12,
        select: {
          id: true,
          nameFr: true,
          nameAr: true,
          slug: true,
          _count: { select: { products: { where: buildPublicProductWhere({}, now) } } },
        },
      }),
    ]);
    return {
      data: {
        featured: featured.map((product) => serializeSummary(product, locale)),
        categories: categories.map((category) => ({
          id: category.id,
          name: locale === 'ar' ? category.nameAr : category.nameFr,
          slug: category.slug,
          productCount: category._count.products,
        })),
      },
    };
  }

  async products(query: CatalogProductsQueryDto, locale: StorefrontLocale) {
    if (
      query.minPriceMillimes !== undefined &&
      query.maxPriceMillimes !== undefined &&
      query.minPriceMillimes > query.maxPriceMillimes
    ) {
      throw new BadRequestException({
        code: 'INVALID_PRICE_RANGE',
        message: 'The maximum catalog price must be greater than or equal to the minimum price.',
      });
    }
    const requestedSearch = query.q ?? query.search;
    const filters = normalizeCatalogFilter({
      ...query,
      pageSize: query.limit ?? query.pageSize,
      ...(requestedSearch ? { search: requestedSearch } : {}),
    });
    const now = new Date();
    const where = buildPublicProductWhere(filters, now, {
      productBasePrice: this.prisma.product.fields.basePriceMillimes,
      variantListPrice: this.prisma.productVariant.fields.priceMillimes,
    });
    const [records, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: catalogProductOrderBy(filters.sort),
        skip: filters.skip,
        take: filters.pageSize,
        select: publicProductSelect(now),
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: {
        items: records.map((product) => serializeSummary(product, locale)),
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        totalPages: Math.ceil(total / filters.pageSize),
      },
    };
  }

  async product(slug: string, locale: StorefrontLocale) {
    if (slug.length > 260 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw this.productNotFound();
    }
    const now = new Date();
    const record = await this.prisma.product.findFirst({
      where: { ...buildPublicProductWhere({}, now), slug },
      select: publicProductSelect(now),
    });
    if (!record) throw this.productNotFound();
    return { data: serializeDetail(record, locale) };
  }

  async categories(query: BoundedPageQueryDto, locale: StorefrontLocale) {
    const filters = normalizeCatalogFilter(query);
    const now = new Date();
    const where = this.publicCategoryWhere(now);
    const [records, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }, { id: 'asc' }],
        skip: filters.skip,
        take: filters.pageSize,
        select: {
          id: true,
          parentId: true,
          nameFr: true,
          nameAr: true,
          slug: true,
          descriptionFr: true,
          descriptionAr: true,
        },
      }),
      this.prisma.category.count({ where }),
    ]);
    return {
      data: {
        items: records.map((category) => ({
          id: category.id,
          parentId: category.parentId,
          name: locale === 'ar' ? category.nameAr : category.nameFr,
          slug: category.slug,
          description: locale === 'ar' ? category.descriptionAr : category.descriptionFr,
        })),
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        totalPages: Math.ceil(total / filters.pageSize),
      },
    };
  }

  async brands(query: BoundedPageQueryDto, locale: StorefrontLocale) {
    const filters = normalizeCatalogFilter(query);
    const now = new Date();
    const where = this.publicBrandWhere(now);
    const [records, total] = await this.prisma.$transaction([
      this.prisma.brand.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: filters.skip,
        take: filters.pageSize,
        select: {
          id: true,
          name: true,
          slug: true,
          descriptionFr: true,
          descriptionAr: true,
        },
      }),
      this.prisma.brand.count({ where }),
    ]);
    return {
      data: {
        items: records.map((brand) => ({
          id: brand.id,
          name: brand.name,
          slug: brand.slug,
          description: locale === 'ar' ? brand.descriptionAr : brand.descriptionFr,
        })),
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        totalPages: Math.ceil(total / filters.pageSize),
      },
    };
  }

  async facets() {
    const now = new Date();
    const publicProducts = buildPublicProductWhere({}, now);
    const [brands, productTypes, flavorGroups, priceRows] = await Promise.all([
      this.prisma.brand.findMany({
        where: {
          ...this.publicBrandWhere(now),
          products: { some: publicProducts },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: PUBLIC_FACET_LIMIT + 1,
        select: { id: true, name: true, slug: true },
      }),
      this.prisma.product.groupBy({
        by: ['productType'],
        where: publicProducts,
        orderBy: { productType: 'asc' },
      }),
      this.prisma.product.groupBy({
        by: ['flavor'],
        where: {
          ...publicProducts,
          AND: [
            ...(Array.isArray(publicProducts.AND)
              ? publicProducts.AND
              : publicProducts.AND
                ? [publicProducts.AND]
                : []),
            { flavor: { not: null } },
            { flavor: { not: '' } },
          ],
        },
        _count: { _all: true },
        orderBy: { flavor: 'asc' },
        take: PUBLIC_FACET_LIMIT + 1,
      }),
      this.publicPriceRange(now),
    ]);

    const flavors = new Map<string, number>();
    for (const group of flavorGroups.slice(0, PUBLIC_FACET_LIMIT)) {
      const value = group.flavor?.trim();
      if (value) flavors.set(value, (flavors.get(value) ?? 0) + group._count._all);
    }
    const priceRow = priceRows[0];

    return {
      data: {
        brands: brands.slice(0, PUBLIC_FACET_LIMIT),
        productTypes: productTypes.map((group) => group.productType),
        flavors: [...flavors.entries()].map(([value, productCount]) => ({ value, productCount })),
        priceRange: {
          minimumMillimes: safeDatabaseInteger(priceRow?.minimumMillimes),
          maximumMillimes: safeDatabaseInteger(priceRow?.maximumMillimes),
        },
        truncated: {
          brands: brands.length > PUBLIC_FACET_LIMIT,
          flavors: flavorGroups.length > PUBLIC_FACET_LIMIT,
        },
      },
    };
  }

  /**
   * Prisma cannot express an aggregate over each product's minimum effective price across its base
   * price and published variants. This single parameterized read is kept local to the catalog and
   * mirrors the public publication/restriction policy so the facet range matches displayed prices.
   */
  private publicPriceRange(now: Date) {
    return this.prisma.$queryRaw<PublicPriceRangeRow[]>(Prisma.sql`
      SELECT
        MIN(public_prices.effectivePriceMillimes) AS minimumMillimes,
        MAX(public_prices.effectivePriceMillimes) AS maximumMillimes
      FROM (
        SELECT
          p.id,
          LEAST(
            CASE
              WHEN p.basePriceMillimes IS NULL OR p.basePriceMillimes < 0
                THEN ${DATABASE_INT_MAX}
              WHEN p.promotionalPriceMillimes IS NOT NULL
                AND p.promotionalPriceMillimes >= 0
                AND p.promotionalPriceMillimes <= p.basePriceMillimes
                THEN p.promotionalPriceMillimes
              ELSE p.basePriceMillimes
            END,
            MIN(
              CASE
                WHEN v.id IS NULL OR v.priceMillimes < 0
                  THEN ${DATABASE_INT_MAX}
                WHEN v.promotionalPriceMillimes IS NOT NULL
                  AND v.promotionalPriceMillimes >= 0
                  AND v.promotionalPriceMillimes <= v.priceMillimes
                  THEN v.promotionalPriceMillimes
                ELSE v.priceMillimes
              END
            )
          ) AS effectivePriceMillimes
        FROM Product p
        INNER JOIN Category c ON c.id = p.categoryId
        LEFT JOIN Brand b ON b.id = p.brandId
        LEFT JOIN ProductVariant v
          ON v.productId = p.id
          AND v.publicationStatus = 'PUBLISHED'
          AND v.archivedAt IS NULL
          AND v.deletedAt IS NULL
        WHERE p.publicationStatus = 'PUBLISHED'
          AND p.publishedAt <= ${now}
          AND p.archivedAt IS NULL
          AND p.suspendedAt IS NULL
          AND p.deletedAt IS NULL
          AND c.publicationStatus = 'PUBLISHED'
          AND c.archivedAt IS NULL
          AND c.suspendedAt IS NULL
          AND c.deletedAt IS NULL
          AND (
            p.brandId IS NULL
            OR (
              b.publicationStatus = 'PUBLISHED'
              AND b.archivedAt IS NULL
              AND b.suspendedAt IS NULL
              AND b.deletedAt IS NULL
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM ProductRestriction pr
            WHERE pr.productId = p.id
              AND pr.status = 'ACTIVE'
              AND pr.startsAt <= ${now}
              AND (pr.endsAt IS NULL OR pr.endsAt > ${now})
          )
          AND NOT EXISTS (
            SELECT 1 FROM ProductRestriction cr
            WHERE cr.categoryId = c.id
              AND cr.status = 'ACTIVE'
              AND cr.startsAt <= ${now}
              AND (cr.endsAt IS NULL OR cr.endsAt > ${now})
          )
          AND (
            p.brandId IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM ProductRestriction br
              WHERE br.brandId = b.id
                AND br.status = 'ACTIVE'
                AND br.startsAt <= ${now}
                AND (br.endsAt IS NULL OR br.endsAt > ${now})
            )
          )
        GROUP BY p.id, p.basePriceMillimes, p.promotionalPriceMillimes
      ) public_prices
      WHERE public_prices.effectivePriceMillimes <> ${DATABASE_INT_MAX}
    `);
  }

  private publicCategoryWhere(now: Date): Prisma.CategoryWhereInput {
    return {
      publicationStatus: 'PUBLISHED',
      suspendedAt: null,
      archivedAt: null,
      deletedAt: null,
      restrictions: {
        none: {
          status: 'ACTIVE',
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      },
    };
  }

  private publicBrandWhere(now: Date): Prisma.BrandWhereInput {
    return {
      publicationStatus: 'PUBLISHED',
      suspendedAt: null,
      archivedAt: null,
      deletedAt: null,
      restrictions: {
        none: {
          status: 'ACTIVE',
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      },
    };
  }

  private productNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'PRODUCT_NOT_FOUND',
      message: 'The requested product is not available.',
    });
  }
}
