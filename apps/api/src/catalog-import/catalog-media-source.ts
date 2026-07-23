import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { basename, extname } from 'node:path';
import { Agent, fetch as undiciFetch } from 'undici';
import { sha256 } from './catalog-identity';

type FetchLike = (
  input: string | URL,
  init?: NonNullable<Parameters<typeof undiciFetch>[1]>,
) => Promise<Response>;
type LookupAddress = { address: string; family: number };
type LookupLike = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>;

const IMAGE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 2;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRIES = 2;
const MAX_SYNCHRONOUS_RETRY_AFTER_MS = 5_000;

export interface DownloadedCatalogImage {
  bytes: Buffer;
  contentType: string;
  originalFilename: string;
  sourceUrl: string;
  resolvedSourceUrl: string;
  checksumSha256: string;
}

export class CatalogMediaSourceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogMediaSourceError';
  }
}

const publicIpv4 = (address: string): boolean => {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return false;
  }
  const [first, second, third] = octets as [number, number, number, number];
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && second === 168) return false;
  if (first === 192 && second === 0 && (third === 0 || third === 2)) return false;
  if (first === 198 && (second === 18 || second === 19)) return false;
  if (first === 198 && second === 51 && third === 100) return false;
  if (first === 203 && second === 0 && third === 113) return false;
  return true;
};

const publicIpv6 = (address: string): boolean => {
  const normalized = address.toLowerCase().split('%', 1)[0] ?? '';
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('::ffff:')) return false;
  if (normalized.startsWith('2001:db8:')) return false;
  // Globally routable unicast currently occupies 2000::/3. Rejecting every other range is
  // deliberately conservative for an operator-controlled catalogue allowlist.
  return normalized.startsWith('2') || normalized.startsWith('3');
};

export const isPublicCatalogMediaAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return publicIpv4(address);
  if (family === 6) return publicIpv6(address);
  return false;
};

const safeOriginalFilename = (pathname: string): string => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  const extension = extname(decoded).toLowerCase();
  const safeExtension = ['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(extension)
    ? extension
    : '.image';
  const stem = basename(decoded, extension)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${stem || 'catalog-image'}${safeExtension}`;
};

const boundedResponseBuffer = async (response: Response, maximumBytes: number): Promise<Buffer> => {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new CatalogMediaSourceError(
      'CATALOG_MEDIA_IMAGE_TOO_LARGE',
      'The catalogue image exceeds the configured upload limit.',
    );
  }
  if (!response.body) {
    throw new CatalogMediaSourceError(
      'CATALOG_MEDIA_IMAGE_EMPTY',
      'The catalogue image response was empty.',
    );
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > maximumBytes) {
      await response.body.cancel().catch(() => undefined);
      throw new CatalogMediaSourceError(
        'CATALOG_MEDIA_IMAGE_TOO_LARGE',
        'The catalogue image exceeds the configured upload limit.',
      );
    }
    chunks.push(bytes);
  }
  if (total === 0) {
    throw new CatalogMediaSourceError(
      'CATALOG_MEDIA_IMAGE_EMPTY',
      'The catalogue image response was empty.',
    );
  }
  return Buffer.concat(chunks, total);
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
    throw new CatalogMediaSourceError(
      'CATALOG_MEDIA_SOURCE_RATE_LIMITED',
      'The catalogue media source requested a later retry; run the media import again after that window.',
    );
  }
  const milliseconds = requestedMilliseconds ?? Math.min(250 * 2 ** attempt, 2_000);
  if (milliseconds > 0) await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

type PinnedLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | Array<{ address: string; family: 4 | 6 }>,
  family?: 4 | 6,
) => void;

export const createPinnedCatalogMediaLookup = (addresses: LookupAddress[]): LookupFunction => {
  const lookupWithPinnedAddresses = (
    _hostname: string,
    options: number | { family?: number; all?: boolean },
    callback: PinnedLookupCallback,
  ): void => {
    const requestedFamily = typeof options === 'number' ? options : (options.family ?? 0);
    const all = typeof options === 'object' && Boolean(options.all);
    const candidates = addresses
      .filter(({ family }) => family === 4 || family === 6)
      .filter(({ family }) => requestedFamily === 0 || family === requestedFamily)
      .map(({ address, family }) => ({ address, family: family as 4 | 6 }));
    if (candidates.length === 0) {
      const error = new Error(
        'No validated address matches the requested family.',
      ) as NodeJS.ErrnoException;
      error.code = 'ENOTFOUND';
      callback(error, all ? [] : '', undefined);
      return;
    }
    if (all) {
      callback(null, candidates);
      return;
    }
    callback(null, candidates[0]!.address, candidates[0]!.family);
  };
  return lookupWithPinnedAddresses as unknown as LookupFunction;
};

export class CatalogMediaSourceClient {
  private readonly allowedHosts: ReadonlySet<string>;

  constructor(
    allowedHosts: readonly string[],
    private readonly fetcher: FetchLike = undiciFetch as unknown as FetchLike,
    private readonly resolver: LookupLike = lookup,
  ) {
    this.allowedHosts = new Set(allowedHosts.map((host) => host.toLowerCase()));
  }

  async downloadImage(url: string, maximumBytes: number): Promise<DownloadedCatalogImage> {
    const initialUrl = this.validatedUrl(url);
    let lastError: unknown;
    for (let attempt = 0; attempt < RETRIES; attempt += 1) {
      let currentUrl = initialUrl;
      try {
        for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
          const addresses = await this.publicResolution(currentUrl.hostname);
          const dispatcher = new Agent({
            connect: { lookup: createPinnedCatalogMediaLookup(addresses) },
            connectTimeout: REQUEST_TIMEOUT_MS,
          });
          try {
            const response = await this.fetcher(currentUrl, {
              headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg' },
              redirect: 'manual',
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
              dispatcher,
            });
            if (REDIRECT_STATUSES.has(response.status)) {
              const location = response.headers.get('location');
              await response.body?.cancel().catch(() => undefined);
              if (!location || redirect === MAX_REDIRECTS) {
                throw new CatalogMediaSourceError(
                  'CATALOG_MEDIA_REDIRECT_REJECTED',
                  'The catalogue media source returned an unsafe redirect chain.',
                );
              }
              currentUrl = this.validatedUrl(new URL(location, currentUrl).toString());
              continue;
            }
            if (!response.ok) {
              const retryAfter = response.headers.get('retry-after');
              await response.body?.cancel().catch(() => undefined);
              if (response.status !== 429 && response.status < 500) {
                throw new CatalogMediaSourceError(
                  'CATALOG_MEDIA_SOURCE_HTTP_ERROR',
                  `The catalogue media source returned HTTP ${response.status}.`,
                );
              }
              lastError = new CatalogMediaSourceError(
                'CATALOG_MEDIA_SOURCE_RETRYABLE',
                `The catalogue media source temporarily returned HTTP ${response.status}.`,
              );
              if (attempt + 1 < RETRIES) await retryDelay(attempt, retryAfter);
              break;
            }
            const contentType = (response.headers.get('content-type') ?? '')
              .split(';', 1)[0]!
              .trim()
              .toLowerCase();
            if (!IMAGE_CONTENT_TYPES.has(contentType)) {
              await response.body?.cancel().catch(() => undefined);
              throw new CatalogMediaSourceError(
                'CATALOG_MEDIA_CONTENT_TYPE_REJECTED',
                'The catalogue media response did not declare an allowed raster image type.',
              );
            }
            const bytes = await boundedResponseBuffer(response, maximumBytes);
            return {
              bytes,
              contentType,
              originalFilename: safeOriginalFilename(currentUrl.pathname),
              sourceUrl: initialUrl.toString(),
              resolvedSourceUrl: currentUrl.toString(),
              checksumSha256: sha256(bytes),
            };
          } finally {
            await dispatcher.close();
          }
        }
      } catch (error) {
        lastError = error;
        if (
          error instanceof CatalogMediaSourceError &&
          error.code !== 'CATALOG_MEDIA_SOURCE_RETRYABLE'
        ) {
          throw error;
        }
        if (attempt + 1 < RETRIES) await retryDelay(attempt, null);
      }
    }
    throw new CatalogMediaSourceError(
      'CATALOG_MEDIA_SOURCE_UNAVAILABLE',
      lastError instanceof Error
        ? lastError.message
        : 'The catalogue media source was unavailable.',
    );
  }

  private validatedUrl(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new CatalogMediaSourceError(
        'CATALOG_MEDIA_URL_REJECTED',
        'The catalogue media URL is invalid.',
      );
    }
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      Boolean(url.username || url.password) ||
      (url.port !== '' && url.port !== '443') ||
      !this.allowedHosts.has(hostname)
    ) {
      throw new CatalogMediaSourceError(
        'CATALOG_MEDIA_HOST_NOT_ALLOWED',
        'The catalogue media URL is not on the configured HTTPS host allowlist.',
      );
    }
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url;
  }

  private async publicResolution(hostname: string): Promise<LookupAddress[]> {
    let addresses: LookupAddress[];
    try {
      addresses = await this.resolver(hostname, { all: true, verbatim: true });
    } catch {
      throw new CatalogMediaSourceError(
        'CATALOG_MEDIA_HOST_UNAVAILABLE',
        'The catalogue media hostname could not be resolved.',
      );
    }
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => !isPublicCatalogMediaAddress(address))
    ) {
      throw new CatalogMediaSourceError(
        'CATALOG_MEDIA_PRIVATE_ADDRESS_REJECTED',
        'The catalogue media hostname resolved to a non-public address.',
      );
    }
    return addresses;
  }
}
