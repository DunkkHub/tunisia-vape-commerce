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
  'notifications.customer_order_created.enabled',
] as const;
const COMPLIANCE_SETTING_KEYS = [
  'minimum_purchase_age',
  'age_gate.entry.enabled',
  'age_gate.checkout.enabled',
  'consent.terms.required',
  'consent.privacy.required',
  'consent.recording.enabled',
  'delivery.age_verification_required',
] as const;

export interface CheckoutRequirements {
  entryAgeGateEnabled: boolean;
  ageConfirmationRequired: boolean;
  termsAcceptanceRequired: boolean;
  privacyAcceptanceRequired: boolean;
  consentRecordingEnabled: boolean;
  deliveryAgeVerificationRequired: boolean;
  customerOrderCreatedNotificationEnabled: boolean;
}

export interface AuthoritativeCheckoutPolicy {
  allowed: boolean;
  blockers: CheckoutBlocker[];
  minimumAge: number | null;
  requirements: CheckoutRequirements;
}

const jsonBoolean = (value: Prisma.JsonValue | undefined): boolean => value === true;
const jsonNonEmptyString = (value: Prisma.JsonValue | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;
const jsonInteger = (value: Prisma.JsonValue | undefined): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
const configuredBoolean = (values: Map<string, Prisma.JsonValue>, key: string): boolean =>
  values.has(key) ? jsonBoolean(values.get(key)) : true;

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
    const [storeSettings, complianceSettings, courierMethodCount, pickupCount] = await Promise.all([
      database.storeSetting.findMany({
        where: { key: { in: [...STORE_SETTING_KEYS] } },
        select: { key: true, value: true },
      }),
      database.complianceSetting.findMany({
        where: { key: { in: [...COMPLIANCE_SETTING_KEYS] } },
        select: { key: true, value: true },
      }),
      database.deliveryZone.count({
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
      }),
      database.pickupLocation.count({ where: { active: true } }),
    ]);

    const store = new Map(storeSettings.map((setting) => [setting.key, setting.value]));
    const compliance = new Map(complianceSettings.map((setting) => [setting.key, setting.value]));
    const minimumAge = jsonInteger(compliance.get('minimum_purchase_age'));
    const requirements: CheckoutRequirements = {
      entryAgeGateEnabled: configuredBoolean(compliance, 'age_gate.entry.enabled'),
      ageConfirmationRequired: configuredBoolean(compliance, 'age_gate.checkout.enabled'),
      termsAcceptanceRequired: configuredBoolean(compliance, 'consent.terms.required'),
      privacyAcceptanceRequired: configuredBoolean(compliance, 'consent.privacy.required'),
      consentRecordingEnabled: configuredBoolean(compliance, 'consent.recording.enabled'),
      deliveryAgeVerificationRequired: configuredBoolean(
        compliance,
        'delivery.age_verification_required',
      ),
      customerOrderCreatedNotificationEnabled: configuredBoolean(
        store,
        'notifications.customer_order_created.enabled',
      ),
    };
    const blockers = evaluateCheckoutPolicy({
      checkoutEnabled:
        this.config.get('CHECKOUT_ENABLED', { infer: true }) &&
        jsonBoolean(store.get('checkout.enabled')),
      maintenanceMode:
        this.config.get('MAINTENANCE_MODE', { infer: true }) ||
        jsonBoolean(store.get('maintenance.mode')),
      prelaunchMode:
        this.config.get('PRELAUNCH_MODE', { infer: true }) ||
        jsonBoolean(store.get('prelaunch.mode')),
      minimumAge,
      minimumAgeRequired:
        requirements.entryAgeGateEnabled ||
        requirements.ageConfirmationRequired ||
        requirements.deliveryAgeVerificationRequired,
      hasStoreInformation: ['store.name', 'store.phone', 'store.email', 'store.address'].every(
        (key) => jsonNonEmptyString(store.get(key)),
      ),
      hasDeliveryMethod: pickupCount > 0 || courierMethodCount > 0,
    });

    return { allowed: blockers.length === 0, blockers, minimumAge, requirements };
  }

  async response() {
    const policy = await this.evaluate();
    return {
      data: {
        allowed: policy.allowed,
        blockers: policy.blockers,
        minimumAge: policy.minimumAge,
        requirements: policy.requirements,
        currency: 'TND' as const,
      },
    };
  }
}
