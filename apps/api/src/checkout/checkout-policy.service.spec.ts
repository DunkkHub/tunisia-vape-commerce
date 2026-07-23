import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Environment } from '../config/environment';
import type { PrismaService } from '../database/prisma.service';
import { CheckoutPolicyService } from './checkout-policy.service';

interface DatabaseOverrides {
  courierMethod?: boolean;
  pickup?: boolean;
}

const database = (overrides: DatabaseOverrides = {}) =>
  ({
    storeSetting: {
      findMany: vi.fn().mockResolvedValue([
        { key: 'checkout.enabled', value: true },
        { key: 'maintenance.mode', value: false },
        { key: 'prelaunch.mode', value: false },
        { key: 'store.name', value: 'Store' },
        { key: 'store.phone', value: '+21620111222' },
        { key: 'store.email', value: 'store@example.test' },
        { key: 'store.address', value: 'Tunis' },
      ]),
    },
    complianceSetting: {
      findMany: vi.fn().mockResolvedValue([
        { key: 'minimum_purchase_age', value: 18 },
        { key: 'age_gate.entry.enabled', value: true },
        { key: 'age_gate.checkout.enabled', value: true },
        { key: 'consent.terms.required', value: true },
        { key: 'consent.privacy.required', value: true },
        { key: 'consent.recording.enabled', value: true },
        { key: 'delivery.age_verification_required', value: true },
      ]),
    },
    deliveryZone: {
      count: vi.fn().mockResolvedValue(overrides.courierMethod === false ? 0 : 1),
    },
    pickupLocation: { count: vi.fn().mockResolvedValue(overrides.pickup === true ? 1 : 0) },
  }) as unknown as PrismaService;

const configuration = (overrides: Partial<Record<keyof Environment, unknown>> = {}) =>
  ({
    get: vi.fn((key: keyof Environment) => {
      const values: Partial<Record<keyof Environment, unknown>> = {
        CHECKOUT_ENABLED: true,
        MAINTENANCE_MODE: false,
        PRELAUNCH_MODE: false,
        ...overrides,
      };
      return values[key];
    }),
  }) as unknown as ConfigService<Environment, true>;

describe('CheckoutPolicyService', () => {
  it('does not query legal-review or legal-document rows', async () => {
    const prisma = database();
    const complianceFindMany = vi.spyOn(prisma.complianceSetting, 'findMany');
    const service = new CheckoutPolicyService(prisma, configuration());

    await expect(service.evaluate()).resolves.toEqual({
      allowed: true,
      blockers: [],
      minimumAge: 18,
      requirements: {
        entryAgeGateEnabled: true,
        ageConfirmationRequired: true,
        termsAcceptanceRequired: true,
        privacyAcceptanceRequired: true,
        consentRecordingEnabled: true,
        deliveryAgeVerificationRequired: true,
        customerOrderCreatedNotificationEnabled: true,
      },
    });
    expect('legalDocument' in prisma).toBe(false);
    expect(complianceFindMany).toHaveBeenCalledWith({
      where: {
        key: {
          in: [
            'minimum_purchase_age',
            'age_gate.entry.enabled',
            'age_gate.checkout.enabled',
            'consent.terms.required',
            'consent.privacy.required',
            'consent.recording.enabled',
            'delivery.age_verification_required',
          ],
        },
      },
      select: { key: true, value: true },
    });
  });

  it('treats environment flags as stricter stops than open database settings', async () => {
    const service = new CheckoutPolicyService(
      database(),
      configuration({
        CHECKOUT_ENABLED: false,
        PRELAUNCH_MODE: true,
      }),
    );

    await expect(service.evaluate()).resolves.toMatchObject({
      allowed: false,
      blockers: ['CHECKOUT_DISABLED', 'PRELAUNCH_MODE'],
    });
  });

  it('still blocks missing operational delivery configuration', async () => {
    const service = new CheckoutPolicyService(database({ courierMethod: false }), configuration());

    await expect(service.evaluate()).resolves.toMatchObject({
      allowed: false,
      blockers: ['DELIVERY_METHOD_MISSING'],
    });
  });

  it('accepts a current valid base rate belonging to the active supported zone', async () => {
    const service = new CheckoutPolicyService(database(), configuration());

    await expect(service.evaluate()).resolves.toMatchObject({
      allowed: true,
      blockers: [],
    });
  });

  it('blocks when no active supported zone owns the current valid base rate', async () => {
    const prisma = database({ courierMethod: false });
    const zoneCount = vi.spyOn(prisma.deliveryZone, 'count');
    const now = new Date('2026-07-20T12:00:00.000Z');
    const service = new CheckoutPolicyService(prisma, configuration());

    await expect(service.evaluate(now)).resolves.toMatchObject({
      allowed: false,
      blockers: ['DELIVERY_METHOD_MISSING'],
    });
    expect(zoneCount).toHaveBeenCalledWith({
      where: {
        active: true,
        supported: true,
        temporarilySuspended: false,
        rates: {
          some: {
            active: true,
            type: 'BASE',
            feeMillimes: { gte: 0 },
            governorateId: null,
            delegationId: null,
            localityId: null,
            AND: [
              { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
              { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
            ],
          },
        },
      },
    });
    expect('deliveryRate' in prisma).toBe(false);
  });

  it('keeps an active pickup as an operational delivery method without a courier rate', async () => {
    const service = new CheckoutPolicyService(
      database({ courierMethod: false, pickup: true }),
      configuration(),
    );

    await expect(service.evaluate()).resolves.toMatchObject({
      allowed: true,
      blockers: [],
    });
  });
});
