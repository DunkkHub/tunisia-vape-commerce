import type { Prisma, ProductType } from '@prisma/client';

export const PUBLIC_CATALOG_PAGE_SIZE = 20;
export const PUBLIC_CATALOG_MAX_PAGE_SIZE = 50;

export interface CatalogFilterInput {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: string;
  brand?: string;
  productType?: ProductType;
  flavor?: string;
  puffCount?: number;
  nicotineStrengthMg?: number;
  minPriceMillimes?: number;
  maxPriceMillimes?: number;
  featured?: boolean;
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'name_asc';
}

export interface NormalizedCatalogFilter {
  page: number;
  pageSize: number;
  skip: number;
  search?: string;
  category?: string;
  brand?: string;
  productType?: ProductType;
  flavor?: string;
  puffCount?: number;
  nicotineStrengthMg?: number;
  minPriceMillimes?: number;
  maxPriceMillimes?: number;
  featured?: boolean;
  sort: 'newest' | 'price_asc' | 'price_desc' | 'name_asc';
}

const positiveIntegerOr = (value: number | undefined, fallback: number): number =>
  Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value as number) : fallback;

export const normalizeCatalogFilter = (input: CatalogFilterInput): NormalizedCatalogFilter => {
  const page = positiveIntegerOr(input.page, 1);
  const requestedPageSize = positiveIntegerOr(input.pageSize, PUBLIC_CATALOG_PAGE_SIZE);
  const pageSize = Math.min(requestedPageSize, PUBLIC_CATALOG_MAX_PAGE_SIZE);
  const search = input.search?.trim().replace(/\s+/g, ' ');
  const normalized: NormalizedCatalogFilter = {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    sort: input.sort ?? 'newest',
  };

  if (search) normalized.search = search;
  if (input.category) normalized.category = input.category;
  if (input.brand) normalized.brand = input.brand;
  if (input.productType) normalized.productType = input.productType;
  const flavor = input.flavor?.trim();
  if (flavor) normalized.flavor = flavor;
  if (input.puffCount !== undefined) normalized.puffCount = input.puffCount;
  if (input.nicotineStrengthMg !== undefined) {
    normalized.nicotineStrengthMg = input.nicotineStrengthMg;
  }
  if (input.minPriceMillimes !== undefined) {
    normalized.minPriceMillimes = input.minPriceMillimes;
  }
  if (input.maxPriceMillimes !== undefined) {
    normalized.maxPriceMillimes = input.maxPriceMillimes;
  }
  if (input.featured !== undefined) normalized.featured = input.featured;
  return normalized;
};

export interface CatalogPriceFieldReferences {
  productBasePrice: Prisma.IntFieldRefInput<'Product'>;
  variantListPrice: Prisma.IntFieldRefInput<'ProductVariant'>;
}

const activeRestrictionFilter = (now: Date): Prisma.ProductRestrictionWhereInput => ({
  status: 'ACTIVE',
  startsAt: { lte: now },
  OR: [{ endsAt: null }, { endsAt: { gt: now } }],
});

const publicVariantFilter = (): Prisma.ProductVariantWhereInput => ({
  publicationStatus: 'PUBLISHED',
  archivedAt: null,
  deletedAt: null,
});

export const buildPublicProductWhere = (
  filters: Pick<
    NormalizedCatalogFilter,
    | 'brand'
    | 'category'
    | 'featured'
    | 'flavor'
    | 'maxPriceMillimes'
    | 'minPriceMillimes'
    | 'nicotineStrengthMg'
    | 'puffCount'
    | 'productType'
    | 'search'
  >,
  now: Date,
  priceFields?: CatalogPriceFieldReferences,
): Prisma.ProductWhereInput => {
  const category: Prisma.CategoryWhereInput = {
    publicationStatus: 'PUBLISHED',
    archivedAt: null,
    suspendedAt: null,
    deletedAt: null,
    restrictions: { none: activeRestrictionFilter(now) },
  };
  if (filters.category) category.slug = filters.category;

  const publishedBrand: Prisma.BrandWhereInput = {
    publicationStatus: 'PUBLISHED',
    archivedAt: null,
    suspendedAt: null,
    deletedAt: null,
    restrictions: { none: activeRestrictionFilter(now) },
  };
  if (filters.brand) publishedBrand.slug = filters.brand;

  const clauses: Prisma.ProductWhereInput[] = [hasNonNegativePublicPrice()];
  clauses.push(
    filters.brand
      ? { brand: { is: publishedBrand } }
      : { OR: [{ brandId: null }, { brand: { is: publishedBrand } }] },
  );
  if (filters.search) {
    const variantSearch: Prisma.ProductVariantWhereInput = {
      ...publicVariantFilter(),
      OR: [
        { nameFr: { contains: filters.search } },
        { nameAr: { contains: filters.search } },
        { sku: { contains: filters.search } },
        {
          flavor: {
            is: {
              OR: [
                { canonicalName: { contains: filters.search } },
                { nameFr: { contains: filters.search } },
                { nameAr: { contains: filters.search } },
                { slug: { contains: filters.search } },
              ],
            },
          },
        },
      ],
    };
    clauses.push({
      OR: [
        { nameFr: { contains: filters.search } },
        { nameAr: { contains: filters.search } },
        { slug: { contains: filters.search } },
        { sku: { contains: filters.search } },
        { variants: { some: variantSearch } },
      ],
    });
  }
  if (filters.productType) clauses.push({ productType: filters.productType });
  if (filters.flavor) {
    clauses.push({
      OR: [
        { flavor: filters.flavor },
        {
          variants: {
            some: {
              ...publicVariantFilter(),
              flavor: {
                is: {
                  OR: [
                    { slug: filters.flavor },
                    { canonicalName: filters.flavor },
                    { nameFr: filters.flavor },
                    { nameAr: filters.flavor },
                  ],
                },
              },
            },
          },
        },
      ],
    });
  }
  if (filters.puffCount !== undefined) clauses.push({ puffCount: filters.puffCount });
  if (filters.nicotineStrengthMg !== undefined) {
    clauses.push({
      OR: [
        { nicotineStrengthMg: filters.nicotineStrengthMg },
        {
          variants: {
            some: {
              ...publicVariantFilter(),
              nicotineStrengthMg: filters.nicotineStrengthMg,
            },
          },
        },
      ],
    });
  }
  if (filters.minPriceMillimes !== undefined || filters.maxPriceMillimes !== undefined) {
    if (!priceFields) {
      throw new TypeError('Catalog price field references are required for price filtering.');
    }
    clauses.push(buildEffectiveProductPriceWhere(filters, priceFields));
  }

  return {
    publicationStatus: 'PUBLISHED',
    publishedAt: { lte: now },
    archivedAt: null,
    suspendedAt: null,
    deletedAt: null,
    restrictions: { none: activeRestrictionFilter(now) },
    category: { is: category },
    ...(filters.featured === undefined ? {} : { featured: filters.featured }),
    AND: clauses,
  };
};

type EffectivePriceComparator = 'lt' | 'lte';

const productBaseEffectivePrice = (
  comparator: EffectivePriceComparator,
  amount: number,
  fields: CatalogPriceFieldReferences,
): Prisma.ProductWhereInput => ({
  OR: [
    {
      AND: [
        { promotionalPriceMillimes: { not: null } },
        { promotionalPriceMillimes: { gte: 0 } },
        { promotionalPriceMillimes: { lte: fields.productBasePrice } },
        { promotionalPriceMillimes: { [comparator]: amount } },
      ],
    },
    {
      AND: [
        { basePriceMillimes: { gte: 0, [comparator]: amount } },
        {
          OR: [
            { promotionalPriceMillimes: null },
            { promotionalPriceMillimes: { lt: 0 } },
            { promotionalPriceMillimes: { gt: fields.productBasePrice } },
          ],
        },
      ],
    },
  ],
});

const publicVariantEffectivePrice = (
  comparator: EffectivePriceComparator,
  amount: number,
  fields: CatalogPriceFieldReferences,
): Prisma.ProductVariantWhereInput => ({
  publicationStatus: 'PUBLISHED',
  archivedAt: null,
  deletedAt: null,
  OR: [
    {
      AND: [
        { promotionalPriceMillimes: { not: null } },
        { promotionalPriceMillimes: { gte: 0 } },
        { promotionalPriceMillimes: { lte: fields.variantListPrice } },
        { promotionalPriceMillimes: { [comparator]: amount } },
      ],
    },
    {
      AND: [
        { priceMillimes: { gte: 0, [comparator]: amount } },
        {
          OR: [
            { promotionalPriceMillimes: null },
            { promotionalPriceMillimes: { lt: 0 } },
            { promotionalPriceMillimes: { gt: fields.variantListPrice } },
          ],
        },
      ],
    },
  ],
});

const effectivePriceBelowOrEqual = (
  amount: number,
  fields: CatalogPriceFieldReferences,
): Prisma.ProductWhereInput => ({
  OR: [
    productBaseEffectivePrice('lte', amount, fields),
    { variants: { some: publicVariantEffectivePrice('lte', amount, fields) } },
  ],
});

const hasNonNegativePublicPrice = (): Prisma.ProductWhereInput => ({
  OR: [
    { basePriceMillimes: { gte: 0 } },
    {
      variants: {
        some: {
          publicationStatus: 'PUBLISHED',
          archivedAt: null,
          deletedAt: null,
          priceMillimes: { gte: 0 },
        },
      },
    },
  ],
});

/**
 * A product's public price is the lowest valid effective base/variant price. Therefore a lower
 * bound excludes any candidate below it, while an upper bound requires at least one candidate at
 * or below it. Field references keep corrupt promotions above their list price from changing the
 * effective price without resorting to raw SQL.
 */
export const buildEffectiveProductPriceWhere = (
  filters: Pick<NormalizedCatalogFilter, 'maxPriceMillimes' | 'minPriceMillimes'>,
  fields: CatalogPriceFieldReferences,
): Prisma.ProductWhereInput => {
  const clauses: Prisma.ProductWhereInput[] = [hasNonNegativePublicPrice()];
  if (filters.minPriceMillimes !== undefined && filters.minPriceMillimes > 0) {
    const belowMinimum: Prisma.ProductWhereInput = {
      OR: [
        productBaseEffectivePrice('lt', filters.minPriceMillimes, fields),
        {
          variants: {
            some: publicVariantEffectivePrice('lt', filters.minPriceMillimes, fields),
          },
        },
      ],
    };
    clauses.push({ NOT: belowMinimum });
  }
  if (filters.maxPriceMillimes !== undefined) {
    clauses.push(effectivePriceBelowOrEqual(filters.maxPriceMillimes, fields));
  }
  return { AND: clauses };
};

export const catalogProductOrderBy = (
  sort: NormalizedCatalogFilter['sort'],
): Prisma.ProductOrderByWithRelationInput[] => {
  switch (sort) {
    case 'price_asc':
      return [{ basePriceMillimes: 'asc' }, { id: 'asc' }];
    case 'price_desc':
      return [{ basePriceMillimes: 'desc' }, { id: 'asc' }];
    case 'name_asc':
      return [{ nameFr: 'asc' }, { id: 'asc' }];
    case 'newest':
      return [{ publishedAt: 'desc' }, { id: 'asc' }];
  }
};
