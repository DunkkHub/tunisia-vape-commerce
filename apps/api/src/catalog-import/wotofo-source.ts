import { z } from 'zod';
import { normalizeCatalogueText, sanitizedOriginalFilename, sha256 } from './catalog-identity';
import { officialProductJsonUrl, type WotofoProductDefinition } from './wotofo-catalog';

const OFFICIAL_CDN_HOST = 'cdn.shopify.com';
const OFFICIAL_CDN_PATH_PREFIX = '/s/files/1/0038/8032/1113/';
const PRODUCT_HOST = 'www.wotofo.com';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const MAX_REDIRECTS = 2;
const MAX_SYNCHRONOUS_RETRY_AFTER_MS = 5_000;

const sourceImageSchema = z.object({
  src: z.string().min(1),
  alt: z.string().nullable().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const sourceVariantSchema = z.object({
  option1: z.string().min(1),
  option2: z.string().nullable().optional(),
  featured_image: sourceImageSchema.nullable().optional(),
});

const sourceProductSchema = z.object({
  handle: z.string().min(1),
  title: z.string().min(1),
  featured_image: z.string().min(1),
  variants: z.array(sourceVariantSchema).min(1).max(250),
});

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface VerifiedWotofoVariantSource {
  option: string;
  imageUrl: string | null;
  imageAlt: string | null;
}

export interface VerifiedWotofoSource {
  handle: string;
  title: string;
  productJsonUrl: string;
  productImageUrl: string;
  variants: VerifiedWotofoVariantSource[];
  verifiedPayloadHash: string;
}

export interface DownloadedOfficialImage {
  bytes: Buffer;
  contentType: string;
  originalFilename: string;
  sourceUrl: string;
  checksumSha256: string;
}

export class WotofoSourceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WotofoSourceError';
  }
}

const normalizeSourceUrl = (value: string): string => {
  const expanded = value.startsWith('//') ? `https:${value}` : value;
  let url: URL;
  try {
    url = new URL(expanded);
  } catch {
    throw new WotofoSourceError('WOTOFO_SOURCE_URL_INVALID', 'An official source URL was invalid.');
  }
  if (url.protocol !== 'https:') {
    throw new WotofoSourceError(
      'WOTOFO_SOURCE_URL_NOT_HTTPS',
      'Official catalogue sources must use HTTPS.',
    );
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.toString();
};

export const assertOfficialImageUrl = (value: string): string => {
  const normalized = normalizeSourceUrl(value);
  const url = new URL(normalized);
  if (url.hostname !== OFFICIAL_CDN_HOST || !url.pathname.startsWith(OFFICIAL_CDN_PATH_PREFIX)) {
    throw new WotofoSourceError(
      'WOTOFO_IMAGE_HOST_NOT_ALLOWED',
      'The image did not come from the verified Wotofo asset path.',
    );
  }
  return normalized;
};

const assertProductJsonUrl = (value: string): string => {
  const normalized = normalizeSourceUrl(value);
  const url = new URL(normalized);
  if (url.hostname !== PRODUCT_HOST || !/^\/products\/[a-z0-9-]+\.js$/.test(url.pathname)) {
    throw new WotofoSourceError(
      'WOTOFO_PRODUCT_HOST_NOT_ALLOWED',
      'The catalogue record did not come from an official Wotofo product endpoint.',
    );
  }
  return normalized;
};

const selectedSourceVariants = (
  definition: WotofoProductDefinition,
  variants: z.infer<typeof sourceVariantSchema>[],
) => {
  if (definition.nicotineStrengthMg === null) return variants;
  const level = `${definition.nicotineStrengthMg}mg`.toLowerCase();
  return variants.filter(
    (variant) => normalizeCatalogueText(variant.option2 ?? '').toLowerCase() === level,
  );
};

const compareOptions = (expected: readonly string[], actual: readonly string[]): void => {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((value) => !actualSet.has(value));
  const unexpected = actual.filter((value) => !expectedSet.has(value));
  if (missing.length > 0 || unexpected.length > 0 || actual.length !== actualSet.size) {
    throw new WotofoSourceError(
      'WOTOFO_OPTIONS_MISMATCH',
      `Official options changed (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}).`,
    );
  }
};

export const verifyWotofoProductPayload = (
  definition: WotofoProductDefinition,
  payload: unknown,
): VerifiedWotofoSource => {
  const parsed = sourceProductSchema.safeParse(payload);
  if (!parsed.success) {
    throw new WotofoSourceError(
      'WOTOFO_PRODUCT_PAYLOAD_INVALID',
      'The official product response did not match the reviewed schema.',
    );
  }
  if (parsed.data.handle !== definition.handle) {
    throw new WotofoSourceError(
      'WOTOFO_HANDLE_MISMATCH',
      'The official response handle did not match the reviewed catalogue entry.',
    );
  }
  const sourceVariants = selectedSourceVariants(definition, parsed.data.variants);
  const normalized = sourceVariants.map((variant) => ({
    option: normalizeCatalogueText(variant.option1),
    imageUrl: variant.featured_image?.src
      ? assertOfficialImageUrl(variant.featured_image.src)
      : null,
    imageAlt: variant.featured_image?.alt?.trim() || null,
  }));
  compareOptions(
    definition.options,
    normalized.map(({ option }) => option),
  );
  const byOption = new Map(normalized.map((variant) => [variant.option, variant]));
  const productJsonUrl = assertProductJsonUrl(officialProductJsonUrl(definition.handle));
  return {
    handle: parsed.data.handle,
    title: parsed.data.title,
    productJsonUrl,
    productImageUrl: assertOfficialImageUrl(parsed.data.featured_image),
    variants: definition.options.map((option) => byOption.get(option)!),
    verifiedPayloadHash: sha256(JSON.stringify(parsed.data)),
  };
};

const retryDelay = async (attempt: number, retryAfter: string | null): Promise<void> => {
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  const retryDate = retryAfter && !Number.isFinite(seconds) ? Date.parse(retryAfter) : Number.NaN;
  const requestedMilliseconds = Number.isFinite(seconds)
    ? Math.max(seconds * 1_000, 0)
    : Number.isFinite(retryDate)
      ? Math.max(retryDate - Date.now(), 0)
      : null;
  if (requestedMilliseconds !== null && requestedMilliseconds > MAX_SYNCHRONOUS_RETRY_AFTER_MS) {
    throw new WotofoSourceError(
      'WOTOFO_SOURCE_RATE_LIMITED',
      'The official source requested a later retry; run verification again after that window.',
    );
  }
  const milliseconds = requestedMilliseconds ?? Math.min(250 * 2 ** attempt, 2_000);
  if (milliseconds > 0) await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const fetchWithRetry = async (
  fetcher: FetchLike,
  initialUrl: string,
  validateUrl: (value: string) => string,
  retries = DEFAULT_RETRIES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    let url = validateUrl(initialUrl);
    try {
      for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        const response = await fetcher(url, {
          headers: { Accept: 'application/json,image/avif,image/webp,image/png,image/jpeg' },
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel().catch(() => undefined);
          if (!location || redirect === MAX_REDIRECTS) {
            throw new WotofoSourceError(
              'WOTOFO_REDIRECT_REJECTED',
              'The official source returned an unsafe redirect chain.',
            );
          }
          url = validateUrl(new URL(location, url).toString());
          continue;
        }
        if (response.ok) return response;
        const retryAfter = response.headers.get('retry-after');
        await response.body?.cancel().catch(() => undefined);
        if (response.status !== 429 && response.status < 500) {
          throw new WotofoSourceError(
            'WOTOFO_SOURCE_HTTP_ERROR',
            `The official source returned HTTP ${response.status}.`,
          );
        }
        lastError = new WotofoSourceError(
          'WOTOFO_SOURCE_RETRYABLE',
          `The official source temporarily returned HTTP ${response.status}.`,
        );
        if (attempt + 1 < retries) await retryDelay(attempt, retryAfter);
        break;
      }
    } catch (error) {
      lastError = error;
      if (error instanceof WotofoSourceError && error.code !== 'WOTOFO_SOURCE_RETRYABLE')
        throw error;
      if (attempt + 1 < retries) await retryDelay(attempt, null);
    }
  }
  throw new WotofoSourceError(
    'WOTOFO_SOURCE_UNAVAILABLE',
    lastError instanceof Error ? lastError.message : 'The official source was unavailable.',
  );
};

const MAX_PRODUCT_JSON_BYTES = 2 * 1_024 * 1_024;

const boundedResponseBuffer = async (
  response: Response,
  maximumBytes: number,
  codes: {
    tooLarge: string;
    empty: string;
    tooLargeMessage: string;
    emptyMessage: string;
  } = {
    tooLarge: 'WOTOFO_IMAGE_TOO_LARGE',
    empty: 'WOTOFO_IMAGE_EMPTY',
    tooLargeMessage: 'The official image exceeds the configured upload limit.',
    emptyMessage: 'The official image response was empty.',
  },
): Promise<Buffer> => {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new WotofoSourceError(codes.tooLarge, codes.tooLargeMessage);
  }
  if (!response.body) {
    throw new WotofoSourceError(codes.empty, codes.emptyMessage);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > maximumBytes) {
      await response.body.cancel().catch(() => undefined);
      throw new WotofoSourceError(codes.tooLarge, codes.tooLargeMessage);
    }
    chunks.push(bytes);
  }
  if (total === 0) {
    throw new WotofoSourceError(codes.empty, codes.emptyMessage);
  }
  return Buffer.concat(chunks, total);
};

export class WotofoSourceClient {
  private readonly productPayloads = new Map<string, Promise<unknown>>();

  constructor(private readonly fetcher: FetchLike = globalThis.fetch) {}

  async verify(definition: WotofoProductDefinition): Promise<VerifiedWotofoSource> {
    const payload = await this.productPayload(definition.handle);
    return verifyWotofoProductPayload(definition, payload);
  }

  async downloadImage(url: string, maximumBytes: number): Promise<DownloadedOfficialImage> {
    const sourceUrl = assertOfficialImageUrl(url);
    const response = await fetchWithRetry(this.fetcher, sourceUrl, assertOfficialImageUrl);
    const contentType = (response.headers.get('content-type') ?? '')
      .split(';', 1)[0]!
      .trim()
      .toLowerCase();
    const bytes = await boundedResponseBuffer(response, maximumBytes);
    return {
      bytes,
      contentType,
      originalFilename: sanitizedOriginalFilename(new URL(sourceUrl).pathname),
      sourceUrl,
      checksumSha256: sha256(bytes),
    };
  }

  private productPayload(handle: string): Promise<unknown> {
    const existing = this.productPayloads.get(handle);
    if (existing) return existing;
    const pending = (async () => {
      const url = officialProductJsonUrl(handle);
      const response = await fetchWithRetry(this.fetcher, url, assertProductJsonUrl);
      try {
        const bytes = await boundedResponseBuffer(response, MAX_PRODUCT_JSON_BYTES, {
          tooLarge: 'WOTOFO_PRODUCT_JSON_TOO_LARGE',
          empty: 'WOTOFO_PRODUCT_JSON_EMPTY',
          tooLargeMessage: 'The official product response exceeded the safe JSON limit.',
          emptyMessage: 'The official product response was empty.',
        });
        return JSON.parse(bytes.toString('utf8')) as unknown;
      } catch (error) {
        if (error instanceof WotofoSourceError) throw error;
        throw new WotofoSourceError(
          'WOTOFO_PRODUCT_JSON_INVALID',
          'The official product response was not valid JSON.',
        );
      }
    })();
    this.productPayloads.set(handle, pending);
    return pending;
  }
}
