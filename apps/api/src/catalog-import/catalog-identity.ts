import { createHash } from 'node:crypto';

const COMBINING_MARKS = /[\u0300-\u036f]/g;
export const normalizeCatalogueText = (value: string): string =>
  value.replace(/[\u00a0\s]+/g, ' ').trim();

export const catalogueSlug = (value: string): string => {
  const slug = normalizeCatalogueText(value)
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (!slug) throw new TypeError('A catalogue slug requires at least one ASCII letter or digit.');
  return slug;
};

export const wotofoProductSlug = (key: string): string => `wotofo-${catalogueSlug(key)}`;

export const wotofoVariantSku = (productKey: string, option: string): string => {
  const prefix = `WOT-${catalogueSlug(productKey).replaceAll('-', '').toUpperCase()}`;
  const suffix = catalogueSlug(option).toUpperCase();
  const full = `${prefix}-${suffix}`;
  if (full.length <= 100) return full;
  const digest = createHash('sha256').update(full).digest('hex').slice(0, 10).toUpperCase();
  return `${full.slice(0, 89)}-${digest}`;
};

export const wotofoProductIdentity = (key: string): string =>
  `wotofo:product:${catalogueSlug(key)}`;

export const wotofoVariantIdentity = (productKey: string, option: string): string =>
  `wotofo:variant:${catalogueSlug(productKey)}:${catalogueSlug(option)}`;

export const sha256 = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
};

export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

export const payloadHash = (value: unknown): string => sha256(canonicalJson(value));

export const hasUnsafeSpreadsheetPrefix = (value: string): boolean => {
  const firstContent = [...value].find((character) => character.charCodeAt(0) > 0x20);
  return firstContent !== undefined && '=+@-'.includes(firstContent);
};

export const neutralizeSpreadsheetFormula = (value: string): string =>
  hasUnsafeSpreadsheetPrefix(value) ? `'${value}` : value;

export const sanitizedOriginalFilename = (value: string): string => {
  const leaf = value.replaceAll('\\', '/').split('/').pop() ?? 'image';
  const sanitized = leaf
    .normalize('NFKC')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .replace(/[^\p{L}\p{N}._ -]+/gu, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 255);
  return sanitized || 'image';
};
