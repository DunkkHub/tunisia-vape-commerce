import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { TextDecoder } from 'node:util';
import { hasUnsafeSpreadsheetPrefix, normalizeCatalogueText } from './catalog-identity';
import {
  CATALOG_IMPORT_HEADERS,
  CATALOG_IMPORT_MAX_BYTES,
  CATALOG_IMPORT_MAX_ROWS,
  CATALOG_IMPORT_SCHEMA_VERSION,
  catalogImportRowSchema,
  type CatalogImportIssue,
  type ParsedCatalogImport,
  type ParsedCatalogImportRow,
} from './catalog-import-contract';

const MAX_CELL_LENGTH = 2_048;

const malformed = (code: string, message: string): BadRequestException =>
  new BadRequestException({ code, message });

const decodeUtf8 = (bytes: Buffer): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw malformed('CATALOG_IMPORT_ENCODING_INVALID', 'The catalogue import must be UTF-8.');
  }
};

const parseCsvRecords = (text: string): string[][] => {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      if (cell.length > MAX_CELL_LENGTH) {
        throw malformed('CATALOG_IMPORT_CELL_TOO_LONG', 'A catalogue import cell is too long.');
      }
      continue;
    }
    if (character === '"') {
      if (cell.length > 0) {
        throw malformed('CATALOG_IMPORT_CSV_INVALID', 'A quoted CSV cell must begin with a quote.');
      }
      quoted = true;
    } else if (character === ',') {
      record.push(cell);
      cell = '';
    } else if (character === '\n') {
      record.push(cell.replace(/\r$/, ''));
      records.push(record);
      record = [];
      cell = '';
      if (records.length > CATALOG_IMPORT_MAX_ROWS + 1) {
        throw malformed('CATALOG_IMPORT_ROW_LIMIT', 'The catalogue import has too many rows.');
      }
    } else {
      cell += character;
      if (cell.length > MAX_CELL_LENGTH) {
        throw malformed('CATALOG_IMPORT_CELL_TOO_LONG', 'A catalogue import cell is too long.');
      }
    }
  }
  if (quoted) {
    throw malformed('CATALOG_IMPORT_CSV_INVALID', 'The catalogue CSV has an unclosed quote.');
  }
  if (cell.length > 0 || record.length > 0) {
    record.push(cell.replace(/\r$/, ''));
    records.push(record);
  }
  return records;
};

const nullable = (value: string): string | null => {
  const normalized = normalizeCatalogueText(value);
  return normalized || null;
};

const integer = (value: string, field: string, issues: CatalogImportIssue[]): number | null => {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) {
    issues.push({ code: 'INVALID_INTEGER', field, message: `${field} must be a whole number.` });
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    issues.push({ code: 'INVALID_INTEGER', field, message: `${field} is outside the safe range.` });
    return null;
  }
  return parsed;
};

const decimal = (value: string, field: string, issues: CatalogImportIssue[]): number | null => {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) {
    issues.push({ code: 'INVALID_DECIMAL', field, message: `${field} has an invalid decimal.` });
    return null;
  }
  return Number(normalized);
};

const boolean = (value: string, issues: CatalogImportIssue[]): boolean => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  issues.push({
    code: 'INVALID_BOOLEAN',
    field: 'containsNicotine',
    message: 'containsNicotine must be true or false.',
  });
  return false;
};

const csvRow = (cells: string[], rowNumber: number): ParsedCatalogImportRow => {
  const issues: CatalogImportIssue[] = [];
  for (const [index, cell] of cells.entries()) {
    if (hasUnsafeSpreadsheetPrefix(cell)) {
      const header = CATALOG_IMPORT_HEADERS[index];
      issues.push({
        code: 'UNSAFE_SPREADSHEET_FORMULA',
        ...(header ? { field: header } : {}),
        message: 'Spreadsheet formula prefixes are not accepted in catalogue imports.',
      });
    }
  }
  if (cells.length !== CATALOG_IMPORT_HEADERS.length) {
    issues.push({
      code: 'CATALOG_IMPORT_COLUMN_COUNT',
      message: `Expected ${CATALOG_IMPORT_HEADERS.length} columns but received ${cells.length}.`,
    });
  }
  const value = (header: (typeof CATALOG_IMPORT_HEADERS)[number]): string =>
    cells[CATALOG_IMPORT_HEADERS.indexOf(header)] ?? '';
  const candidate = {
    schemaVersion: value('schemaVersion'),
    productKey: normalizeCatalogueText(value('productKey')),
    brand: normalizeCatalogueText(value('brand')),
    categorySlug: normalizeCatalogueText(value('categorySlug')),
    family: nullable(value('family')),
    model: nullable(value('model')),
    productType: normalizeCatalogueText(value('productType')),
    nameFr: normalizeCatalogueText(value('nameFr')),
    nameAr: normalizeCatalogueText(value('nameAr')),
    slug: normalizeCatalogueText(value('slug')),
    puffCount: integer(value('puffCount'), 'puffCount', issues),
    liquidCapacityMl: decimal(value('liquidCapacityMl'), 'liquidCapacityMl', issues),
    containsNicotine: boolean(value('containsNicotine'), issues),
    nicotineStrengthMg: decimal(value('nicotineStrengthMg'), 'nicotineStrengthMg', issues),
    variantKey: normalizeCatalogueText(value('variantKey')),
    variantNameFr: normalizeCatalogueText(value('variantNameFr')),
    variantNameAr: normalizeCatalogueText(value('variantNameAr')),
    flavorCanonical: nullable(value('flavorCanonical')),
    flavorNameFr: nullable(value('flavorNameFr')),
    flavorNameAr: nullable(value('flavorNameAr')),
    flavorCategory: nullable(value('flavorCategory')),
    color: nullable(value('color')),
    sku: normalizeCatalogueText(value('sku')),
    priceMillimes: integer(value('priceMillimes'), 'priceMillimes', issues),
    publicationStatus: nullable(value('publicationStatus')),
    officialProductUrl: nullable(value('officialProductUrl')),
    productImageUrl: nullable(value('productImageUrl')),
    variantImageUrl: nullable(value('variantImageUrl')),
  };
  const parsed = catalogImportRowSchema.safeParse(candidate);
  if (!parsed.success) {
    issues.push(
      ...parsed.error.issues.map((issue) => ({
        code: 'ROW_VALIDATION_FAILED',
        ...(issue.path.length > 0 ? { field: issue.path.join('.') } : {}),
        message: issue.message,
      })),
    );
  }
  return { rowNumber, input: issues.length === 0 && parsed.success ? parsed.data : null, issues };
};

export const parseCatalogCsv = (bytes: Buffer): ParsedCatalogImport => {
  if (bytes.length === 0) throw malformed('CATALOG_IMPORT_EMPTY', 'The catalogue CSV is empty.');
  if (bytes.length > CATALOG_IMPORT_MAX_BYTES) {
    throw new PayloadTooLargeException({
      code: 'CATALOG_IMPORT_TOO_LARGE',
      message: `The catalogue import must not exceed ${CATALOG_IMPORT_MAX_BYTES} bytes.`,
    });
  }
  const text = decodeUtf8(bytes).replace(/^\uFEFF/, '');
  const records = parseCsvRecords(text);
  const header = records.shift();
  if (!header || header.join('\u0000') !== CATALOG_IMPORT_HEADERS.join('\u0000')) {
    throw malformed(
      'CATALOG_IMPORT_HEADERS_INVALID',
      `The catalogue CSV headers must be exactly: ${CATALOG_IMPORT_HEADERS.join(',')}.`,
    );
  }
  if (records.length === 0) {
    throw malformed('CATALOG_IMPORT_EMPTY', 'The catalogue CSV contains no data rows.');
  }
  return {
    schemaVersion: CATALOG_IMPORT_SCHEMA_VERSION,
    rows: records.map((record, index) => csvRow(record, index + 2)),
  };
};

export const parseCatalogJson = (bytes: Buffer): ParsedCatalogImport => {
  if (bytes.length === 0) throw malformed('CATALOG_IMPORT_EMPTY', 'The catalogue JSON is empty.');
  if (bytes.length > CATALOG_IMPORT_MAX_BYTES) {
    throw new PayloadTooLargeException({
      code: 'CATALOG_IMPORT_TOO_LARGE',
      message: `The catalogue import must not exceed ${CATALOG_IMPORT_MAX_BYTES} bytes.`,
    });
  }
  const text = decodeUtf8(bytes);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw malformed('CATALOG_IMPORT_JSON_INVALID', 'The catalogue import is not valid JSON.');
  }
  const container = payload as { schemaVersion?: unknown; rows?: unknown };
  const containerKeys =
    container && typeof container === 'object' && !Array.isArray(container)
      ? Object.keys(container)
      : [];
  if (
    !container ||
    typeof container !== 'object' ||
    Array.isArray(container) ||
    containerKeys.length !== 2 ||
    containerKeys.some((key) => key !== 'schemaVersion' && key !== 'rows') ||
    container.schemaVersion !== CATALOG_IMPORT_SCHEMA_VERSION ||
    !Array.isArray(container.rows)
  ) {
    throw malformed(
      'CATALOG_IMPORT_JSON_SHAPE_INVALID',
      'The JSON import requires schemaVersion 1.0 and a rows array.',
    );
  }
  if (container.rows.length === 0 || container.rows.length > CATALOG_IMPORT_MAX_ROWS) {
    throw malformed(
      'CATALOG_IMPORT_ROW_LIMIT',
      `The JSON import requires between 1 and ${CATALOG_IMPORT_MAX_ROWS} rows.`,
    );
  }
  return {
    schemaVersion: CATALOG_IMPORT_SCHEMA_VERSION,
    rows: container.rows.map((candidate, index) => {
      const parsed = catalogImportRowSchema.safeParse(candidate);
      const issues: CatalogImportIssue[] = [];
      if (candidate && typeof candidate === 'object') {
        for (const [field, value] of Object.entries(candidate as Record<string, unknown>)) {
          if (typeof value === 'string' && hasUnsafeSpreadsheetPrefix(value)) {
            issues.push({
              code: 'UNSAFE_SPREADSHEET_FORMULA',
              field,
              message: 'Spreadsheet formula prefixes are not accepted in catalogue imports.',
            });
          }
        }
      }
      if (!parsed.success) {
        issues.push(
          ...parsed.error.issues.map((issue) => ({
            code: 'ROW_VALIDATION_FAILED',
            ...(issue.path.length > 0 ? { field: issue.path.join('.') } : {}),
            message: issue.message,
          })),
        );
      }
      return {
        rowNumber: index + 1,
        input: issues.length === 0 && parsed.success ? parsed.data : null,
        issues,
      };
    }),
  };
};
