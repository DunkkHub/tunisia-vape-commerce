import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CartService } from '../../src/cart/cart.service';
import { CheckoutOrderService } from '../../src/checkout/checkout-order.service';
import { CheckoutPolicyService } from '../../src/checkout/checkout-policy.service';
import { CryptoService } from '../../src/common/security/crypto.service';
import { validateEnvironment, type Environment } from '../../src/config/environment';
import { CustomerOrdersService } from '../../src/customer-orders/customer-orders.service';
import { PrismaService } from '../../src/database/prisma.service';
import { AdminOrdersService } from '../../src/orders/admin-orders.service';
import {
  checkoutInput,
  createCustomer,
  createSellableVariant,
  exceptionCode,
  initializeCommerceFoundation,
  requestFixture,
  type CommerceFoundation,
} from './commerce-test-helpers';

const databaseName = process.env.INTEGRATION_DATABASE_NAME;
const redisPrefix = process.env.TEST_REDIS_PREFIX;
if (!databaseName || !/^vape_it_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Integration tests require the disposable database runner');
}
if (!redisPrefix || !/^vape-it:[a-z0-9_]+:$/.test(redisPrefix)) {
  throw new Error('Integration tests require an isolated Redis prefix');
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

const key = (label: string) => `integration-${label}-${Date.now().toString(36)}`;

describe.sequential('commerce integration on disposable MySQL and isolated Redis', () => {
  const prisma = new PrismaService();
  const crypto = new CryptoService(config);
  const carts = new CartService(prisma);
  const checkoutPolicy = new CheckoutPolicyService(prisma, config);
  const checkout = new CheckoutOrderService(prisma, checkoutPolicy, crypto);
  const customerOrders = new CustomerOrdersService(prisma, crypto);
  const adminOrders = new AdminOrdersService(prisma, crypto);
  const redis = new Redis(environment.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    keyPrefix: redisPrefix,
  });
  let foundation: CommerceFoundation;

  beforeAll(async () => {
    await prisma.$connect();
    const [databaseRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ databaseName: string }>>('SELECT DATABASE() AS databaseName'),
      redis.connect(),
    ]);
    expect(databaseRows[0]?.databaseName).toBe(databaseName);
    expect(await redis.ping()).toBe('PONG');
    await redis.set('connectivity', databaseName, 'EX', 120);
    expect(await redis.get('connectivity')).toBe(databaseName);
    const [roleCount, permissionCount, governorateCount, userCount, productCount, seededSettings] =
      await Promise.all([
        prisma.role.count(),
        prisma.permission.count(),
        prisma.governorate.count(),
        prisma.user.count(),
        prisma.product.count(),
        prisma.storeSetting.findMany({
          where: {
            key: {
              in: ['checkout.enabled', 'store.currency', 'store.timezone', 'store.name'],
            },
          },
          select: { key: true, value: true },
        }),
      ]);
    const settingValues = new Map(seededSettings.map((setting) => [setting.key, setting.value]));
    expect(roleCount).toBeGreaterThan(0);
    expect(permissionCount).toBeGreaterThan(0);
    expect(governorateCount).toBe(24);
    expect(userCount).toBe(0);
    expect(productCount).toBe(0);
    expect(Object.fromEntries(settingValues)).toMatchObject({
      'checkout.enabled': true,
      'store.currency': 'TND',
      'store.timezone': 'Africa/Tunis',
      'store.name': '',
    });
    foundation = await initializeCommerceFoundation(prisma);
  }, 60_000);

  afterAll(async () => {
    await redis.del('connectivity').catch(() => 0);
    redis.disconnect(false);
    await prisma.$disconnect();
  });

  it('creates one successful COD order with immutable snapshots and active reservation', async () => {
    const customer = await createCustomer(prisma);
    const product = await createSellableVariant(prisma, foundation, { onHand: 3 });
    const result = await checkout.create(
      await checkoutInput(prisma, customer.id, product.variant.id, foundation.validGeography),
      key('success-order'),
      customer.id,
      requestFixture(),
    );

    expect(result.data).toMatchObject({
      status: 'PENDING_CONFIRMATION',
      paymentStatus: 'CASH_EXPECTED',
      currency: 'TND',
      subtotalMillimes: 10_000,
      deliveryTotalMillimes: 7_000,
      taxTotalMillimes: 1_900,
      grandTotalMillimes: 18_900,
      expectedCodMillimes: 18_900,
      deliveryMethodType: 'COURIER',
    });
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.data.id },
      include: {
        items: true,
        addressSnapshots: true,
        consentSnapshots: true,
        reservations: true,
        delivery: true,
        cashCollections: true,
        notifications: true,
      },
    });
    expect(order.items).toHaveLength(1);
    expect(order.addressSnapshots).toHaveLength(1);
    expect(order.consentSnapshots).toHaveLength(3);
    expect(order.reservations).toHaveLength(1);
    expect(order.reservations[0]).toMatchObject({ state: 'ACTIVE', quantity: 1 });
    expect(order.delivery).toMatchObject({ status: 'PENDING_CONFIRMATION' });
    expect(order.cashCollections).toEqual([
      expect.objectContaining({ status: 'EXPECTED', expectedMillimes: 18_900 }),
    ]);
    expect(order.notifications).toHaveLength(1);
    expect(order.cartId).not.toBeNull();
    await expect(
      prisma.cart.findUniqueOrThrow({ where: { id: order.cartId! } }),
    ).resolves.toMatchObject({ status: 'CONVERTED' });
    expect(
      await prisma.outboxEvent.count({
        where: {
          aggregateType: 'Notification',
          aggregateId: order.notifications[0]!.id,
          eventType: 'notification.dispatch.requested',
        },
      }),
    ).toBe(1);
    expect(
      (await prisma.inventoryItem.findUniqueOrThrow({ where: { id: product.inventory.id } }))
        .onHandQuantity,
    ).toBe(3);
  });

  it('prunes an archived persisted cart line while preserving valid lines for checkout', async () => {
    const customer = await createCustomer(prisma);
    const valid = await createSellableVariant(prisma, foundation, { onHand: 3 });
    const stale = await createSellableVariant(prisma, foundation, { onHand: 3 });
    const input = await checkoutInput(
      prisma,
      customer.id,
      valid.variant.id,
      foundation.validGeography,
    );
    const customerProfileId = customer.customerProfile!.id;
    const cart = await prisma.cart.findFirstOrThrow({
      where: { customerId: customerProfileId, status: 'ACTIVE' },
      select: { id: true, version: true },
    });
    await prisma.cartItem.create({
      data: { cartId: cart.id, variantId: stale.variant.id, quantity: 1 },
    });
    await prisma.productVariant.update({
      where: { id: stale.variant.id },
      data: { archivedAt: new Date() },
    });

    const response = await carts.get(customer.id, 'fr');

    expect(response.data.items).toHaveLength(1);
    expect(response.data.items[0]?.variant.id).toBe(valid.variant.id);
    expect(
      await prisma.cartItem.findMany({
        where: { cartId: cart.id },
        select: { variantId: true },
      }),
    ).toEqual([{ variantId: valid.variant.id }]);
    await expect(prisma.cart.findUniqueOrThrow({ where: { id: cart.id } })).resolves.toMatchObject({
      version: cart.version + 1,
    });

    const created = await checkout.create(
      input,
      key('stale-line-cleanup'),
      customer.id,
      requestFixture(),
    );
    expect(created.data).toMatchObject({ status: 'PENDING_CONFIRMATION', currency: 'TND' });
    await expect(prisma.cart.findUniqueOrThrow({ where: { id: cart.id } })).resolves.toMatchObject({
      status: 'CONVERTED',
    });
  });

  it('creates checkout without legal-style confirmations when the operator disables them', async () => {
    const configurableKeys = [
      'age_gate.checkout.enabled',
      'consent.terms.required',
      'consent.privacy.required',
      'consent.recording.enabled',
      'delivery.age_verification_required',
    ];
    await prisma.complianceSetting.updateMany({
      where: { key: { in: configurableKeys } },
      data: { value: false },
    });
    try {
      const customer = await createCustomer(prisma);
      const product = await createSellableVariant(prisma, foundation, { onHand: 2 });
      const input = await checkoutInput(
        prisma,
        customer.id,
        product.variant.id,
        foundation.validGeography,
      );
      input.consent = { ageConfirmed: false, termsAccepted: false, privacyAccepted: false };

      const result = await checkout.create(
        input,
        key('configurable-consent'),
        customer.id,
        requestFixture(),
      );
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: result.data.id },
        include: { consentSnapshots: true, ageVerificationEvents: true },
      });

      expect(order.ageConfirmedAt).toBeNull();
      expect(order.ageVerificationAtDeliveryRequired).toBe(false);
      expect(order.consentSnapshots).toEqual([]);
      expect(order.ageVerificationEvents).toEqual([]);
    } finally {
      await prisma.complianceSetting.updateMany({
        where: { key: { in: configurableKeys } },
        data: { value: true },
      });
    }
  });

  it('rejects missing, unpublished, and insufficient products without partial orders', async () => {
    const missingCustomer = await createCustomer(prisma);
    const unpublishedCustomer = await createCustomer(prisma);
    const insufficientCustomer = await createCustomer(prisma);
    const removed = await createSellableVariant(prisma, foundation, { onHand: 5 });
    const removedInput = await checkoutInput(
      prisma,
      missingCustomer.id,
      removed.variant.id,
      foundation.validGeography,
    );
    await prisma.productVariant.update({
      where: { id: removed.variant.id },
      data: { deletedAt: new Date() },
    });
    const unpublished = await createSellableVariant(prisma, foundation, {
      published: false,
      onHand: 5,
    });
    const insufficient = await createSellableVariant(prisma, foundation, { onHand: 1 });
    const unpublishedInput = await checkoutInput(
      prisma,
      unpublishedCustomer.id,
      unpublished.variant.id,
      foundation.validGeography,
    );
    const insufficientInput = await checkoutInput(
      prisma,
      insufficientCustomer.id,
      insufficient.variant.id,
      foundation.validGeography,
      2,
    );
    const before = await prisma.order.count();

    const missing = await checkout
      .create(removedInput, key('missing-product'), missingCustomer.id, requestFixture())
      .catch((reason: unknown) => reason);
    const inactive = await checkout
      .create(unpublishedInput, key('inactive-product'), unpublishedCustomer.id, requestFixture())
      .catch((reason: unknown) => reason);
    const outOfStock = await checkout
      .create(
        insufficientInput,
        key('insufficient-product'),
        insufficientCustomer.id,
        requestFixture(),
      )
      .catch((reason: unknown) => reason);

    expect(exceptionCode(missing)).toBe('PRODUCT_UNAVAILABLE');
    expect(exceptionCode(inactive)).toBe('PRODUCT_UNAVAILABLE');
    expect(exceptionCode(outOfStock)).toBe('OUT_OF_STOCK');
    expect(await prisma.order.count()).toBe(before);
    expect(
      await prisma.stockReservation.count({
        where: { inventoryItemId: insufficient.inventory.id },
      }),
    ).toBe(0);
  });

  it('rejects unsupported localities and configured zones with no applicable rate', async () => {
    const customer = await createCustomer(prisma);
    const product = await createSellableVariant(prisma, foundation, { onHand: 5 });
    const invalidLocalityInput = await checkoutInput(
      prisma,
      customer.id,
      product.variant.id,
      foundation.validGeography,
    );
    invalidLocalityInput.localityId = 'missing-locality-id';

    const unsupported = await checkout
      .create(invalidLocalityInput, key('unsupported-locality'), customer.id, requestFixture())
      .catch((reason: unknown) => reason);
    const noRate = await checkout
      .create(
        { ...invalidLocalityInput, localityId: foundation.noRateGeography.localityId },
        key('missing-rate'),
        customer.id,
        requestFixture(),
      )
      .catch((reason: unknown) => reason);

    expect(exceptionCode(unsupported)).toBe('DELIVERY_AREA_UNSUPPORTED');
    expect(exceptionCode(noRate)).toBe('DELIVERY_RATE_UNAVAILABLE');
  });

  it('replays identical idempotent checkout and rejects a conflicting payload', async () => {
    const customer = await createCustomer(prisma);
    const product = await createSellableVariant(prisma, foundation, { onHand: 5 });
    const input = await checkoutInput(
      prisma,
      customer.id,
      product.variant.id,
      foundation.validGeography,
    );
    const idempotencyKey = key('idempotency-replay');

    const first = await checkout.create(input, idempotencyKey, customer.id, requestFixture());
    const replay = await checkout.create(input, idempotencyKey, customer.id, requestFixture());
    const conflict = await checkout
      .create(
        { ...input, items: [{ variantId: product.variant.id, quantity: 2 }] },
        idempotencyKey,
        customer.id,
        requestFixture(),
      )
      .catch((reason: unknown) => reason);
    const duplicateConversion = await checkout
      .create(input, key('different-key-same-cart'), customer.id, requestFixture())
      .catch((reason: unknown) => reason);

    expect(replay.data.id).toBe(first.data.id);
    expect(exceptionCode(conflict)).toBe('IDEMPOTENCY_CONFLICT');
    expect(exceptionCode(duplicateConversion)).toBe('CART_EMPTY');
    expect(await prisma.order.count({ where: { customerId: customer.customerProfile!.id } })).toBe(
      1,
    );
    expect(await prisma.orderIdempotencyKey.count({ where: { orderId: first.data.id } })).toBe(1);
  });

  it('serializes two final-unit checkouts so exactly one reserves stock', async () => {
    const [firstCustomer, secondCustomer] = await Promise.all([
      createCustomer(prisma),
      createCustomer(prisma),
    ]);
    const product = await createSellableVariant(prisma, foundation, { onHand: 1 });
    const [firstInput, secondInput] = await Promise.all([
      checkoutInput(prisma, firstCustomer.id, product.variant.id, foundation.validGeography),
      checkoutInput(prisma, secondCustomer.id, product.variant.id, foundation.validGeography),
    ]);

    const outcomes = await Promise.allSettled([
      checkout.create(firstInput, key('final-unit-a'), firstCustomer.id, requestFixture()),
      checkout.create(secondInput, key('final-unit-b'), secondCustomer.id, requestFixture()),
    ]);
    const successes = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const failures = outcomes.filter((outcome) => outcome.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(exceptionCode(failures[0]!.reason)).toBe('OUT_OF_STOCK');
    const reservations = await prisma.stockReservation.findMany({
      where: { inventoryItemId: product.inventory.id },
    });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ state: 'ACTIVE', quantity: 1 });
    expect(new Set(reservations.map((reservation) => reservation.activeKey)).size).toBe(1);
    const inventory = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: product.inventory.id },
    });
    expect(inventory.onHandQuantity).toBe(1);
    expect(
      await prisma.order.count({
        where: {
          customerId: {
            in: [firstCustomer.customerProfile!.id, secondCustomer.customerProfile!.id],
          },
        },
      }),
    ).toBe(1);
  }, 30_000);

  it('customer cancellation releases the reservation without changing physical on-hand', async () => {
    const customer = await createCustomer(prisma);
    const product = await createSellableVariant(prisma, foundation, { onHand: 2 });
    const created = await checkout.create(
      await checkoutInput(prisma, customer.id, product.variant.id, foundation.validGeography),
      key('customer-cancel'),
      customer.id,
      requestFixture(),
    );

    const cancelled = await customerOrders.cancel(
      customer.id,
      created.data.orderNumber,
      {
        expectedVersion: 1,
        confirmed: true,
        confirmation: 'CANCEL_ORDER',
        reason: 'Customer changed their mind',
      },
      requestFixture(),
    );

    expect(cancelled.data).toMatchObject({ status: 'CANCELLED', paymentStatus: 'CANCELLED' });
    const reservation = await prisma.stockReservation.findFirstOrThrow({
      where: { orderId: created.data.id },
    });
    expect(reservation).toMatchObject({
      state: 'RELEASED',
      activeKey: null,
      releaseReason: 'Customer changed their mind',
    });
    expect(
      (await prisma.inventoryItem.findUniqueOrThrow({ where: { id: product.inventory.id } }))
        .onHandQuantity,
    ).toBe(2);
    expect(
      await prisma.cashCollection.count({
        where: { orderId: created.data.id, status: 'VOIDED' },
      }),
    ).toBe(1);
  });

  it('serializes simultaneous customer cancel and admin confirm with one controlled winner', async () => {
    const customer = await createCustomer(prisma);
    const product = await createSellableVariant(prisma, foundation, { onHand: 1 });
    const created = await checkout.create(
      await checkoutInput(prisma, customer.id, product.variant.id, foundation.validGeography),
      key('cancel-confirm-race'),
      customer.id,
      requestFixture(),
    );

    const outcomes = await Promise.allSettled([
      customerOrders.cancel(
        customer.id,
        created.data.orderNumber,
        {
          expectedVersion: 1,
          confirmed: true,
          confirmation: 'CANCEL_ORDER',
          reason: 'Concurrent customer cancellation',
        },
        requestFixture(),
      ),
      adminOrders.confirm(
        created.data.id,
        { expectedVersion: 1, confirmed: true },
        requestFixture(foundation.adminUserId),
      ),
    ]);
    const successes = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect([
      'VERSION_CONFLICT',
      'ORDER_CONFIRMATION_NOT_ALLOWED',
      'ORDER_CANCELLATION_NOT_ALLOWED',
    ]).toContain(exceptionCode(failures[0]!.reason));

    const [order, reservation, inventory] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: created.data.id } }),
      prisma.stockReservation.findFirstOrThrow({ where: { orderId: created.data.id } }),
      prisma.inventoryItem.findUniqueOrThrow({ where: { id: product.inventory.id } }),
    ]);
    expect(['CANCELLED', 'CONFIRMED']).toContain(order.status);
    if (order.status === 'CANCELLED') {
      expect(reservation.state).toBe('RELEASED');
      expect(inventory.onHandQuantity).toBe(1);
    } else {
      expect(reservation.state).toBe('CONSUMED');
      expect(inventory.onHandQuantity).toBe(0);
    }
    expect(inventory.onHandQuantity).toBeGreaterThanOrEqual(0);
    expect(
      await prisma.stockReservation.count({ where: { orderId: created.data.id, state: 'ACTIVE' } }),
    ).toBe(0);
  }, 30_000);

  it('processes repeated reservation-expiry work as one idempotent release', async () => {
    const customer = await createCustomer(prisma);
    const product = await createSellableVariant(prisma, foundation, { onHand: 2 });
    const created = await checkout.create(
      await checkoutInput(prisma, customer.id, product.variant.id, foundation.validGeography),
      key('worker-expiry'),
      customer.id,
      requestFixture(),
    );
    await prisma.stockReservation.updateMany({
      where: { orderId: created.data.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const event = await prisma.outboxEvent.create({
      data: {
        deterministicKey: `integration-expiry:${created.data.id}`,
        aggregateType: 'StockReservation',
        aggregateId: created.data.id,
        eventType: 'inventory.reservations.expire.requested',
        eventVersion: 1,
        payload: { cutoff: new Date().toISOString(), batchSize: 50 },
        status: 'PUBLISHED',
        publishedAt: new Date(),
        publishedJobId: `integration-expiry:${created.data.id}`,
        attemptCount: 1,
      },
    });

    type Processor = {
      process(job: {
        outboxEventId: string;
        eventType: string;
        eventVersion: number;
      }): Promise<void>;
    };
    type ProcessorConstructor = new (
      prismaClient: unknown,
      repository: unknown,
      workerEnvironment: unknown,
      logger: unknown,
    ) => Processor;
    const workerModuleUrl = pathToFileURL(
      path.resolve(process.cwd(), '..', 'worker', 'dist', 'outbox-processor.js'),
    ).href;
    const workerEnvironmentModuleUrl = pathToFileURL(
      path.resolve(process.cwd(), '..', 'worker', 'dist', 'environment.js'),
    ).href;
    const workerModule = (await import(/* @vite-ignore */ workerModuleUrl)) as {
      OutboxProcessor: ProcessorConstructor;
    };
    const workerEnvironmentModule = (await import(
      /* @vite-ignore */ workerEnvironmentModuleUrl
    )) as {
      parseWorkerEnvironment: (input: Record<string, string | undefined>) => unknown;
    };
    const workerEnvironment = workerEnvironmentModule.parseWorkerEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: environment.DATABASE_URL,
      REDIS_URL: environment.REDIS_URL,
      WORKER_INSTANCE_ID: 'integration-worker',
      OUTBOX_LEASE_MS: '30000',
      NOTIFICATION_ADAPTER: 'disabled',
    });
    let retryCount = 0;
    const processor = new workerModule.OutboxProcessor(
      prisma,
      {
        scheduleRetry: () => {
          retryCount += 1;
          return Promise.resolve('RETRY');
        },
      },
      workerEnvironment,
      { info: () => undefined, warn: () => undefined },
    );
    const job = {
      outboxEventId: event.id,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
    };
    await processor.process(job);
    await processor.process(job);

    const [reservation, processedEvent, inventory] = await Promise.all([
      prisma.stockReservation.findFirstOrThrow({ where: { orderId: created.data.id } }),
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
      prisma.inventoryItem.findUniqueOrThrow({ where: { id: product.inventory.id } }),
    ]);
    expect(retryCount).toBe(0);
    expect(reservation).toMatchObject({
      state: 'EXPIRED',
      activeKey: null,
      releaseReason: 'RESERVATION_EXPIRED',
    });
    expect(processedEvent.status).toBe('PROCESSED');
    expect(inventory.onHandQuantity).toBe(2);
    expect(
      await prisma.stockMovement.count({
        where: {
          inventoryItemId: product.inventory.id,
          reasonCode: 'RESERVATION_EXPIRED',
          quantityDelta: 0,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'inventory.reservation.expired',
          resourceId: reservation.id,
        },
      }),
    ).toBe(1);
  });
});
