import { describe, expect, it } from 'vitest';
import type { CatalogPriceFieldReferences } from './catalog-policy';
import { buildPublicProductWhere, normalizeCatalogFilter } from './catalog-policy';

const priceFields = {
  productBasePrice: { modelName: 'Product', name: 'basePriceMillimes' },
  variantListPrice: { modelName: 'ProductVariant', name: 'priceMillimes' },
} as unknown as CatalogPriceFieldReferences;

describe('public catalog filters', () => {
  it('bounds pagination and normalizes search whitespace', () => {
    expect(
      normalizeCatalogFilter({
        page: 2,
        pageSize: 10_000,
        search: '  pod   rechargeable  ',
      }),
    ).toMatchObject({
      page: 2,
      pageSize: 50,
      skip: 50,
      search: 'pod rechargeable',
    });
  });

  it('fails closed around publication, archival, suspension, deletion and active restrictions', () => {
    const now = new Date('2026-07-11T12:00:00.000Z');
    const where = buildPublicProductWhere({ category: 'pods', featured: true }, now);

    expect(where).toMatchObject({
      publicationStatus: 'PUBLISHED',
      publishedAt: { lte: now },
      archivedAt: null,
      suspendedAt: null,
      deletedAt: null,
      featured: true,
      restrictions: {
        none: {
          status: 'ACTIVE',
          startsAt: { lte: now },
        },
      },
      category: {
        is: {
          slug: 'pods',
          publicationStatus: 'PUBLISHED',
          archivedAt: null,
          suspendedAt: null,
          deletedAt: null,
        },
      },
    });
  });

  it('normalizes combinable type, flavor and integer-millime price filters', () => {
    expect(
      normalizeCatalogFilter({
        brand: 'nexa',
        productType: 'E_LIQUID',
        flavor: '  Menthe glaciale ',
        minPriceMillimes: 12_500,
        maxPriceMillimes: 29_900,
      }),
    ).toMatchObject({
      brand: 'nexa',
      productType: 'E_LIQUID',
      flavor: 'Menthe glaciale',
      minPriceMillimes: 12_500,
      maxPriceMillimes: 29_900,
    });
  });

  it('combines brand, product type, flavor and effective display-price predicates', () => {
    const now = new Date('2026-07-11T12:00:00.000Z');
    const where = buildPublicProductWhere(
      {
        brand: 'nexa',
        productType: 'E_LIQUID',
        flavor: 'Menthe',
        minPriceMillimes: 10_000,
        maxPriceMillimes: 20_000,
      },
      now,
      priceFields,
    );
    const clauses = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];

    expect(clauses).toContainEqual({ productType: 'E_LIQUID' });
    expect(clauses).toContainEqual({ flavor: 'Menthe' });
    expect(clauses.some((clause) => 'AND' in clause)).toBe(true);
    expect(where).toMatchObject({ publicationStatus: 'PUBLISHED' });
    const brandClause = clauses.find((clause) => 'brand' in clause);
    expect(brandClause).toMatchObject({ brand: { is: { slug: 'nexa' } } });
  });
});
