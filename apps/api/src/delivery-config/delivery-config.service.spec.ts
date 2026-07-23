import { ConflictException } from '@nestjs/common';
import { DeliveryRateType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import {
  DeliveryRatesConfigService,
  DeliveryWindowsConfigService,
  DeliveryZonesConfigService,
  PickupLocationsConfigService,
} from './delivery-config.service';

const updatedAt = new Date('2026-07-13T10:00:00.000Z');
const context = { userId: 'admin-1', requestId: 'request-1' };

const zoneRecord = () => ({
  id: 'zone-1',
  code: 'TUNIS',
  nameFr: 'Tunis',
  nameAr: 'Tunis',
  priority: 10,
  active: false,
  supported: false,
  temporarilySuspended: false,
  phoneConfirmationRequired: false,
  manualReviewRequired: false,
  minOrderMillimes: null,
  maxCodMillimes: null,
  freeDeliveryThresholdMillimes: null,
  estimatedMinDays: 1,
  estimatedMaxDays: 2,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt,
  _count: { localities: 1, rates: 0 },
});

const rateRecord = () => ({
  id: 'rate-1',
  type: DeliveryRateType.BASE,
  name: 'Tunis base',
  deliveryZoneId: 'zone-1',
  governorateId: null,
  delegationId: null,
  localityId: null,
  priority: 10,
  feeMillimes: 7_000,
  minWeightGrams: null,
  maxWeightGrams: null,
  minOrderMillimes: null,
  maxOrderMillimes: null,
  maxCodMillimes: null,
  express: false,
  active: false,
  validFrom: null,
  validUntil: null,
  version: 1,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt,
});

const pickupRecord = () => ({
  id: 'pickup-1',
  inventoryLocationId: null,
  code: 'PICKUP_TUNIS',
  nameFr: 'Tunis',
  nameAr: 'Tunis',
  address: '1 Example Street',
  phoneE164: null,
  active: false,
  minOrderMillimes: null,
  maxCodMillimes: null,
  openingHours: null,
});

const responseCode = (error: unknown): string | undefined => {
  if (!(error instanceof ConflictException)) return undefined;
  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? String(response.code)
    : undefined;
};

describe('administrator delivery configuration invariants', () => {
  it('does not activate a delivery zone without a current active base rate', async () => {
    const transaction = {
      deliveryZone: {
        findUnique: vi.fn().mockResolvedValue(zoneRecord()),
        updateMany: vi.fn(),
      },
      deliveryZoneLocality: { count: vi.fn().mockResolvedValue(1) },
      deliveryRate: { count: vi.fn().mockResolvedValue(0) },
    };
    const service = new DeliveryZonesConfigService({
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService);

    const error = await service
      .setActive('zone-1', updatedAt.toISOString(), true, context)
      .catch((caught: unknown) => caught);

    expect(responseCode(error)).toBe('DELIVERY_ZONE_RATE_MISSING');
    expect(transaction.deliveryZone.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an equal-priority active rate covering the same scope and validity period', async () => {
    const record = rateRecord();
    const transaction = {
      deliveryRate: {
        findUnique: vi.fn().mockResolvedValue(record),
        findFirst: vi.fn().mockResolvedValue({ id: 'rate-2' }),
        updateMany: vi.fn(),
      },
      deliveryZone: { findUnique: vi.fn().mockResolvedValue({ id: 'zone-1' }) },
    };
    const service = new DeliveryRatesConfigService({
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService);

    const error = await service
      .setActive('rate-1', 1, true, context)
      .catch((caught: unknown) => caught);

    expect(responseCode(error)).toBe('DELIVERY_RATE_AMBIGUOUS');
    expect(transaction.deliveryRate.updateMany).not.toHaveBeenCalled();
  });

  it('permits a global base rate supported by the checkout resolver', async () => {
    const globalRate = {
      ...rateRecord(),
      deliveryZoneId: null,
    };
    const transaction = {
      deliveryRate: {
        create: vi.fn().mockResolvedValue({ id: 'rate-1' }),
        findUnique: vi.fn().mockResolvedValue(globalRate),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new DeliveryRatesConfigService({
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService);

    const response = await service.create(
      {
        type: DeliveryRateType.BASE,
        name: 'Global base',
        feeMillimes: 7_000,
      },
      context,
    );

    const createInput = transaction.deliveryRate.create.mock.calls[0]![0] as {
      data: { deliveryZoneId: string | null; active: boolean; feeMillimes: number };
    };
    expect(createInput.data).toMatchObject({
      deliveryZoneId: null,
      active: false,
      feeMillimes: 7_000,
    });
    expect(response.data.deliveryZoneId).toBeNull();
  });

  it('rolls back deactivation of the last current base rate for an active zone', async () => {
    const current = { ...rateRecord(), active: true };
    const changed = { ...current, active: false, version: 2 };
    const transaction = {
      deliveryRate: {
        findUnique: vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(changed),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      deliveryZone: { findUnique: vi.fn().mockResolvedValue({ id: 'zone-1', active: true }) },
      auditLog: { create: vi.fn() },
    };
    const service = new DeliveryRatesConfigService({
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService);

    const error = await service
      .setActive('rate-1', 1, false, context)
      .catch((caught: unknown) => caught);

    expect(responseCode(error)).toBe('ACTIVE_DELIVERY_ZONE_RATE_REQUIRED');
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('rolls back removal of the last supported locality from an active zone', async () => {
    const activeZone = { ...zoneRecord(), active: true, supported: true };
    const transaction = {
      deliveryZone: {
        findUnique: vi.fn().mockResolvedValue(activeZone),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      governorate: { findFirst: vi.fn().mockResolvedValue({ id: 'governorate-1' }) },
      locality: { findMany: vi.fn().mockResolvedValue([{ id: 'locality-1' }]) },
      deliveryZoneLocality: {
        upsert: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
      },
      auditLog: { create: vi.fn() },
    };
    const service = new DeliveryZonesConfigService({
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService);

    const error = await service
      .linkGeography(
        'zone-1',
        {
          expectedUpdatedAt: updatedAt.toISOString(),
          confirmed: true,
          scope: 'GOVERNORATE',
          geographyId: 'governorate-1',
          active: false,
        },
        context,
      )
      .catch((caught: unknown) => caught);

    expect(responseCode(error)).toBe('ACTIVE_DELIVERY_ZONE_GEOGRAPHY_REQUIRED');
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects stale pickup state tokens before writing', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'pickup-1' }]),
      pickupLocation: {
        findUnique: vi.fn().mockResolvedValue(pickupRecord()),
        update: vi.fn(),
      },
    };
    const service = new PickupLocationsConfigService({
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService);

    const error = await service
      .setActive('pickup-1', '0'.repeat(64), true, context)
      .catch((caught: unknown) => caught);

    expect(responseCode(error)).toBe('PICKUP_LOCATION_VERSION_CONFLICT');
    expect(transaction.pickupLocation.update).not.toHaveBeenCalled();
  });

  it('requires exactly one schema-supported owner for a delivery time window', async () => {
    const transaction = { deliveryTimeWindow: { create: vi.fn() } };
    const service = new DeliveryWindowsConfigService({
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService);

    const error = await service
      .create(
        {
          code: 'MORNING',
          deliveryZoneId: 'zone-1',
          pickupLocationId: 'pickup-1',
          labelFr: 'Matin',
          labelAr: 'Morning',
          startsAt: '09:00',
          endsAt: '12:00',
        },
        context,
      )
      .catch((caught: unknown) => caught);

    expect(responseCode(error)).toBe('DELIVERY_WINDOW_OWNER_INVALID');
    expect(transaction.deliveryTimeWindow.create).not.toHaveBeenCalled();
  });
});
