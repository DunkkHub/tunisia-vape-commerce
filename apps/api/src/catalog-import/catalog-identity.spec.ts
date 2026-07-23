import { describe, expect, it } from 'vitest';
import {
  catalogueSlug,
  hasUnsafeSpreadsheetPrefix,
  neutralizeSpreadsheetFormula,
  payloadHash,
  sanitizedOriginalFilename,
  wotofoProductIdentity,
  wotofoProductSlug,
  wotofoVariantIdentity,
  wotofoVariantSku,
} from './catalog-identity';

describe('catalogue import identities', () => {
  it('builds deterministic bounded slugs, identities and SKUs', () => {
    expect(catalogueSlug('  Piña  Colada ')).toBe('pina-colada');
    expect(wotofoProductSlug('nexbar-30k-20')).toBe('wotofo-nexbar-30k-20');
    expect(wotofoProductIdentity('nexbar-30k-20')).toBe('wotofo:product:nexbar-30k-20');
    expect(wotofoVariantIdentity('nexbar-30k-20', 'Cherry Dragon Fruit')).toBe(
      'wotofo:variant:nexbar-30k-20:cherry-dragon-fruit',
    );
    expect(wotofoVariantSku('nexbar-30k-20', 'Cherry Dragon Fruit')).toBe(
      'WOT-NEXBAR30K20-CHERRY-DRAGON-FRUIT',
    );
    expect(wotofoVariantSku('x'.repeat(80), 'y'.repeat(80))).toHaveLength(100);
  });

  it('hashes canonical object order identically', () => {
    expect(payloadHash({ b: 2, a: { d: 4, c: 3 } })).toBe(payloadHash({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it('neutralizes spreadsheet formulas and sanitizes client filenames', () => {
    for (const value of ['=1+1', '+cmd', '-2+3', '@SUM(A1:A2)', '  =NOW()']) {
      expect(hasUnsafeSpreadsheetPrefix(value)).toBe(true);
      expect(neutralizeSpreadsheetFormula(value).startsWith("'")).toBe(true);
    }
    expect(hasUnsafeSpreadsheetPrefix('Cherry Ice')).toBe(false);
    expect(sanitizedOriginalFilename('../../unsafe<script>.png')).toBe('unsafe-script-.png');
  });
});
