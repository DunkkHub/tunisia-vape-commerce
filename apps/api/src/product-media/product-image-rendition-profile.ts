// Increment this only when the server-controlled resize/encoding profile changes. Existing image
// rows keep their recorded profile and immutable object keys.
export const PRODUCT_IMAGE_RENDITION_PROFILE_VERSION = 1;

export const PRODUCT_IMAGE_RENDITION_NAMES = [
  'thumbnail',
  'card',
  'detail',
  'high-resolution',
] as const;
export type ProductImageRenditionName = (typeof PRODUCT_IMAGE_RENDITION_NAMES)[number];

export const PRODUCT_IMAGE_RENDITION_FORMATS = ['webp', 'jpeg'] as const;
export type ProductImageRenditionFormat = (typeof PRODUCT_IMAGE_RENDITION_FORMATS)[number];

export interface ProductImageRenditionCoordinate {
  name: string;
  format: string;
  profileVersion: number;
}

/**
 * Catalog DTOs may advertise optimized URLs only for a complete immutable profile. A partial
 * manifest would make browser format fallback unreliable and must use the verified original URL.
 */
export const hasCompleteCurrentRenditionManifest = (
  rows: readonly ProductImageRenditionCoordinate[] | null | undefined,
): boolean => {
  if (!rows) return false;
  const expected = new Set(
    PRODUCT_IMAGE_RENDITION_NAMES.flatMap((name) =>
      PRODUCT_IMAGE_RENDITION_FORMATS.map((format) => `${name}:${format}`),
    ),
  );
  if (rows.length !== expected.size) return false;

  for (const row of rows) {
    if (
      row.profileVersion !== PRODUCT_IMAGE_RENDITION_PROFILE_VERSION ||
      !expected.delete(`${row.name}:${row.format}`)
    ) {
      return false;
    }
  }
  return expected.size === 0;
};
