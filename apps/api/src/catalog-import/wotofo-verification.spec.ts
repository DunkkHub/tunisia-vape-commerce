import { describe, expect, it } from 'vitest';
import { WOTOFO_PRODUCTS } from './wotofo-catalog';
import {
  buildWotofoVerificationReport,
  type WotofoVerificationProduct,
} from './wotofo-verification';
import { wotofoProductSlug, wotofoVariantSku } from './catalog-identity';

const complete = (): WotofoVerificationProduct[] =>
  WOTOFO_PRODUCTS.map((definition) => ({
    sourceKey: definition.key,
    sourceUrl: `https://www.wotofo.com/products/${definition.handle}`,
    sourceVerifiedAt: '2026-07-20T00:00:00.000Z',
    slug: wotofoProductSlug(definition.key),
    nameFr: definition.name,
    nameAr: definition.name,
    status: 'DRAFT',
    requiresPricing: true,
    requiresStock: true,
    needsMediaReview: false,
    approvedImageCount: 1,
    verifiedImageSourceCount: 1,
    variants: definition.options.map((option) => ({
      sku: wotofoVariantSku(definition.key, option),
      flavorCanonical: definition.optionKind === 'flavor' ? option : null,
      flavorNameFr: definition.optionKind === 'flavor' ? option : null,
      flavorNameAr: definition.optionKind === 'flavor' ? option : null,
      color: definition.optionKind === 'color' ? option : null,
      priceMillimes: 0,
      availableQuantity: 0,
    })),
  }));

describe('Wotofo catalogue verification report', () => {
  it('passes structural draft data while reporting manual price and stock work', () => {
    const report = buildWotofoVerificationReport(complete(), new Date('2026-07-20T12:00:00Z'));
    expect(report).toMatchObject({ valid: true, actualProductCount: 19, actualVariantCount: 321 });
    expect(report.productsRequiringPricing).toHaveLength(19);
    expect(report.productsRequiringStock).toHaveLength(19);
  });

  it('fails for a missing product image without treating draft zero prices as structural', () => {
    const products = complete();
    const first = products[0];
    if (!first) throw new Error('The verification fixture requires at least one product.');
    products[0] = { ...first, approvedImageCount: 0 };
    const report = buildWotofoVerificationReport(products);
    expect(report.valid).toBe(false);
    expect(report.productsWithoutImages).toEqual([first.sourceKey]);
    expect(report.structuralErrors.some((error) => error.includes('approved image'))).toBe(true);
  });
});
