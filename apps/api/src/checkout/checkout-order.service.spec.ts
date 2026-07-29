import type { Request } from 'express';
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { checkoutRequestFingerprint } from './checkout-order.helpers';
import { CheckoutOrderService } from './checkout-order.service';
import type { CheckoutOrderDto } from './dto/checkout-order.dto';

const input: CheckoutOrderDto = {
  items: [{ variantId: 'variant-a', quantity: 1 }],
  localityId: 'locality-a',
  customerName: 'Customer Name',
  phone: '+21620111222',
  address: { street: '1 Example Street' },
  consent: { ageConfirmed: true, termsAccepted: true, privacyAccepted: true },
};

describe('checkout order replay', () => {
  it('returns the immutable creation response without re-running checkout policy or writes', async () => {
    const createdAt = new Date('2026-07-13T10:00:00.000Z');
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: 'claim-a',
          audienceScope: 'customer:user-a:checkout-order',
          requestHash: checkoutRequestFingerprint(input),
          orderId: 'order-a',
          completedAt: createdAt,
          expiresAt: new Date('2026-07-14T10:00:00.000Z'),
        },
      ]),
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'order-a',
          orderNumber: 'TJ-2026-00000001',
          status: 'CONFIRMED',
          paymentStatus: 'CASH_COLLECTED_BY_COURIER',
          currency: 'TND',
          subtotalMillimes: 10_000,
          discountTotalMillimes: 1_000,
          deliveryTotalMillimes: 2_000,
          taxTotalMillimes: 1_710,
          grandTotalMillimes: 12_710,
          expectedCodMillimes: 12_710,
          deliveryMethodType: 'COURIER',
          deliveryFeeRuleSnapshot: {
            schemaVersion: 1,
            method: 'COURIER',
            estimatedMinDays: 1,
            estimatedMaxDays: 3,
            estimatedMinMinutes: null,
            estimatedMaxMinutes: null,
            paymentMethod: 'CASH_ON_DELIVERY',
            assignmentMode: 'MANUAL',
            driverCommunication: 'WHATSAPP',
            phoneConfirmationRequired: true,
            manualReviewRequired: true,
          },
          phoneConfirmationRequired: true,
          createdAt,
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const policies = { evaluate: vi.fn() };
    const service = new CheckoutOrderService(prisma as never, policies as never, {} as never);
    const request = {
      requestId: 'request-a',
      get: vi.fn(),
      socket: {},
    } as unknown as Request;

    const result = await service.create(input, 'checkout_0123456789abcdef', 'user-a', request);

    expect(result).toEqual({
      data: {
        id: 'order-a',
        orderNumber: 'TJ-2026-00000001',
        status: 'PENDING_CONFIRMATION',
        paymentStatus: 'CASH_EXPECTED',
        currency: 'TND',
        subtotalMillimes: 10_000,
        discountTotalMillimes: 1_000,
        deliveryTotalMillimes: 2_000,
        taxTotalMillimes: 1_710,
        grandTotalMillimes: 12_710,
        expectedCodMillimes: 12_710,
        deliveryMethodType: 'COURIER',
        createdAt: '2026-07-13T10:00:00.000Z',
        fulfillment: {
          type: 'COURIER',
          estimatedMinDays: 1,
          estimatedMaxDays: 3,
          estimatedMinMinutes: null,
          estimatedMaxMinutes: null,
          paymentMethod: 'CASH_ON_DELIVERY',
          phoneConfirmationRequired: true,
        },
      },
    });
    expect(result.data.fulfillment).not.toHaveProperty('assignmentMode');
    expect(result.data.fulfillment).not.toHaveProperty('driverCommunication');
    expect(result.data.fulfillment).not.toHaveProperty('manualReviewRequired');
    expect(policies.evaluate).not.toHaveBeenCalled();
    expect(transaction.order.findUnique).toHaveBeenCalledTimes(1);
  });

  it('stores the complete courier operational metadata in the immutable fee-rule snapshot', async () => {
    const transaction = {
      locality: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'locality-a',
          nameFr: 'Bizerte Centre',
          delegationId: 'delegation-a',
          delegation: {
            nameFr: 'Bizerte Nord',
            governorateId: 'governorate-a',
            governorate: { nameFr: 'Bizerte' },
          },
          zoneLinks: [
            {
              priorityOverride: null,
              deliveryZone: {
                id: 'zone-a',
                code: 'STANDARD_COD',
                nameFr: 'Livraison nationale',
                priority: 50,
                minOrderMillimes: null,
                maxCodMillimes: null,
                freeDeliveryThresholdMillimes: null,
                phoneConfirmationRequired: true,
                manualReviewRequired: true,
                estimatedMinDays: 1,
                estimatedMaxDays: 3,
                estimatedMinMinutes: null,
                estimatedMaxMinutes: null,
                paymentMethod: 'CASH_ON_DELIVERY',
                assignmentMode: 'MANUAL',
                driverCommunication: 'WHATSAPP',
              },
            },
          ],
        }),
      },
      deliveryRate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rate-a',
            type: 'BASE',
            priority: 50,
            feeMillimes: 8_000,
            deliveryZoneId: 'zone-a',
            governorateId: null,
            delegationId: null,
            localityId: null,
            minWeightGrams: null,
            maxWeightGrams: null,
            minOrderMillimes: null,
            maxOrderMillimes: null,
            maxCodMillimes: null,
            express: false,
          },
        ]),
      },
    };
    const service = new CheckoutOrderService({} as never, {} as never, {} as never);
    const fulfillmentResolver = service as unknown as {
      resolveFulfillment: (
        transactionClient: unknown,
        checkoutInput: CheckoutOrderDto,
        orderMillimes: number,
        weightGrams: number,
        now: Date,
      ) => Promise<{
        phoneConfirmationRequired: boolean;
        manualReviewRequired: boolean;
        feeRuleSnapshot: unknown;
      }>;
    };

    const fulfillment = await fulfillmentResolver.resolveFulfillment(
      transaction,
      input,
      25_000,
      50,
      new Date('2026-07-13T10:00:00.000Z'),
    );

    expect(fulfillment).toMatchObject({
      phoneConfirmationRequired: true,
      manualReviewRequired: true,
      feeRuleSnapshot: {
        schemaVersion: 1,
        method: 'COURIER',
        estimatedMinDays: 1,
        estimatedMaxDays: 3,
        estimatedMinMinutes: null,
        estimatedMaxMinutes: null,
        paymentMethod: 'CASH_ON_DELIVERY',
        assignmentMode: 'MANUAL',
        driverCommunication: 'WHATSAPP',
        phoneConfirmationRequired: true,
        manualReviewRequired: true,
      },
    });
  });

  it('creates a courier order without querying postal codes when the address omits one', async () => {
    const createdAt = new Date('2026-07-13T10:00:00.000Z');
    const postalCodeLookup = vi.fn().mockRejectedValue(new Error('postal code must stay optional'));
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'customer-a' }])
        .mockResolvedValueOnce([{ id: 'cart-a' }])
        .mockResolvedValueOnce([{ id: 'inventory-a' }])
        .mockResolvedValueOnce([{ key: 'order-number' }]),
      user: {
        findFirst: vi.fn().mockResolvedValue({
          email: null,
          customerProfile: {
            id: 'customer-a',
            locale: 'fr',
            blocklistEntries: [],
          },
        }),
      },
      cart: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: 'cart-a' })
          .mockResolvedValueOnce({
            id: 'cart-a',
            version: 1,
            expiresAt: null,
            items: [{ variantId: 'variant-a', quantity: 1 }],
          }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryItem: {
        findMany: vi.fn().mockResolvedValue([{ id: 'inventory-a' }]),
      },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'variant-a',
            nameFr: 'Variant',
            nameAr: 'Variant AR',
            sku: 'SKU-A',
            barcode: null,
            priceMillimes: 10_000,
            promotionalPriceMillimes: null,
            taxRateBps: 0,
            weightGrams: 0,
            product: {
              id: 'product-a',
              nameFr: 'Product',
              nameAr: 'Product AR',
              warningFr: null,
              warningAr: null,
              minimumAge: 18,
            },
            inventoryItems: [
              {
                id: 'inventory-a',
                variantId: 'variant-a',
                locationId: 'location-a',
                batchId: null,
                onHandQuantity: 5,
                reservations: [],
              },
            ],
          },
        ]),
      },
      locality: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'locality-a',
          nameFr: 'Bizerte Centre',
          delegationId: 'delegation-a',
          delegation: {
            nameFr: 'Bizerte Nord',
            governorateId: 'governorate-a',
            governorate: { nameFr: 'Bizerte' },
          },
          zoneLinks: [
            {
              priorityOverride: null,
              deliveryZone: {
                id: 'zone-a',
                code: 'STANDARD_COD',
                nameFr: 'Livraison nationale',
                priority: 50,
                minOrderMillimes: null,
                maxCodMillimes: null,
                freeDeliveryThresholdMillimes: null,
                phoneConfirmationRequired: true,
                manualReviewRequired: false,
                estimatedMinDays: 1,
                estimatedMaxDays: 3,
                estimatedMinMinutes: null,
                estimatedMaxMinutes: null,
                paymentMethod: 'CASH_ON_DELIVERY',
                assignmentMode: 'MANUAL',
                driverCommunication: 'WHATSAPP',
              },
            },
          ],
        }),
      },
      deliveryRate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rate-a',
            type: 'BASE',
            priority: 50,
            feeMillimes: 2_000,
            deliveryZoneId: 'zone-a',
            governorateId: null,
            delegationId: null,
            localityId: null,
            minWeightGrams: null,
            maxWeightGrams: null,
            minOrderMillimes: null,
            maxOrderMillimes: null,
            maxCodMillimes: null,
            express: false,
          },
        ]),
      },
      postalCode: { findFirst: postalCodeLookup },
      sequenceCounter: { update: vi.fn().mockResolvedValue({ value: 1n }) },
      order: {
        create: vi.fn().mockResolvedValue({
          id: 'order-a',
          orderNumber: 'TJ-2026-00000001',
          status: 'PENDING_CONFIRMATION',
          paymentStatus: 'CASH_EXPECTED',
          currency: 'TND',
          subtotalMillimes: 10_000,
          discountTotalMillimes: 0,
          deliveryTotalMillimes: 2_000,
          taxTotalMillimes: 0,
          grandTotalMillimes: 12_000,
          expectedCodMillimes: 12_000,
          deliveryMethodType: 'COURIER',
          deliveryFeeRuleSnapshot: {
            schemaVersion: 1,
            method: 'COURIER',
            estimatedMinDays: 1,
            estimatedMaxDays: 3,
            estimatedMinMinutes: null,
            estimatedMaxMinutes: null,
            paymentMethod: 'CASH_ON_DELIVERY',
            phoneConfirmationRequired: true,
          },
          phoneConfirmationRequired: true,
          createdAt,
        }),
      },
      orderItem: {
        create: vi.fn().mockResolvedValue({ id: 'order-item-a', variantId: 'variant-a' }),
      },
      stockReservation: { create: vi.fn().mockResolvedValue({}) },
      stockMovement: { create: vi.fn().mockResolvedValue({}) },
      orderAddressSnapshot: { create: vi.fn().mockResolvedValue({}) },
      orderConsentSnapshot: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      ageVerificationEvent: { create: vi.fn().mockResolvedValue({}) },
      orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
      delivery: { create: vi.fn().mockResolvedValue({ id: 'delivery-a' }) },
      deliveryEvent: { create: vi.fn().mockResolvedValue({}) },
      cashCollection: { create: vi.fn().mockResolvedValue({}) },
      storeSetting: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      orderIdempotencyKey: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const policies = {
      evaluate: vi.fn().mockResolvedValue({
        allowed: true,
        blockers: [],
        minimumAge: 18,
        requirements: {
          entryAgeGateEnabled: true,
          ageConfirmationRequired: true,
          termsAcceptanceRequired: true,
          privacyAcceptanceRequired: true,
          consentRecordingEnabled: false,
          deliveryAgeVerificationRequired: true,
          customerOrderCreatedNotificationEnabled: false,
        },
      }),
    };
    const service = new CheckoutOrderService(prisma as never, policies as never, {} as never);
    const serviceInternals = service as unknown as {
      claimIdempotency: () => Promise<{
        id: string;
        audienceScope: string;
        requestHash: string;
        orderId: null;
        completedAt: null;
        expiresAt: Date;
      }>;
    };
    vi.spyOn(serviceInternals, 'claimIdempotency').mockResolvedValue({
      id: 'claim-a',
      audienceScope: 'customer:user-a:checkout-order',
      requestHash: checkoutRequestFingerprint(input),
      orderId: null,
      completedAt: null,
      expiresAt: new Date('2026-07-14T10:00:00.000Z'),
    });
    const request = {
      requestId: 'request-a',
      get: vi.fn(),
      socket: {},
    } as unknown as Request;

    await expect(
      service.create(input, 'checkout_0123456789abcdef', 'user-a', request),
    ).resolves.toMatchObject({
      data: {
        id: 'order-a',
        orderNumber: 'TJ-2026-00000001',
        deliveryMethodType: 'COURIER',
      },
    });
    expect(postalCodeLookup).not.toHaveBeenCalled();
  });

  it('retries only P2034 transaction conflicts and stops after the bounded third attempt', async () => {
    const transactionConflict = Object.assign(new Error('transaction conflict'), { code: 'P2034' });
    const prisma = { $transaction: vi.fn().mockRejectedValue(transactionConflict) };
    const service = new CheckoutOrderService(
      prisma as never,
      { evaluate: vi.fn() } as never,
      {} as never,
    );
    const request = {
      requestId: 'request-a',
      get: vi.fn(),
      socket: {},
    } as unknown as Request;

    await expect(
      service.create(input, 'checkout_0123456789abcdef', 'user-a', request),
    ).rejects.toBe(transactionConflict);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry a different Prisma failure code', async () => {
    const failure = Object.assign(new Error('constraint failure'), { code: 'P2002' });
    const prisma = { $transaction: vi.fn().mockRejectedValue(failure) };
    const service = new CheckoutOrderService(
      prisma as never,
      { evaluate: vi.fn() } as never,
      {} as never,
    );
    const request = {
      requestId: 'request-a',
      get: vi.fn(),
      socket: {},
    } as unknown as Request;

    await expect(
      service.create(input, 'checkout_0123456789abcdef', 'user-a', request),
    ).rejects.toBe(failure);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of a customer-scoped key with a different fingerprint', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: 'claim-a',
          audienceScope: 'customer:user-a:checkout-order',
          requestHash: 'f'.repeat(64),
          orderId: 'order-a',
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      ]),
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const policies = { evaluate: vi.fn() };
    const service = new CheckoutOrderService(prisma as never, policies as never, {} as never);
    const request = {
      requestId: 'request-a',
      get: vi.fn(),
      socket: {},
    } as unknown as Request;

    const error = await service
      .create(input, 'checkout_0123456789abcdef', 'user-a', request)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error).toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(policies.evaluate).not.toHaveBeenCalled();
  });
});
