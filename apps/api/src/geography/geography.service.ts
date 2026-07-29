import { Injectable } from '@nestjs/common';
import type { DeliveryPaymentMethod, Prisma } from '@prisma/client';
import type { StorefrontLocale } from '../catalog/catalog.service';
import { PrismaService } from '../database/prisma.service';

const MAX_GOVERNORATES = 24;
const MAX_DELEGATIONS_PER_GOVERNORATE = 100;
const MAX_LOCALITIES_PER_DELEGATION = 250;
const MAX_DELIVERY_WINDOWS = 100;
const MAX_PICKUP_LOCATIONS = 50;
const MAX_DELIVERY_RATE_CANDIDATES = 250;

const eligibleZoneLinkWhere: Prisma.DeliveryZoneLocalityWhereInput = {
  active: true,
  deliveryZone: {
    is: { active: true, supported: true, temporarilySuspended: false },
  },
};

const currentRateWhere = (now: Date): Prisma.DeliveryRateWhereInput => ({
  active: true,
  AND: [
    { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
    { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
  ],
});

const DELIVERY_METHOD_RATE_SELECT = {
  id: true,
  type: true,
  priority: true,
  feeMillimes: true,
  deliveryZoneId: true,
  governorateId: true,
  delegationId: true,
  localityId: true,
  minWeightGrams: true,
  maxWeightGrams: true,
  minOrderMillimes: true,
  maxOrderMillimes: true,
  maxCodMillimes: true,
  express: true,
} as const satisfies Prisma.DeliveryRateSelect;
type DeliveryMethodRate = Prisma.DeliveryRateGetPayload<{
  select: typeof DELIVERY_METHOD_RATE_SELECT;
}>;

@Injectable()
export class GeographyService {
  constructor(private readonly prisma: PrismaService) {}

  async governorates(locale: StorefrontLocale) {
    const records = await this.prisma.governorate.findMany({
      where: { active: true },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: MAX_GOVERNORATES,
      select: {
        id: true,
        nameFr: true,
        nameAr: true,
        delegations: {
          where: {
            active: true,
            localities: { some: { active: true, zoneLinks: { some: eligibleZoneLinkWhere } } },
          },
          take: 1,
          select: { id: true },
        },
      },
    });
    return {
      data: records.map((record) => ({
        id: record.id,
        name: localize(locale, record.nameFr, record.nameAr),
        supported: record.delegations.length > 0,
      })),
    };
  }

  async delegations(governorateId: string, locale: StorefrontLocale) {
    const records = await this.prisma.delegation.findMany({
      where: {
        governorateId,
        active: true,
        governorate: { is: { active: true } },
      },
      orderBy: [{ nameFr: 'asc' }, { code: 'asc' }, { id: 'asc' }],
      take: MAX_DELEGATIONS_PER_GOVERNORATE,
      select: {
        id: true,
        nameFr: true,
        nameAr: true,
        localities: {
          where: { active: true, zoneLinks: { some: eligibleZoneLinkWhere } },
          take: 1,
          select: { id: true },
        },
      },
    });
    return {
      data: records.map((record) => ({
        id: record.id,
        name: localize(locale, record.nameFr, record.nameAr),
        supported: record.localities.length > 0,
      })),
    };
  }

  async localities(delegationId: string, locale: StorefrontLocale) {
    const records = await this.prisma.locality.findMany({
      where: {
        delegationId,
        active: true,
        delegation: { is: { active: true, governorate: { is: { active: true } } } },
      },
      orderBy: [{ nameFr: 'asc' }, { code: 'asc' }, { id: 'asc' }],
      take: MAX_LOCALITIES_PER_DELEGATION,
      select: {
        id: true,
        nameFr: true,
        nameAr: true,
        postalCodes: {
          where: { active: true },
          orderBy: [{ code: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { code: true },
        },
        zoneLinks: {
          where: eligibleZoneLinkWhere,
          take: 1,
          select: { localityId: true },
        },
      },
    });
    return {
      data: records.map((record) => ({
        id: record.id,
        name: localize(locale, record.nameFr, record.nameAr),
        ...(record.postalCodes[0] ? { postalCode: record.postalCodes[0].code } : {}),
        supported: record.zoneLinks.length > 0,
      })),
    };
  }

  async deliveryWindows(localityId: string, locale: StorefrontLocale) {
    const locality = await this.prisma.locality.findFirst({
      where: {
        id: localityId,
        active: true,
        delegation: { is: { active: true, governorate: { is: { active: true } } } },
      },
      select: {
        zoneLinks: {
          where: eligibleZoneLinkWhere,
          take: 20,
          select: {
            priorityOverride: true,
            deliveryZone: {
              select: {
                id: true,
                priority: true,
                timeWindows: {
                  where: { active: true },
                  orderBy: [{ dayOfWeek: 'asc' }, { startsAt: 'asc' }, { id: 'asc' }],
                  take: MAX_DELIVERY_WINDOWS,
                  select: {
                    id: true,
                    labelFr: true,
                    labelAr: true,
                    dayOfWeek: true,
                    startsAt: true,
                    endsAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!locality) return { data: [] };

    const links = [...locality.zoneLinks].sort(
      (left, right) =>
        (right.priorityOverride ?? right.deliveryZone.priority) -
          (left.priorityOverride ?? left.deliveryZone.priority) ||
        left.deliveryZone.id.localeCompare(right.deliveryZone.id),
    );
    const selected = links[0];
    if (!selected) return { data: [] };
    const selectedPriority = selected.priorityOverride ?? selected.deliveryZone.priority;
    const nextPriority = links[1]
      ? (links[1].priorityOverride ?? links[1].deliveryZone.priority)
      : null;
    // Match checkout's fail-closed zone resolver: an equal-priority tie is configuration ambiguity.
    if (nextPriority === selectedPriority) return { data: [] };
    return {
      data: selected.deliveryZone.timeWindows.map((window) => ({
        id: window.id,
        label: localize(locale, window.labelFr, window.labelAr),
        dayOfWeek: window.dayOfWeek,
        startsAt: formatDatabaseTime(window.startsAt),
        endsAt: formatDatabaseTime(window.endsAt),
      })),
    };
  }

  async deliveryMethods(localityId: string | undefined, locale: StorefrontLocale) {
    const pickups = await this.prisma.pickupLocation.findMany({
      where: { active: true },
      orderBy: [{ nameFr: 'asc' }, { id: 'asc' }],
      take: MAX_PICKUP_LOCATIONS,
      select: {
        id: true,
        nameFr: true,
        nameAr: true,
        address: true,
        minOrderMillimes: true,
        maxCodMillimes: true,
      },
    });
    const methods: Array<{
      id: string;
      type: 'COURIER' | 'STORE_PICKUP';
      label: string;
      address: string | null;
      minimumOrderMillimes: number | null;
      maximumCodMillimes: number | null;
      estimatedMinDays: number | null;
      estimatedMaxDays: number | null;
      estimatedMinMinutes: number | null;
      estimatedMaxMinutes: number | null;
      paymentMethod: DeliveryPaymentMethod | null;
      phoneConfirmationRequired: boolean;
    }> = [];

    if (localityId) {
      const courier = await this.courierMethod(localityId, locale);
      if (courier) methods.push(courier);
    }
    methods.push(
      ...pickups.map((pickup) => ({
        id: pickup.id,
        type: 'STORE_PICKUP' as const,
        label: localize(locale, pickup.nameFr, pickup.nameAr),
        address: pickup.address,
        minimumOrderMillimes: pickup.minOrderMillimes,
        maximumCodMillimes: pickup.maxCodMillimes,
        estimatedMinDays: null,
        estimatedMaxDays: null,
        estimatedMinMinutes: null,
        estimatedMaxMinutes: null,
        paymentMethod: null,
        phoneConfirmationRequired: false,
      })),
    );
    return { data: methods };
  }

  private async courierMethod(localityId: string, locale: StorefrontLocale) {
    const locality = await this.prisma.locality.findFirst({
      where: {
        id: localityId,
        active: true,
        delegation: { is: { active: true, governorate: { is: { active: true } } } },
      },
      select: {
        id: true,
        delegationId: true,
        delegation: { select: { governorateId: true } },
        zoneLinks: {
          where: eligibleZoneLinkWhere,
          take: 20,
          select: {
            priorityOverride: true,
            deliveryZone: {
              select: {
                id: true,
                priority: true,
                nameFr: true,
                nameAr: true,
                minOrderMillimes: true,
                maxCodMillimes: true,
                estimatedMinDays: true,
                estimatedMaxDays: true,
                estimatedMinMinutes: true,
                estimatedMaxMinutes: true,
                paymentMethod: true,
                phoneConfirmationRequired: true,
              },
            },
          },
        },
      },
    });
    if (!locality || locality.zoneLinks.length === 0) return null;
    const zones = [...locality.zoneLinks].sort(
      (left, right) =>
        (right.priorityOverride ?? right.deliveryZone.priority) -
          (left.priorityOverride ?? left.deliveryZone.priority) ||
        left.deliveryZone.id.localeCompare(right.deliveryZone.id),
    );
    const selected = zones[0]!;
    const selectedPriority = selected.priorityOverride ?? selected.deliveryZone.priority;
    const nextPriority = zones[1]
      ? (zones[1].priorityOverride ?? zones[1].deliveryZone.priority)
      : null;
    if (nextPriority === selectedPriority) return null;

    const now = new Date();
    const rates = await this.prisma.deliveryRate.findMany({
      where: {
        ...currentRateWhere(now),
        OR: [
          { localityId: locality.id },
          { delegationId: locality.delegationId, localityId: null },
          {
            governorateId: locality.delegation.governorateId,
            delegationId: null,
            localityId: null,
          },
          {
            deliveryZoneId: selected.deliveryZone.id,
            governorateId: null,
            delegationId: null,
            localityId: null,
          },
          {
            deliveryZoneId: null,
            governorateId: null,
            delegationId: null,
            localityId: null,
          },
        ],
      },
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
      take: MAX_DELIVERY_RATE_CANDIDATES + 1,
      select: DELIVERY_METHOD_RATE_SELECT,
    });
    if (rates.length > MAX_DELIVERY_RATE_CANDIDATES) return null;
    const hasPotentialBaseRate = rates.some((rate) =>
      canBackCourierMethod(rate, {
        deliveryZoneId: selected.deliveryZone.id,
        governorateId: locality.delegation.governorateId,
        delegationId: locality.delegationId,
        localityId: locality.id,
        zoneMinOrderMillimes: selected.deliveryZone.minOrderMillimes,
        zoneMaxCodMillimes: selected.deliveryZone.maxCodMillimes,
      }),
    );
    if (!hasPotentialBaseRate) return null;
    return {
      id: `courier:${selected.deliveryZone.id}`,
      type: 'COURIER' as const,
      label: localize(locale, selected.deliveryZone.nameFr, selected.deliveryZone.nameAr),
      address: null,
      minimumOrderMillimes: selected.deliveryZone.minOrderMillimes,
      maximumCodMillimes: selected.deliveryZone.maxCodMillimes,
      estimatedMinDays: selected.deliveryZone.estimatedMinDays,
      estimatedMaxDays: selected.deliveryZone.estimatedMaxDays,
      estimatedMinMinutes: selected.deliveryZone.estimatedMinMinutes,
      estimatedMaxMinutes: selected.deliveryZone.estimatedMaxMinutes,
      paymentMethod: selected.deliveryZone.paymentMethod,
      phoneConfirmationRequired: selected.deliveryZone.phoneConfirmationRequired,
    };
  }
}

const canBackCourierMethod = (
  rate: DeliveryMethodRate,
  context: {
    deliveryZoneId: string;
    governorateId: string;
    delegationId: string;
    localityId: string;
    zoneMinOrderMillimes: number | null;
    zoneMaxCodMillimes: number | null;
  },
): boolean => {
  const geographicallyApplicable =
    (rate.localityId === context.localityId && rate.type === 'LOCALITY') ||
    (rate.localityId === null &&
      rate.delegationId === context.delegationId &&
      rate.type === 'DELEGATION') ||
    (rate.localityId === null &&
      rate.delegationId === null &&
      rate.governorateId === context.governorateId &&
      rate.type === 'GOVERNORATE') ||
    (rate.localityId === null &&
      rate.delegationId === null &&
      rate.governorateId === null &&
      rate.deliveryZoneId === context.deliveryZoneId &&
      rate.type === 'BASE') ||
    (rate.localityId === null &&
      rate.delegationId === null &&
      rate.governorateId === null &&
      rate.deliveryZoneId === null &&
      rate.type === 'BASE');
  if (!geographicallyApplicable || rate.feeMillimes < 0) return false;

  const minimumOrder = Math.max(context.zoneMinOrderMillimes ?? 0, rate.minOrderMillimes ?? 0);
  const maximumOrder = Math.min(
    context.zoneMaxCodMillimes ?? Number.MAX_SAFE_INTEGER,
    rate.maxOrderMillimes ?? Number.MAX_SAFE_INTEGER,
    rate.maxCodMillimes ?? Number.MAX_SAFE_INTEGER,
  );
  const minimumWeight = rate.minWeightGrams ?? 0;
  const maximumWeight = rate.maxWeightGrams ?? Number.MAX_SAFE_INTEGER;
  return minimumOrder <= maximumOrder && minimumWeight <= maximumWeight;
};

const localize = (locale: StorefrontLocale, french: string, arabic: string): string =>
  locale === 'ar' ? arabic : french;

const formatDatabaseTime = (value: Date): string =>
  [value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds()]
    .map((part) => part.toString().padStart(2, '0'))
    .join(':');
