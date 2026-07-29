import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import type { CheckoutPolicyService } from './checkout-policy.service';
import { CheckoutQuoteService } from './checkout-quote.service';

const checkoutPolicy = {
  evaluate: vi.fn().mockResolvedValue({ allowed: true, blockers: [], minimumAge: 18 }),
} as unknown as CheckoutPolicyService;

const pickup = {
  id: 'pickup-1',
  code: 'BIZERTE',
  nameFr: 'Bizerte',
  nameAr: 'Bizerte',
  address: 'Bizerte',
  minOrderMillimes: null,
  maxCodMillimes: null,
};

const variant = (
  inventoryItems: Array<{ onHandQuantity: number; reservations: Array<{ quantity: number }> }>,
) => ({
  id: 'variant-1',
  nameFr: 'Menthe',
  nameAr: 'Menthe',
  sku: 'SKU-1',
  priceMillimes: 25_000,
  promotionalPriceMillimes: null,
  taxRateBps: 0,
  weightGrams: 50,
  product: {
    id: 'product-1',
    nameFr: 'Produit',
    nameAr: 'Produit',
    slug: 'produit',
  },
  inventoryItems,
});

const serviceWithInventory = (
  inventoryItems: Array<{ onHandQuantity: number; reservations: Array<{ quantity: number }> }>,
) => {
  const findMany = vi.fn().mockResolvedValue([variant(inventoryItems)]);
  const findPickup = vi.fn().mockResolvedValue(pickup);
  const prisma = {
    productVariant: { findMany },
    pickupLocation: { findFirst: findPickup },
  } as unknown as PrismaService;
  return {
    service: new CheckoutQuoteService(prisma, checkoutPolicy),
    findMany,
    findPickup,
  };
};

const input = {
  items: [{ variantId: 'variant-1', quantity: 1 }],
  pickupLocationId: 'pickup-1',
};

describe('CheckoutQuoteService inventory eligibility', () => {
  it('queries only positive inventory at active fulfillment locations in eligible batches', async () => {
    const { service, findMany } = serviceWithInventory([
      { onHandQuantity: 3, reservations: [{ quantity: 1 }] },
    ]);

    await expect(service.quote(input)).resolves.toMatchObject({
      data: {
        lines: [{ variantId: 'variant-1', advisoryAvailableQuantity: 2 }],
        stockReserved: false,
        orderCreated: false,
      },
    });

    const request = findMany.mock.calls[0]?.[0] as {
      select: {
        inventoryItems: {
          where: {
            onHandQuantity: { gt: number };
            location: { is: { active: boolean; fulfillsOrders: boolean } };
            OR: [
              { batchId: null },
              {
                batch: {
                  is: {
                    archivedAt: null;
                    OR: [{ expiryDate: null }, { expiryDate: { gt: Date } }];
                  };
                };
              },
            ];
          };
        };
      };
    };
    const inventoryWhere = request.select.inventoryItems.where;
    expect(inventoryWhere).toMatchObject({
      onHandQuantity: { gt: 0 },
      location: { is: { active: true, fulfillsOrders: true } },
      OR: [
        { batchId: null },
        {
          batch: {
            is: {
              archivedAt: null,
            },
          },
        },
      ],
    });
    expect(inventoryWhere.OR[1].batch.is.OR[0]).toEqual({ expiryDate: null });
    expect(inventoryWhere.OR[1].batch.is.OR[1].expiryDate.gt).toBeInstanceOf(Date);
  });

  it('rejects the quote when the eligible inventory query yields no available stock', async () => {
    const { service, findPickup } = serviceWithInventory([]);

    const error = await service.quote(input).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'OUT_OF_STOCK' });
    expect(findPickup).not.toHaveBeenCalled();
  });

  it('returns public courier operational metadata without exposing dispatch controls', async () => {
    const findLocality = vi.fn().mockResolvedValue({
      id: 'locality-1',
      delegationId: 'delegation-1',
      delegation: { governorateId: 'governorate-1' },
      zoneLinks: [
        {
          priorityOverride: null,
          deliveryZone: {
            id: 'zone-1',
            code: 'BIZERTE_EXPRESS',
            nameFr: 'Bizerte Express',
            nameAr: 'Bizerte Express',
            priority: 100,
            minOrderMillimes: null,
            maxCodMillimes: null,
            freeDeliveryThresholdMillimes: null,
            estimatedMinDays: null,
            estimatedMaxDays: null,
            estimatedMinMinutes: 30,
            estimatedMaxMinutes: 50,
            paymentMethod: 'CASH_ON_DELIVERY',
            phoneConfirmationRequired: true,
          },
        },
      ],
    });
    const findRates = vi.fn().mockResolvedValue([
      {
        id: 'rate-1',
        type: 'BASE',
        priority: 100,
        feeMillimes: 8_000,
        deliveryZoneId: 'zone-1',
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
    ]);
    const prisma = {
      productVariant: {
        findMany: vi.fn().mockResolvedValue([variant([{ onHandQuantity: 3, reservations: [] }])]),
      },
      locality: { findFirst: findLocality },
      deliveryRate: { findMany: findRates },
    } as unknown as PrismaService;
    const service = new CheckoutQuoteService(prisma, checkoutPolicy);

    const result = await service.quote({
      items: [{ variantId: 'variant-1', quantity: 1 }],
      localityId: 'locality-1',
    });

    expect(result.data.fulfillment).toMatchObject({
      type: 'COURIER',
      estimatedMinDays: null,
      estimatedMaxDays: null,
      estimatedMinMinutes: 30,
      estimatedMaxMinutes: 50,
      paymentMethod: 'CASH_ON_DELIVERY',
      phoneConfirmationRequired: true,
    });
    expect(result.data.fulfillment).not.toHaveProperty('assignmentMode');
    expect(result.data.fulfillment).not.toHaveProperty('driverCommunication');
    expect(result.data.fulfillment).not.toHaveProperty('manualReviewRequired');

    const localityRequest = findLocality.mock.calls[0]?.[0] as {
      select: { zoneLinks: { select: { deliveryZone: { select: Record<string, boolean> } } } };
    };
    expect(localityRequest.select.zoneLinks.select.deliveryZone.select).toMatchObject({
      estimatedMinDays: true,
      estimatedMaxDays: true,
      estimatedMinMinutes: true,
      estimatedMaxMinutes: true,
      paymentMethod: true,
      phoneConfirmationRequired: true,
    });
  });
});
