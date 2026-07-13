import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { evaluateCheckoutPolicy, type CheckoutBlocker } from '../compliance/checkout-policy';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';

const STORE_SETTING_KEYS = [
  'checkout.enabled',
  'maintenance.mode',
  'prelaunch.mode',
  'store.name',
  'store.phone',
  'store.email',
  'store.address',
] as const;
const COMPLIANCE_SETTING_KEYS = ['legal_review.completed', 'minimum_purchase_age'] as const;

export interface AuthoritativeCheckoutPolicy {
  allowed: boolean;
  blockers: CheckoutBlocker[];
  minimumAge: number | null;
}

const jsonBoolean = (value: Prisma.JsonValue | undefined): boolean => value === true;
const jsonNonEmptyString = (value: Prisma.JsonValue | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;
const jsonInteger = (value: Prisma.JsonValue | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

@Injectable()
export class CheckoutPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async evaluate(
    now = new Date(),
    database: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<AuthoritativeCheckoutPolicy> {
    const [storeSettings, complianceSettings, deliveryZoneCount, rateCount, pickupCount] =
      await Promise.all([
        database.storeSetting.findMany({
          where: { key: { in: [...STORE_SETTING_KEYS] } },
          select: { key: true, value: true },
        }),
        database.complianceSetting.findMany({
          where: { key: { in: [...COMPLIANCE_SETTING_KEYS] } },
          select: { key: true, value: true },
        }),
        database.deliveryZone.count({
          where: { active: true, supported: true, temporarilySuspended: false },
        }),
        database.deliveryRate.count({
          where: {
            active: true,
            type: { in: ['BASE', 'GOVERNORATE', 'DELEGATION', 'LOCALITY'] },
            AND: [
              { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
              { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
            ],
          },
        }),
        database.pickupLocation.count({ where: { active: true } }),
      ]);

    const store = new Map(storeSettings.map((setting) => [setting.key, setting.value]));
    const compliance = new Map(complianceSettings.map((setting) => [setting.key, setting.value]));
    const minimumAge = jsonInteger(compliance.get('minimum_purchase_age'));
    const blockers = evaluateCheckoutPolicy({
      checkoutEnabled:
        this.config.get('CHECKOUT_ENABLED', { infer: true }) &&
        jsonBoolean(store.get('checkout.enabled')),
      legalReviewCompleted:
        this.config.get('LEGAL_REVIEW_COMPLETED', { infer: true }) &&
        jsonBoolean(compliance.get('legal_review.completed')),
      maintenanceMode:
        this.config.get('MAINTENANCE_MODE', { infer: true }) ||
        jsonBoolean(store.get('maintenance.mode')),
      prelaunchMode:
        this.config.get('PRELAUNCH_MODE', { infer: true }) ||
        jsonBoolean(store.get('prelaunch.mode')),
      minimumAge,
      hasStoreInformation: ['store.name', 'store.phone', 'store.email', 'store.address'].every(
        (key) => jsonNonEmptyString(store.get(key)),
      ),
      hasDeliveryMethod: pickupCount > 0 || (deliveryZoneCount > 0 && rateCount > 0),
    });

    return { allowed: blockers.length === 0, blockers, minimumAge };
  }

  async response() {
    const policy = await this.evaluate();
    return {
      data: {
        allowed: policy.allowed,
        blockers: policy.blockers,
        minimumAge: policy.minimumAge,
        currency: 'TND' as const,
      },
    };
  }
}
