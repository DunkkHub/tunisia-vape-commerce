import type { CatalogImportRowInput } from './catalog-import-contract';
import { catalogueSlug, wotofoProductSlug, wotofoVariantSku } from './catalog-identity';
import {
  officialProductUrl,
  reviewedFlavor,
  WOTOFO_PRODUCTS,
  type WotofoProductDefinition,
} from './wotofo-catalog';
import { WotofoSourceClient, type VerifiedWotofoSource } from './wotofo-source';

const CATEGORY_BY_TYPE: Readonly<Record<WotofoProductDefinition['productType'], string>> = {
  DEVICE: 'devices',
  E_LIQUID: 'e-liquids',
  POD: 'pods',
  PREFILLED_POD_KIT: 'prefilled-pod-kits',
  PREFILLED_REPLACEMENT_POD: 'prefilled-replacement-pods',
  COIL: 'coils',
  DISPOSABLE: 'disposables',
  ACCESSORY: 'accessories',
  OTHER: 'other-products',
};

const COLOR_LABELS: Readonly<Record<string, { fr: string; ar: string }>> = {
  Black: { fr: 'Noir', ar: 'أسود' },
  Blue: { fr: 'Bleu', ar: 'أزرق' },
  'Blue Gradient': { fr: 'Dégradé bleu', ar: 'تدرج أزرق' },
  'Burgundy Red': { fr: 'Rouge bordeaux', ar: 'أحمر خمري' },
  'Cosmic Orange': { fr: 'Orange cosmique', ar: 'برتقالي كوني' },
  'Fiery Sunrise': { fr: 'Lever de soleil ardent', ar: 'شروق ناري' },
  Red: { fr: 'Rouge', ar: 'أحمر' },
  'Rose Gold': { fr: 'Or rose', ar: 'ذهبي وردي' },
  Silver: { fr: 'Argent', ar: 'فضي' },
};

const mapBounded = async <Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> => {
  const output = new Array<Output>(inputs.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < inputs.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await operation(inputs[index]!, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), inputs.length) }, () => worker()),
  );
  return output;
};

export const verifyWotofoCatalogueSources = (
  client = new WotofoSourceClient(),
): Promise<VerifiedWotofoSource[]> =>
  mapBounded(WOTOFO_PRODUCTS, 3, (definition) => client.verify(definition));

const translatedOption = (definition: WotofoProductDefinition, option: string) => {
  if (definition.optionKind === 'flavor') {
    const reviewed = reviewedFlavor(option);
    return {
      variantNameFr: reviewed.nameFr,
      variantNameAr: reviewed.nameAr,
      flavorCanonical: reviewed.canonicalName,
      flavorNameFr: reviewed.nameFr,
      flavorNameAr: reviewed.nameAr,
      flavorCategory: reviewed.category,
      color: null,
    } as const;
  }
  const labels = COLOR_LABELS[option];
  if (!labels) throw new Error(`Missing reviewed Wotofo color translation: ${option}`);
  return {
    variantNameFr: labels.fr,
    variantNameAr: labels.ar,
    flavorCanonical: null,
    flavorNameFr: null,
    flavorNameAr: null,
    flavorCategory: null,
    color: option,
  } as const;
};

export const buildWotofoImportRows = (
  sources: readonly VerifiedWotofoSource[],
): CatalogImportRowInput[] => {
  if (sources.length !== WOTOFO_PRODUCTS.length) {
    throw new Error('The verified Wotofo source count does not match the reviewed manifest.');
  }
  return WOTOFO_PRODUCTS.flatMap((definition, index) => {
    const source = sources[index];
    if (!source || source.handle !== definition.handle) {
      throw new Error(`Missing verified Wotofo source for ${definition.key}.`);
    }
    const variants = new Map(source.variants.map((variant) => [variant.option, variant]));
    return definition.options.map((option) => {
      const sourceVariant = variants.get(option);
      if (!sourceVariant)
        throw new Error(`Missing verified Wotofo option ${definition.key}/${option}.`);
      return {
        schemaVersion: '1.0',
        productKey: definition.key,
        brand: 'Wotofo',
        categorySlug: CATEGORY_BY_TYPE[definition.productType],
        family: definition.family,
        model: definition.model,
        productType: definition.productType,
        nameFr: definition.name,
        nameAr: definition.name,
        slug: wotofoProductSlug(definition.key),
        puffCount: definition.puffCount,
        liquidCapacityMl: definition.liquidCapacityMl,
        containsNicotine: definition.nicotineStrengthMg !== null,
        nicotineStrengthMg: definition.nicotineStrengthMg,
        variantKey: catalogueSlug(option),
        ...translatedOption(definition, option),
        sku: wotofoVariantSku(definition.key, option),
        priceMillimes: null,
        publicationStatus: null,
        officialProductUrl: officialProductUrl(definition.handle),
        productImageUrl: source.productImageUrl,
        variantImageUrl: sourceVariant.imageUrl,
      } satisfies CatalogImportRowInput;
    });
  });
};

export const fetchWotofoImportRows = async (
  client = new WotofoSourceClient(),
): Promise<{ rows: CatalogImportRowInput[]; sources: VerifiedWotofoSource[] }> => {
  const sources = await verifyWotofoCatalogueSources(client);
  return { rows: buildWotofoImportRows(sources), sources };
};
