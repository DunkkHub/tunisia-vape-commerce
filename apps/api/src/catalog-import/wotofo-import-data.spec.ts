import { describe, expect, it } from 'vitest';
import { WOTOFO_EXPECTED_VARIANT_COUNT, WOTOFO_PRODUCTS } from './wotofo-catalog';
import { buildWotofoImportRows } from './wotofo-import-data';

describe('reviewed Wotofo import data', () => {
  it('builds the exact product and variant count with unique identities', () => {
    const sources = WOTOFO_PRODUCTS.map((definition) => ({
      handle: definition.handle,
      title: definition.name,
      productJsonUrl: `https://www.wotofo.com/products/${definition.handle}.js`,
      productImageUrl: 'https://cdn.shopify.com/s/files/1/0038/8032/1113/files/product-image.png',
      variants: definition.options.map((option) => ({ option, imageUrl: null, imageAlt: null })),
      verifiedPayloadHash: 'a'.repeat(64),
    }));
    const rows = buildWotofoImportRows(sources);
    expect(new Set(rows.map(({ productKey }) => productKey)).size).toBe(WOTOFO_PRODUCTS.length);
    expect(rows).toHaveLength(WOTOFO_EXPECTED_VARIANT_COUNT);
    expect(new Set(rows.map(({ sku }) => sku)).size).toBe(rows.length);
    expect(
      rows.every(({ priceMillimes, publicationStatus }) => !priceMillimes && !publicationStatus),
    ).toBe(true);
  });

  it('uses the corrected official device colors and refillable AEROK classification', () => {
    const normal = WOTOFO_PRODUCTS.find(({ key }) => key === 'nexpod-15k-device')!;
    const pro = WOTOFO_PRODUCTS.find(({ key }) => key === 'nexpod-15k-pro-device')!;
    const aerok = WOTOFO_PRODUCTS.find(({ key }) => key === 'aerok-pod-kit')!;
    expect(normal.options).toEqual(['Fiery Sunrise', 'Blue Gradient', 'Rose Gold', 'Red', 'Black']);
    expect(pro.options).toEqual(['Black', 'Blue', 'Cosmic Orange', 'Red', 'Rose Gold', 'Silver']);
    expect(aerok).toMatchObject({ productType: 'POD', nicotineStrengthMg: null, puffCount: null });
  });
});
