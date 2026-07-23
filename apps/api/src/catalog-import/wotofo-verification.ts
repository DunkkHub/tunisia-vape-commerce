import type { PublicationStatus } from '@prisma/client';
import { wotofoProductSlug, wotofoVariantSku } from './catalog-identity';
import { WOTOFO_PRODUCTS } from './wotofo-catalog';

export interface WotofoVerificationVariant {
  sku: string;
  flavorCanonical: string | null;
  flavorNameFr: string | null;
  flavorNameAr: string | null;
  color: string | null;
  priceMillimes: number;
  availableQuantity: number;
}

export interface WotofoVerificationProduct {
  sourceKey: string;
  sourceUrl: string;
  sourceVerifiedAt: string;
  slug: string;
  nameFr: string;
  nameAr: string;
  status: PublicationStatus;
  requiresPricing: boolean;
  requiresStock: boolean;
  needsMediaReview: boolean;
  approvedImageCount: number;
  verifiedImageSourceCount: number;
  variants: WotofoVerificationVariant[];
}

export interface WotofoVerificationReport {
  generatedAt: string;
  expectedProductCount: number;
  actualProductCount: number;
  expectedVariantCount: number;
  actualVariantCount: number;
  duplicateSkus: string[];
  duplicateSlugs: string[];
  productsWithoutImages: string[];
  productsWithoutVerifiedImageSources: string[];
  variantsMissingIdentity: string[];
  productsMissingTranslations: string[];
  productsMissingVerifiedSourceMetadata: string[];
  productsRequiringMediaReview: string[];
  productsRequiringPricing: string[];
  productsRequiringStock: string[];
  missingProducts: string[];
  unexpectedProducts: string[];
  structuralErrors: string[];
  valid: boolean;
}

const duplicates = (values: string[]): string[] => {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
};

export const buildWotofoVerificationReport = (
  products: readonly WotofoVerificationProduct[],
  now = new Date(),
): WotofoVerificationReport => {
  const definitions = new Map(WOTOFO_PRODUCTS.map((definition) => [definition.key, definition]));
  const actualByKey = new Map(products.map((product) => [product.sourceKey, product]));
  const missingProducts = [...definitions.keys()].filter((key) => !actualByKey.has(key)).sort();
  const unexpectedProducts = [...actualByKey.keys()].filter((key) => !definitions.has(key)).sort();
  const allVariants = products.flatMap(({ variants }) => variants);
  const duplicateSkus = duplicates(allVariants.map(({ sku }) => sku));
  const duplicateSlugs = duplicates(products.map(({ slug }) => slug));
  const productsWithoutImages = products
    .filter(({ approvedImageCount }) => approvedImageCount < 1)
    .map(({ sourceKey }) => sourceKey)
    .sort();
  const productsWithoutVerifiedImageSources = products
    .filter(({ verifiedImageSourceCount }) => verifiedImageSourceCount < 1)
    .map(({ sourceKey }) => sourceKey)
    .sort();
  const productsMissingTranslations = products
    .filter(
      ({ nameFr, nameAr, variants }) =>
        !nameFr ||
        !nameAr ||
        variants.some(
          ({ flavorCanonical, flavorNameFr, flavorNameAr }) =>
            flavorCanonical && (!flavorNameFr || !flavorNameAr),
        ),
    )
    .map(({ sourceKey }) => sourceKey)
    .sort();
  const productsMissingVerifiedSourceMetadata = products
    .filter(({ sourceUrl, sourceVerifiedAt }) => !sourceUrl || !sourceVerifiedAt)
    .map(({ sourceKey }) => sourceKey)
    .sort();
  const variantsMissingIdentity: string[] = [];
  for (const [sourceKey, definition] of definitions) {
    const product = actualByKey.get(sourceKey);
    if (!product) continue;
    const expectedSkus = new Set(
      definition.options.map((option) => wotofoVariantSku(definition.key, option)),
    );
    const actualSkus = new Set(product.variants.map(({ sku }) => sku));
    for (const sku of expectedSkus) if (!actualSkus.has(sku)) variantsMissingIdentity.push(sku);
    for (const sku of actualSkus) if (!expectedSkus.has(sku)) variantsMissingIdentity.push(sku);
    if (product.slug !== wotofoProductSlug(sourceKey)) variantsMissingIdentity.push(product.slug);
  }
  variantsMissingIdentity.sort();
  const productsRequiringMediaReview = products
    .filter(({ needsMediaReview }) => needsMediaReview)
    .map(({ sourceKey }) => sourceKey)
    .sort();
  const productsRequiringPricing = products
    .filter(
      ({ requiresPricing, variants }) =>
        requiresPricing || !variants.some(({ priceMillimes }) => priceMillimes > 0),
    )
    .map(({ sourceKey }) => sourceKey)
    .sort();
  const productsRequiringStock = products
    .filter(
      ({ requiresStock, variants }) =>
        requiresStock || !variants.some(({ availableQuantity }) => availableQuantity > 0),
    )
    .map(({ sourceKey }) => sourceKey)
    .sort();
  const expectedVariantCount = WOTOFO_PRODUCTS.reduce(
    (total, definition) => total + definition.options.length,
    0,
  );
  const structuralErrors = [
    ...(products.length === WOTOFO_PRODUCTS.length
      ? []
      : [`Expected ${WOTOFO_PRODUCTS.length} products but found ${products.length}.`]),
    ...(allVariants.length === expectedVariantCount
      ? []
      : [`Expected ${expectedVariantCount} variants but found ${allVariants.length}.`]),
    ...(missingProducts.length
      ? [`Missing product source keys: ${missingProducts.join(', ')}.`]
      : []),
    ...(unexpectedProducts.length
      ? [`Unexpected product source keys: ${unexpectedProducts.join(', ')}.`]
      : []),
    ...(duplicateSkus.length ? [`Duplicate SKUs: ${duplicateSkus.join(', ')}.`] : []),
    ...(duplicateSlugs.length ? [`Duplicate slugs: ${duplicateSlugs.join(', ')}.`] : []),
    ...(productsWithoutImages.length
      ? [`Products without an approved image: ${productsWithoutImages.join(', ')}.`]
      : []),
    ...(productsWithoutVerifiedImageSources.length
      ? [
          `Products without verified image provenance: ${productsWithoutVerifiedImageSources.join(', ')}.`,
        ]
      : []),
    ...(variantsMissingIdentity.length
      ? [`Variant identity mismatches: ${variantsMissingIdentity.join(', ')}.`]
      : []),
    ...(productsMissingTranslations.length
      ? [`Products missing translations: ${productsMissingTranslations.join(', ')}.`]
      : []),
    ...(productsMissingVerifiedSourceMetadata.length
      ? [
          `Products missing verified source metadata: ${productsMissingVerifiedSourceMetadata.join(', ')}.`,
        ]
      : []),
  ];
  return {
    generatedAt: now.toISOString(),
    expectedProductCount: WOTOFO_PRODUCTS.length,
    actualProductCount: products.length,
    expectedVariantCount,
    actualVariantCount: allVariants.length,
    duplicateSkus,
    duplicateSlugs,
    productsWithoutImages,
    productsWithoutVerifiedImageSources,
    variantsMissingIdentity,
    productsMissingTranslations,
    productsMissingVerifiedSourceMetadata,
    productsRequiringMediaReview,
    productsRequiringPricing,
    productsRequiringStock,
    missingProducts,
    unexpectedProducts,
    structuralErrors,
    valid: structuralErrors.length === 0,
  };
};
