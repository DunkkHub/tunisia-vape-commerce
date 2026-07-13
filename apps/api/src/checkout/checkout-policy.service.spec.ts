import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Environment } from '../config/environment';
import type { PrismaService } from '../database/prisma.service';
import { CheckoutPolicyService } from './checkout-policy.service';

const database = (overrides: Record<string, boolean> = {}) =>
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
        { key: 'legal_review.completed', value: true },
        { key: 'minimum_purchase_age', value: 18 },
      ]),
    },
    deliveryZone: { count: vi.fn().mockResolvedValue(overrides.zone === false ? 0 : 1) },
    deliveryRate: { count: vi.fn().mockResolvedValue(overrides.rate === false ? 0 : 1) },
    pickupLocation: { count: vi.fn().mockResolvedValue(0) },
  }) as unknown as PrismaService;

const configuration = (overrides: Partial<Record<keyof Environment, unknown>> = {}) =>
  ({
    get: vi.fn((key: keyof Environment) => {
      const values: Partial<Record<keyof Environment, unknown>> = {
        CHECKOUT_ENABLED: true,
        LEGAL_REVIEW_COMPLETED: true,
        MAINTENANCE_MODE: false,
        PRELAUNCH_MODE: false,
        ...overrides,
      };
      return values[key];
    }),
  }) as unknown as ConfigService<Environment, true>;

describe('CheckoutPolicyService', () => {
  it('does not require legal-document rows after recorded legal approval', async () => {
    const prisma = database();
    const service = new CheckoutPolicyService(prisma, configuration());

    await expect(service.evaluate()).resolves.toEqual({
      allowed: true,
      blockers: [],
      minimumAge: 18,
    });
    expect('legalDocument' in prisma).toBe(false);
  });

  it('treats environment flags as stricter stops than open database settings', async () => {
    const service = new CheckoutPolicyService(
      database(),
      configuration({
        CHECKOUT_ENABLED: false,
        LEGAL_REVIEW_COMPLETED: false,
        PRELAUNCH_MODE: true,
      }),
    );

    await expect(service.evaluate()).resolves.toMatchObject({
      allowed: false,
      blockers: ['CHECKOUT_DISABLED', 'LEGAL_REVIEW_REQUIRED', 'PRELAUNCH_MODE'],
    });
  });

  it('still blocks missing operational delivery configuration', async () => {
    const service = new CheckoutPolicyService(
      database({ zone: false, rate: false }),
      configuration(),
    );

    await expect(service.evaluate()).resolves.toMatchObject({
      allowed: false,
      blockers: ['DELIVERY_METHOD_MISSING'],
    });
  });
});
