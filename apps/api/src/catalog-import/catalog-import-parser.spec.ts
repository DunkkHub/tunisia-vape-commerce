import { describe, expect, it } from 'vitest';
import { CATALOG_IMPORT_HEADERS } from './catalog-import-contract';
import { parseCatalogCsv, parseCatalogJson } from './catalog-import-parser';

const valid = {
  schemaVersion: '1.0',
  productKey: 'nexbar-30k-20',
  brand: 'Wotofo',
  categorySlug: 'disposables',
  family: 'nexBAR',
  model: '30K',
  productType: 'DISPOSABLE',
  nameFr: 'Wotofo nexBAR 30K',
  nameAr: 'Wotofo nexBAR 30K',
  slug: 'wotofo-nexbar-30k-20',
  puffCount: 30000,
  liquidCapacityMl: 35,
  containsNicotine: true,
  nicotineStrengthMg: 20,
  variantKey: 'cherry-dragon-fruit',
  variantNameFr: 'Cerise et fruit du dragon',
  variantNameAr: 'كرز وفاكهة التنين',
  flavorCanonical: 'Cherry Dragon Fruit',
  flavorNameFr: 'Cerise et fruit du dragon',
  flavorNameAr: 'كرز وفاكهة التنين',
  flavorCategory: 'MIXED_FRUIT',
  color: null,
  sku: 'WOT-NEXBAR30K20-CHERRY-DRAGON-FRUIT',
  priceMillimes: null,
  publicationStatus: null,
  officialProductUrl: 'https://www.wotofo.com/products/nexbar-30k',
  productImageUrl: 'https://cdn.shopify.com/s/files/1/0038/8032/1113/files/nexbar-30k.jpg',
  variantImageUrl: null,
};

describe('catalogue import parser', () => {
  it('parses the bounded JSON contract', () => {
    const result = parseCatalogJson(
      Buffer.from(JSON.stringify({ schemaVersion: '1.0', rows: [valid] })),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.issues).toEqual([]);
    expect(result.rows[0]?.input?.sku).toBe(valid.sku);
  });

  it('rejects unknown JSON container and row fields instead of silently discarding typos', () => {
    expect(() =>
      parseCatalogJson(
        Buffer.from(
          JSON.stringify({ schemaVersion: '1.0', rows: [valid], unexpectedOption: true }),
        ),
      ),
    ).toThrow(/requires schemaVersion 1\.0 and a rows array/);

    const result = parseCatalogJson(
      Buffer.from(
        JSON.stringify({
          schemaVersion: '1.0',
          rows: [{ ...valid, priceMilimes: 99_000 }],
        }),
      ),
    );
    expect(result.rows[0]?.input).toBeNull();
    const unknownFieldIssue = result.rows[0]?.issues.find(
      ({ code }) => code === 'ROW_VALIDATION_FAILED',
    );
    expect(unknownFieldIssue?.message).toMatch(/Unrecognized key/);
  });

  it('parses exact CSV headers and quoted cells', () => {
    const values = CATALOG_IMPORT_HEADERS.map((header) => {
      const value = valid[header];
      return value === null ? '' : String(value).replaceAll('"', '""');
    });
    const csv = `${CATALOG_IMPORT_HEADERS.join(',')}\n${values.map((value) => `"${value}"`).join(',')}\n`;
    const result = parseCatalogCsv(Buffer.from(csv));
    expect(result.rows[0]?.issues).toEqual([]);
    expect(result.rows[0]?.input?.flavorCanonical).toBe('Cherry Dragon Fruit');
  });

  it('round-trips the UTF-8 BOM emitted by the downloadable CSV template', () => {
    const values = CATALOG_IMPORT_HEADERS.map((header) => {
      const value = valid[header];
      return value === null ? '' : String(value).replaceAll('"', '""');
    });
    const csv = `\uFEFF${CATALOG_IMPORT_HEADERS.join(',')}\r\n${values
      .map((value) => `"${value}"`)
      .join(',')}\r\n`;

    expect(parseCatalogCsv(Buffer.from(csv)).rows[0]?.issues).toEqual([]);
  });

  it('rejects malformed UTF-8 instead of accepting decoder replacement characters', () => {
    expect(() => parseCatalogCsv(Buffer.from([0xc3, 0x28]))).toThrow(/must be UTF-8/);
    expect(() => parseCatalogJson(Buffer.from([0xc3, 0x28]))).toThrow(/must be UTF-8/);
  });

  it('reports formula injection and row validation without accepting the row', () => {
    const result = parseCatalogJson(
      Buffer.from(
        JSON.stringify({
          schemaVersion: '1.0',
          rows: [{ ...valid, variantNameFr: '=HYPERLINK("https://example.com")' }],
        }),
      ),
    );
    expect(result.rows[0]?.input).toBeNull();
    expect(result.rows[0]?.issues.map(({ code }) => code)).toContain('UNSAFE_SPREADSHEET_FORMULA');
  });

  it('rejects embedded URL credentials and strips query secrets before persistence', () => {
    const rejected = parseCatalogJson(
      Buffer.from(
        JSON.stringify({
          schemaVersion: '1.0',
          rows: [{ ...valid, productImageUrl: 'https://user:secret@cdn.example.com/image.jpg' }],
        }),
      ),
    );
    expect(rejected.rows[0]?.input).toBeNull();

    const sanitized = parseCatalogJson(
      Buffer.from(
        JSON.stringify({
          schemaVersion: '1.0',
          rows: [
            {
              ...valid,
              productImageUrl: 'https://cdn.example.com/image.jpg?token=sensitive#fragment',
            },
          ],
        }),
      ),
    );
    expect(sanitized.rows[0]?.issues).toEqual([]);
    expect(sanitized.rows[0]?.input?.productImageUrl).toBe('https://cdn.example.com/image.jpg');
  });

  it('rejects delimiter-bearing keys so distinct product and variant pairs cannot collide', () => {
    const result = parseCatalogJson(
      Buffer.from(
        JSON.stringify({
          schemaVersion: '1.0',
          rows: [
            { ...valid, productKey: 'a:b', variantKey: 'c' },
            { ...valid, productKey: 'a', variantKey: 'b:c', sku: `${valid.sku}-SECOND` },
          ],
        }),
      ),
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.every(({ input }) => input === null)).toBe(true);
    expect(result.rows.flatMap(({ issues }) => issues.map(({ code }) => code))).toEqual([
      'ROW_VALIDATION_FAILED',
      'ROW_VALIDATION_FAILED',
    ]);
  });
});
