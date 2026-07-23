import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AdminProductsService } from '../../src/catalog/admin-products.service';
import { AdminVariantsService } from '../../src/catalog/admin-variants.service';
import { CheckoutPolicyService } from '../../src/checkout/checkout-policy.service';
import { validateEnvironment, type Environment } from '../../src/config/environment';
import { PrismaService } from '../../src/database/prisma.service';
import { requestFixture } from './commerce-test-helpers';

const databaseName = process.env.INTEGRATION_DATABASE_NAME;
if (!databaseName || !/^vape_it_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Integration tests require the disposable database runner');
}

const environment = validateEnvironment({
  ...process.env,
  NODE_ENV: 'test',
  CHECKOUT_ENABLED: 'true',
  MAINTENANCE_MODE: 'false',
  PRELAUNCH_MODE: 'false',
  FIELD_ENCRYPTION_KEY: 'integration-field-key-32-bytes-minimum',
  COOKIE_SECRET: 'integration-cookie-key-32-bytes-minimum',
});
const config = new ConfigService<Environment, true>(environment);

const suffix = () => `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const publicationError = (
  error: unknown,
  code: 'PRODUCT_PUBLICATION_NOT_READY' | 'VARIANT_PUBLICATION_NOT_READY',
) => {
  expect(error).toMatchObject({ response: { code } });
  const response = (error as { response: { blockers: unknown } }).response;
  expect(response.blockers).toContain('AVAILABLE_STOCK_MISSING');
};

describe.sequential('catalog publication concurrency on disposable MySQL', () => {
  const prisma = new PrismaService();
  const authoritativePolicies = new CheckoutPolicyService(prisma, config);
  let publicationTransactionProbe: (() => void) | null = null;
  const policies = {
    evaluate: (
      now = new Date(),
      database: Parameters<CheckoutPolicyService['evaluate']>[1] = prisma,
    ) => {
      if (database !== prisma) publicationTransactionProbe?.();
      return authoritativePolicies.evaluate(now, database);
    },
  } as unknown as CheckoutPolicyService;
  const products = new AdminProductsService(prisma, policies);
  const variants = new AdminVariantsService(prisma, policies);

  let categoryId: string;
  let locationId: string;
  let zoneId: string;
  const fixtureProductIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    const fixture = suffix();
    const [category, location, zone] = await Promise.all([
      prisma.category.create({
        data: {
          nameFr: `Publication ${fixture}`,
          nameAr: `Publication ${fixture}`,
          slug: `publication-${fixture}`,
          publicationStatus: 'PUBLISHED',
        },
      }),
      prisma.inventoryLocation.create({
        data: {
          code: `PUB-${fixture}`,
          name: `Publication ${fixture}`,
          active: true,
          fulfillsOrders: true,
        },
      }),
      prisma.deliveryZone.create({
        data: {
          code: `PUB-ZONE-${fixture}`,
          nameFr: `Publication ${fixture}`,
          nameAr: `Publication ${fixture}`,
          active: true,
          supported: true,
          temporarilySuspended: false,
        },
      }),
    ]);
    await prisma.deliveryRate.create({
      data: {
        deliveryZoneId: zone.id,
        type: 'BASE',
        name: `Publication ${fixture}`,
        feeMillimes: 5_000,
        active: true,
      },
    });
    categoryId = category.id;
    locationId = location.id;
    zoneId = zone.id;
  });

  const removePublicationFixtures = async () => {
    const productIds = fixtureProductIds.splice(0);
    if (productIds.length === 0) return;
    await prisma.$transaction(async (transaction) => {
      const variantIds = (
        await transaction.productVariant.findMany({
          where: { productId: { in: productIds } },
          select: { id: true },
        })
      ).map(({ id }) => id);
      if (variantIds.length > 0) {
        await transaction.inventoryItem.deleteMany({ where: { variantId: { in: variantIds } } });
        await transaction.productImage.deleteMany({ where: { variantId: { in: variantIds } } });
      }
      await transaction.productImage.deleteMany({ where: { productId: { in: productIds } } });
      await transaction.productVariant.deleteMany({ where: { productId: { in: productIds } } });
      await transaction.product.deleteMany({ where: { id: { in: productIds } } });
    });
  };

  afterEach(removePublicationFixtures);

  afterAll(async () => {
    try {
      await removePublicationFixtures();
      await prisma.deliveryRate.deleteMany({ where: { deliveryZoneId: zoneId } });
      await prisma.deliveryZone.delete({ where: { id: zoneId } });
      await prisma.inventoryLocation.delete({ where: { id: locationId } });
      await prisma.category.delete({ where: { id: categoryId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  const createPublicationFixture = async (variantPublished: boolean) => {
    const fixture = suffix();
    const product = await prisma.product.create({
      data: {
        categoryId,
        nameFr: `Publication ${fixture}`,
        nameAr: `Publication ${fixture}`,
        slug: `publication-product-${fixture}`,
        productType: 'DISPOSABLE',
        basePriceMillimes: 20_000,
        publicationStatus: 'DRAFT',
        variants: {
          create: {
            nameFr: `Variante ${fixture}`,
            nameAr: `Variante ${fixture}`,
            sku: `PUB-SKU-${fixture}`,
            priceMillimes: 20_000,
            publicationStatus: variantPublished ? 'PUBLISHED' : 'DRAFT',
          },
        },
        images: {
          create: {
            objectKey: `integration/${fixture}.png`,
            objectKeyHash: randomBytes(32).toString('hex'),
            bucket: 'integration',
            contentType: 'image/png',
            byteSize: 1,
            checksumSha256: randomBytes(32).toString('hex'),
            width: 1,
            height: 1,
            altTextFr: `Publication ${fixture}`,
            altTextAr: `Publication ${fixture}`,
            isPrimary: true,
            moderationStatus: 'APPROVED',
          },
        },
      },
      include: { variants: true },
    });
    fixtureProductIds.push(product.id);
    const variant = product.variants[0]!;
    const inventory = await prisma.inventoryItem.create({
      data: {
        variantId: variant.id,
        locationId,
        onHandQuantity: 1,
      },
    });
    return { product, variant, inventory };
  };

  const removeStockWhilePublicationWaits = async (
    inventoryId: string,
    publish: () => Promise<unknown>,
    expectedCode: 'PRODUCT_PUBLICATION_NOT_READY' | 'VARIANT_PUBLICATION_NOT_READY',
  ) => {
    let signalLocked!: () => void;
    let releaseInventory!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseInventory = resolve;
    });
    const inventoryMutation = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT id FROM InventoryItem WHERE id = ${inventoryId} FOR UPDATE
      `;
      signalLocked();
      await release;
      await transaction.inventoryItem.update({
        where: { id: inventoryId },
        data: { onHandQuantity: 0, version: { increment: 1 } },
      });
    });
    await locked;

    let signalPublicationTransaction!: () => void;
    const publicationTransactionStarted = new Promise<void>((resolve) => {
      signalPublicationTransaction = resolve;
    });
    publicationTransactionProbe = signalPublicationTransaction;
    let settled = false;
    const publication = publish().then(
      (value) => {
        settled = true;
        return { status: 'fulfilled' as const, value };
      },
      (error: unknown) => {
        settled = true;
        return { status: 'rejected' as const, error };
      },
    );
    const transactionStarted = await Promise.race([
      publicationTransactionStarted.then(() => true),
      delay(2_000).then(() => false),
    ]);
    const wasBlockedByInventoryLock = transactionStarted && !settled;
    publicationTransactionProbe = null;
    releaseInventory();
    await inventoryMutation;
    const outcome = await publication;

    expect(wasBlockedByInventoryLock).toBe(true);
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') publicationError(outcome.error, expectedCode);
  };

  it('does not publish a product from stock that is concurrently removed', async () => {
    const fixture = await createPublicationFixture(true);

    await removeStockWhilePublicationWaits(
      fixture.inventory.id,
      () =>
        products.update(
          fixture.product.id,
          { version: fixture.product.version, publicationStatus: 'PUBLISHED' },
          { userId: 'integration-admin', requestId: `publication-${suffix()}` },
        ),
      'PRODUCT_PUBLICATION_NOT_READY',
    );

    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: fixture.product.id } }),
    ).resolves.toMatchObject({ publicationStatus: 'DRAFT', version: fixture.product.version });
  });

  it('does not publish a variant from stock that is concurrently removed', async () => {
    const fixture = await createPublicationFixture(false);

    await removeStockWhilePublicationWaits(
      fixture.inventory.id,
      () =>
        variants.update(
          fixture.product.id,
          fixture.variant.id,
          { version: fixture.variant.version, publicationStatus: 'PUBLISHED' },
          requestFixture('integration-admin'),
        ),
      'VARIANT_PUBLICATION_NOT_READY',
    );

    await expect(
      prisma.productVariant.findUniqueOrThrow({ where: { id: fixture.variant.id } }),
    ).resolves.toMatchObject({ publicationStatus: 'DRAFT', version: fixture.variant.version });
  });
});
