import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type { CheckoutOrderDto } from '../../src/checkout/dto/checkout-order.dto';

let fixtureCounter = 0;

const nextFixture = (label: string) => {
  fixtureCounter += 1;
  return `${label}-${fixtureCounter.toString().padStart(3, '0')}`;
};

export interface GeographyFixture {
  governorateId: string;
  delegationId: string;
  localityId: string;
  postalCode: string;
  deliveryZoneId: string;
  deliveryRateId: string | null;
}

export interface CommerceFoundation {
  categoryId: string;
  locationId: string;
  adminUserId: string;
  validGeography: GeographyFixture;
  noRateGeography: GeographyFixture;
}

export const initializeCommerceFoundation = async (
  prisma: PrismaClient,
): Promise<CommerceFoundation> => {
  await Promise.all([
    prisma.storeSetting.update({
      where: { key: 'checkout.enabled' },
      data: { value: true },
    }),
    prisma.storeSetting.update({
      where: { key: 'maintenance.mode' },
      data: { value: false },
    }),
    prisma.storeSetting.update({
      where: { key: 'prelaunch.mode' },
      data: { value: false },
    }),
    prisma.storeSetting.update({
      where: { key: 'store.name' },
      data: { value: 'Integration Store' },
    }),
    prisma.storeSetting.update({
      where: { key: 'store.phone' },
      data: { value: '+21670000000' },
    }),
    prisma.storeSetting.update({
      where: { key: 'store.email' },
      data: { value: 'integration@example.test' },
    }),
    prisma.storeSetting.update({
      where: { key: 'store.address' },
      data: { value: 'Tunis integration facility' },
    }),
    prisma.complianceSetting.update({
      where: { key: 'legal_review.completed' },
      data: { value: true, legallyReviewed: true, reviewedAt: new Date() },
    }),
    prisma.complianceSetting.update({
      where: { key: 'minimum_purchase_age' },
      data: { value: 18, legallyReviewed: true, reviewedAt: new Date() },
    }),
  ]);
  const category = await prisma.category.create({
    data: {
      nameFr: 'Integration',
      nameAr: 'Integration',
      slug: 'integration-category',
      publicationStatus: 'PUBLISHED',
    },
  });
  const location = await prisma.inventoryLocation.create({
    data: {
      code: 'IT-FULFILLMENT',
      name: 'Integration fulfillment',
      active: true,
      fulfillsOrders: true,
    },
  });
  const admin = await prisma.user.create({
    data: {
      audience: 'ADMIN',
      email: 'integration-admin@example.test',
      emailNormalized: 'integration-admin@example.test',
      passwordHash: 'integration-only-not-a-login-credential',
      status: 'ACTIVE',
    },
  });
  const [validGeography, noRateGeography] = await Promise.all([
    createGeography(prisma, '91', true),
    createGeography(prisma, '92', false),
  ]);
  return {
    categoryId: category.id,
    locationId: location.id,
    adminUserId: admin.id,
    validGeography,
    noRateGeography,
  };
};

const createGeography = async (
  prisma: PrismaClient,
  code: string,
  withRate: boolean,
): Promise<GeographyFixture> => {
  const governorate = await prisma.governorate.create({
    data: { code, nameFr: `Integration ${code}`, nameAr: `Integration ${code}`, active: true },
  });
  const delegation = await prisma.delegation.create({
    data: {
      governorateId: governorate.id,
      code: `D-${code}`,
      nameFr: `Delegation ${code}`,
      nameAr: `Delegation ${code}`,
      active: true,
    },
  });
  const locality = await prisma.locality.create({
    data: {
      delegationId: delegation.id,
      code: `L-${code}`,
      nameFr: `Locality ${code}`,
      nameAr: `Locality ${code}`,
      active: true,
    },
  });
  const postalCode = `${code}00`;
  await prisma.postalCode.create({
    data: { localityId: locality.id, code: postalCode, active: true },
  });
  const zone = await prisma.deliveryZone.create({
    data: {
      code: `IT-ZONE-${code}`,
      nameFr: `Zone ${code}`,
      nameAr: `Zone ${code}`,
      priority: 100,
      active: true,
      supported: true,
      temporarilySuspended: false,
      minOrderMillimes: 1_000,
      maxCodMillimes: 500_000,
    },
  });
  await prisma.deliveryZoneLocality.create({
    data: { deliveryZoneId: zone.id, localityId: locality.id, active: true },
  });
  const rate = withRate
    ? await prisma.deliveryRate.create({
        data: {
          deliveryZoneId: zone.id,
          type: 'BASE',
          name: `Integration base ${code}`,
          priority: 100,
          feeMillimes: 7_000,
          active: true,
        },
      })
    : null;
  return {
    governorateId: governorate.id,
    delegationId: delegation.id,
    localityId: locality.id,
    postalCode,
    deliveryZoneId: zone.id,
    deliveryRateId: rate?.id ?? null,
  };
};

export const createCustomer = async (prisma: PrismaClient) => {
  const fixture = nextFixture('customer');
  const numeric = fixtureCounter.toString().padStart(7, '0');
  return prisma.user.create({
    data: {
      audience: 'CUSTOMER',
      email: `${fixture}@example.test`,
      emailNormalized: `${fixture}@example.test`,
      passwordHash: 'integration-only-not-a-login-credential',
      status: 'ACTIVE',
      customerProfile: {
        create: {
          firstName: 'Integration',
          lastName: fixture,
          phoneE164: `+2162${numeric}`,
          phoneSearch: `2${numeric}`,
          locale: 'fr',
        },
      },
    },
    include: { customerProfile: true },
  });
};

export const createSellableVariant = async (
  prisma: PrismaClient,
  foundation: CommerceFoundation,
  options: { onHand?: number; published?: boolean } = {},
) => {
  const fixture = nextFixture('product');
  const published = options.published ?? true;
  const product = await prisma.product.create({
    data: {
      categoryId: foundation.categoryId,
      nameFr: fixture,
      nameAr: fixture,
      slug: fixture,
      productType: 'DISPOSABLE',
      baseCostMillimes: 5_000,
      basePriceMillimes: 10_000,
      taxRateBps: 1_900,
      minimumAge: 18,
      publicationStatus: published ? 'PUBLISHED' : 'DRAFT',
      publishedAt: published ? new Date(Date.now() - 60_000) : null,
      variants: {
        create: {
          nameFr: `${fixture} variant`,
          nameAr: `${fixture} variant`,
          sku: `IT-${fixture}`,
          costMillimes: 5_000,
          priceMillimes: 10_000,
          taxRateBps: 1_900,
          weightGrams: 50,
          publicationStatus: published ? 'PUBLISHED' : 'DRAFT',
        },
      },
    },
    include: { variants: true },
  });
  const variant = product.variants[0]!;
  const inventory = await prisma.inventoryItem.create({
    data: {
      variantId: variant.id,
      locationId: foundation.locationId,
      onHandQuantity: options.onHand ?? 5,
    },
  });
  return { product, variant, inventory };
};

export const checkoutInput = (
  variantId: string,
  geography: GeographyFixture,
  quantity = 1,
): CheckoutOrderDto => ({
  items: [{ variantId, quantity }],
  localityId: geography.localityId,
  express: false,
  customerName: 'Integration Customer',
  phone: '+21620111222',
  email: 'buyer@example.test',
  address: { street: '1 Integration Street', postalCode: geography.postalCode },
  consent: { ageConfirmed: true, termsAccepted: true, privacyAccepted: true },
});

export const requestFixture = (userId?: string): Request =>
  ({
    requestId: nextFixture('request'),
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    get: (name: string) => (name.toLowerCase() === 'user-agent' ? 'integration-test' : undefined),
    ...(userId
      ? {
          auth: {
            userId,
            audience: 'ADMIN',
            sessionId: 'integration-session',
            csrfTokenHash: 'integration-csrf',
            recentAuthAt: new Date(),
          },
        }
      : {}),
  }) as unknown as Request;

export const exceptionCode = (reason: unknown): string | undefined => {
  if (typeof reason !== 'object' || reason === null || !('response' in reason)) return undefined;
  const response = reason.response;
  if (typeof response !== 'object' || response === null || !('code' in response)) return undefined;
  return typeof response.code === 'string' ? response.code : undefined;
};
