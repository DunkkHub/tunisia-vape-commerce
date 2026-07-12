import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { evaluateCheckoutPolicy, type CheckoutBlocker } from '../compliance/checkout-policy';
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
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(now = new Date()): Promise<AuthoritativeCheckoutPolicy> {
    const [
      storeSettings,
      complianceSettings,
      legalDocuments,
      deliveryZoneCount,
      rateCount,
      pickupCount,
    ] = await Promise.all([
      this.prisma.storeSetting.findMany({
        where: { key: { in: [...STORE_SETTING_KEYS] } },
        select: { key: true, value: true },
      }),
      this.prisma.complianceSetting.findMany({
        where: { key: { in: [...COMPLIANCE_SETTING_KEYS] } },
        select: { key: true, value: true },
      }),
      this.prisma.legalDocument.findMany({
        where: { requiredForCheckout: true },
        select: {
          type: true,
          locale: true,
          versions: {
            where: {
              status: 'PUBLISHED',
              publishedAt: { lte: now },
              effectiveAt: { lte: now },
              retiredAt: null,
            },
            take: 1,
            select: { id: true },
          },
        },
      }),
      this.prisma.deliveryZone.count({
        where: { active: true, supported: true, temporarilySuspended: false },
      }),
      this.prisma.deliveryRate.count({
        where: {
          active: true,
          type: { in: ['BASE', 'GOVERNORATE', 'DELEGATION', 'LOCALITY'] },
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
            { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
          ],
        },
      }),
      this.prisma.pickupLocation.count({ where: { active: true } }),
    ]);

    const store = new Map(storeSettings.map((setting) => [setting.key, setting.value]));
    const compliance = new Map(complianceSettings.map((setting) => [setting.key, setting.value]));
    const requiredTypes = [...new Set(legalDocuments.map((document) => document.type))];
    const hasPublishedRequiredLegalDocuments =
      requiredTypes.length > 0 &&
      requiredTypes.every((type) =>
        ['fr', 'ar'].every((locale) =>
          legalDocuments.some(
            (document) =>
              document.type === type &&
              document.locale.toLowerCase() === locale &&
              document.versions.length > 0,
          ),
        ),
      );
    const minimumAge = jsonInteger(compliance.get('minimum_purchase_age'));
    const blockers = evaluateCheckoutPolicy({
      checkoutEnabled: jsonBoolean(store.get('checkout.enabled')),
      legalReviewCompleted: jsonBoolean(compliance.get('legal_review.completed')),
      maintenanceMode: jsonBoolean(store.get('maintenance.mode')),
      prelaunchMode: jsonBoolean(store.get('prelaunch.mode')),
      minimumAge,
      hasPublishedRequiredLegalDocuments,
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
