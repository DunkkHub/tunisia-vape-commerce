import { describe, expect, it } from 'vitest';
import type { CatalogPriceFieldReferences } from './catalog-policy';
import {
  buildPublicProductWhere,
  normalizeCatalogFilter,
  publicSellableVariantWhere,
} from './catalog-policy';

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

  it('requires a published non-archived variant with a strictly positive effective price', () => {
    const sellableVariant = publicSellableVariantWhere();
    const where = buildPublicProductWhere({}, new Date('2026-07-11T12:00:00.000Z'));
    const clauses = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];

    expect(sellableVariant).toEqual({
      publicationStatus: 'PUBLISHED',
      archivedAt: null,
      deletedAt: null,
      priceMillimes: { gt: 0 },
      OR: [{ promotionalPriceMillimes: null }, { promotionalPriceMillimes: { gt: 0 } }],
    });
    expect(clauses).toContainEqual({ variants: { some: sellableVariant } });
  });

  it('requires approved eligible media while leaving zero-stock products publicly visible', () => {
    const sellableVariant = publicSellableVariantWhere();
    const where = buildPublicProductWhere({}, new Date('2026-07-11T12:00:00.000Z'));
    const clauses = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    const approvedImage = { deletedAt: null, moderationStatus: 'APPROVED' };

    expect(clauses).toContainEqual({
      OR: [
        { images: { some: approvedImage } },
        {
          variants: {
            some: {
              ...sellableVariant,
              images: { some: approvedImage },
            },
          },
        },
      ],
    });
    expect(JSON.stringify(where)).not.toContain('inventoryItems');
    expect(JSON.stringify(where)).not.toContain('onHandQuantity');
  });

  it('normalizes combinable type, flavor and integer-millime price filters', () => {
    expect(
      normalizeCatalogFilter({
        brand: 'nexa',
        productType: 'E_LIQUID',
        flavor: '  Menthe glaciale ',
        puffCount: 15_000,
        nicotineStrengthMg: 20,
        minPriceMillimes: 12_500,
        maxPriceMillimes: 29_900,
      }),
    ).toMatchObject({
      brand: 'nexa',
      productType: 'E_LIQUID',
      flavor: 'Menthe glaciale',
      puffCount: 15_000,
      nicotineStrengthMg: 20,
      minPriceMillimes: 12_500,
      maxPriceMillimes: 29_900,
    });
  });

  it('combines brand, type, variant flavor, puff, nicotine and price predicates', () => {
    const now = new Date('2026-07-11T12:00:00.000Z');
    const where = buildPublicProductWhere(
      {
        brand: 'nexa',
        productType: 'E_LIQUID',
        flavor: 'menthe',
        puffCount: 15_000,
        nicotineStrengthMg: 20,
        minPriceMillimes: 10_000,
        maxPriceMillimes: 20_000,
      },
      now,
      priceFields,
    );
    const clauses = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];

    expect(clauses).toContainEqual({ productType: 'E_LIQUID' });
    expect(clauses).toContainEqual({ puffCount: 15_000 });
    expect(JSON.stringify(clauses)).toContain('"slug":"menthe"');
    expect(JSON.stringify(clauses)).toContain('"nicotineStrengthMg":20');
    expect(clauses.some((clause) => 'AND' in clause)).toBe(true);
    expect(where).toMatchObject({ publicationStatus: 'PUBLISHED' });
    const brandClause = clauses.find((clause) => 'brand' in clause);
    expect(brandClause).toMatchObject({ brand: { is: { slug: 'nexa' } } });
  });

  it('searches only public variants by localized name, SKU and flavor identity', () => {
    const where = buildPublicProductWhere(
      { search: 'Grape Ice' },
      new Date('2026-07-11T12:00:00.000Z'),
    );
    const serialized = JSON.stringify(where);

    expect(serialized).toContain('"variants":{"some"');
    expect(serialized).toContain('"publicationStatus":"PUBLISHED"');
    expect(serialized).toContain('"nameFr":{"contains":"Grape Ice"}');
    expect(serialized).toContain('"sku":{"contains":"Grape Ice"}');
    expect(serialized).toContain('"canonicalName":{"contains":"Grape Ice"}');
  });
});
