import { FlavorCategory, ProductType, PublicationStatus } from '@prisma/client';
import { z } from 'zod';

export const CATALOG_IMPORT_SCHEMA_VERSION = '1.0';
export const CATALOG_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const CATALOG_IMPORT_MAX_ROWS = 2_000;

export const CATALOG_IMPORT_HEADERS = [
  'schemaVersion',
  'productKey',
  'brand',
  'categorySlug',
  'family',
  'model',
  'productType',
  'nameFr',
  'nameAr',
  'slug',
  'puffCount',
  'liquidCapacityMl',
  'containsNicotine',
  'nicotineStrengthMg',
  'variantKey',
  'variantNameFr',
  'variantNameAr',
  'flavorCanonical',
  'flavorNameFr',
  'flavorNameAr',
  'flavorCategory',
  'color',
  'sku',
  'priceMillimes',
  'publicationStatus',
  'officialProductUrl',
  'productImageUrl',
  'variantImageUrl',
] as const;

const nullableText = (maximum: number) => z.string().trim().min(1).max(maximum).nullable();
const optionalInteger = z.number().int().nonnegative().max(2_147_483_647).nullable();
const optionalDecimal = z.number().nonnegative().max(99_999).nullable();
const httpsUrl = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  }, 'Only HTTPS source URLs without embedded credentials are accepted.')
  .transform((value) => {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  })
  .nullable();

export const catalogImportRowSchema = z
  .object({
    schemaVersion: z.literal(CATALOG_IMPORT_SCHEMA_VERSION),
    productKey: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(
        /^[A-Za-z0-9._-]+$/,
        'Product keys may use letters, digits, dots, underscores and hyphens.',
      ),
    brand: z.string().trim().min(1).max(160),
    categorySlug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180),
    family: nullableText(120),
    model: nullableText(160),
    productType: z.nativeEnum(ProductType),
    nameFr: z.string().trim().min(1).max(240),
    nameAr: z.string().trim().min(1).max(240),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(260),
    puffCount: optionalInteger,
    liquidCapacityMl: optionalDecimal,
    containsNicotine: z.boolean(),
    nicotineStrengthMg: optionalDecimal,
    variantKey: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .regex(
        /^[A-Za-z0-9._-]+$/,
        'Variant keys may use letters, digits, dots, underscores and hyphens.',
      ),
    variantNameFr: z.string().trim().min(1).max(200),
    variantNameAr: z.string().trim().min(1).max(200),
    flavorCanonical: nullableText(160),
    flavorNameFr: nullableText(160),
    flavorNameAr: nullableText(160),
    flavorCategory: z.nativeEnum(FlavorCategory).nullable(),
    color: nullableText(100),
    sku: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Z0-9][A-Z0-9-]*$/),
    priceMillimes: optionalInteger,
    publicationStatus: z.nativeEnum(PublicationStatus).nullable(),
    officialProductUrl: httpsUrl,
    productImageUrl: httpsUrl,
    variantImageUrl: httpsUrl,
  })
  .strict()
  .superRefine((row, context) => {
    const flavorFields = [
      row.flavorCanonical,
      row.flavorNameFr,
      row.flavorNameAr,
      row.flavorCategory,
    ];
    const flavorFieldCount = flavorFields.filter((value) => value !== null).length;
    if (flavorFieldCount !== 0 && flavorFieldCount !== flavorFields.length) {
      context.addIssue({
        code: 'custom',
        path: ['flavorCanonical'],
        message: 'Flavor metadata must be either complete or absent.',
      });
    }
    if (row.containsNicotine !== (row.nicotineStrengthMg !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['nicotineStrengthMg'],
        message: 'Nicotine products require a strength; nicotine-free products must omit it.',
      });
    }
    if (row.flavorCanonical !== null && row.color !== null) {
      context.addIssue({
        code: 'custom',
        path: ['color'],
        message: 'A row cannot represent both a flavor and a device color.',
      });
    }
    if (row.publicationStatus === 'PUBLISHED' && (row.priceMillimes ?? 0) <= 0) {
      context.addIssue({
        code: 'custom',
        path: ['publicationStatus'],
        message: 'Imported published variants require a positive price.',
      });
    }
  });

export type CatalogImportRowInput = z.infer<typeof catalogImportRowSchema>;

export interface CatalogImportIssue {
  code: string;
  message: string;
  field?: string;
}

export interface ParsedCatalogImportRow {
  rowNumber: number;
  input: CatalogImportRowInput | null;
  issues: CatalogImportIssue[];
}

export interface ParsedCatalogImport {
  schemaVersion: typeof CATALOG_IMPORT_SCHEMA_VERSION;
  rows: ParsedCatalogImportRow[];
}
