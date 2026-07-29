import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DeliveryAssignmentMode,
  DeliveryCommunicationChannel,
  DeliveryPaymentMethod,
  DeliveryRateType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  databaseTime,
  deliveryConfigurationToken,
  formatDatabaseTime,
  type RateScope,
} from './delivery-config-policy';
import type {
  CreateDeliveryRateDto,
  CreateDeliveryWindowDto,
  CreateDeliveryZoneDto,
  CreatePickupLocationDto,
  DeliveryConfigListQueryDto,
  LinkZoneGeographyDto,
  UpdateDeliveryRateDto,
  UpdateDeliveryWindowDto,
  UpdateDeliveryZoneDto,
  UpdatePickupLocationDto,
} from './dto/delivery-config.dto';

export interface DeliveryConfigMutationContext {
  userId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

type Transaction = Prisma.TransactionClient;
const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
const MAX_RESOLVED_LOCALITIES = 1_000;
const MAX_MONEY_MILLIMES = 1_000_000;
const MAX_ESTIMATE_DAYS = 365;
const MAX_ESTIMATE_MINUTES = 10_080;
const BIZERTE_EXPRESS_CODE = 'BIZERTE_EXPRESS';
// Governorate codes remain the repository's stable ISO-style codes; INS 2024 code 17 maps to 23.
const BIZERTE_GOVERNORATE_CODE = '23';
const BASE_RATE_TYPES: readonly DeliveryRateType[] = [
  DeliveryRateType.BASE,
  DeliveryRateType.GOVERNORATE,
  DeliveryRateType.DELEGATION,
  DeliveryRateType.LOCALITY,
];

const audit = (context: DeliveryConfigMutationContext) => ({
  actorUserId: context.userId,
  actorType: 'ADMIN' as const,
  outcome: 'SUCCESS' as const,
  requestId: context.requestId,
  ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
  ...(context.userAgent ? { userAgent: context.userAgent } : {}),
});

const page = <T>(items: T[], query: DeliveryConfigListQueryDto, total: number) => ({
  data: {
    items,
    page: query.page,
    pageSize: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit),
  },
});

const currentRateWhere = (now: Date): Prisma.DeliveryRateWhereInput => ({
  active: true,
  feeMillimes: { gte: 0 },
  AND: [
    { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
    { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
  ],
});

const ZONE_SELECT = {
  id: true,
  code: true,
  nameFr: true,
  nameAr: true,
  priority: true,
  active: true,
  supported: true,
  temporarilySuspended: true,
  phoneConfirmationRequired: true,
  manualReviewRequired: true,
  minOrderMillimes: true,
  maxCodMillimes: true,
  freeDeliveryThresholdMillimes: true,
  estimatedMinDays: true,
  estimatedMaxDays: true,
  estimatedMinMinutes: true,
  estimatedMaxMinutes: true,
  paymentMethod: true,
  assignmentMode: true,
  driverCommunication: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      localities: { where: { active: true } },
      rates: { where: { active: true } },
    },
  },
} as const satisfies Prisma.DeliveryZoneSelect;
type ZoneRecord = Prisma.DeliveryZoneGetPayload<{ select: typeof ZONE_SELECT }>;

@Injectable()
export class DeliveryZonesConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: DeliveryConfigListQueryDto) {
    const search = query.q?.trim();
    const where: Prisma.DeliveryZoneWhereInput = {
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(search
        ? {
            OR: [
              { code: { contains: search } },
              { nameFr: { contains: search } },
              { nameAr: { contains: search } },
            ],
          }
        : {}),
    };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.deliveryZone.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { code: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: ZONE_SELECT,
      }),
      this.prisma.deliveryZone.count({ where }),
    ]);
    return page(records.map(zoneResponse), query, total);
  }

  async get(id: string) {
    const record = await this.prisma.deliveryZone.findUnique({
      where: { id },
      select: ZONE_SELECT,
    });
    if (!record) throw notFound('DELIVERY_ZONE');
    return { data: zoneResponse(record) };
  }

  async create(input: CreateDeliveryZoneDto, context: DeliveryConfigMutationContext) {
    validateZoneBounds(input);
    try {
      const record = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.deliveryZone.create({
          data: {
            code: input.code,
            nameFr: input.nameFr.trim(),
            nameAr: input.nameAr.trim(),
            priority: input.priority ?? 0,
            active: false,
            supported: false,
            minOrderMillimes: input.minOrderMillimes ?? null,
            maxCodMillimes: input.maxCodMillimes ?? null,
            freeDeliveryThresholdMillimes: input.freeDeliveryThresholdMillimes ?? null,
            estimatedMinDays: input.estimatedMinDays ?? null,
            estimatedMaxDays: input.estimatedMaxDays ?? null,
            estimatedMinMinutes: input.estimatedMinMinutes ?? null,
            estimatedMaxMinutes: input.estimatedMaxMinutes ?? null,
            paymentMethod: input.paymentMethod ?? null,
            assignmentMode: input.assignmentMode ?? null,
            driverCommunication: input.driverCommunication ?? null,
            phoneConfirmationRequired: input.phoneConfirmationRequired ?? false,
            manualReviewRequired: input.manualReviewRequired ?? false,
          },
          select: { id: true },
        });
        await transaction.auditLog.create({
          data: {
            ...audit(context),
            action: 'delivery.zone.create',
            resourceType: 'DeliveryZone',
            resourceId: created.id,
            afterSummary: { code: input.code, active: false, supported: false },
          },
        });
        return requireZone(transaction, created.id);
      });
      return { data: zoneResponse(record) };
    } catch (error) {
      rethrowUnique(error, 'DELIVERY_ZONE_CODE_CONFLICT');
    }
  }

  async update(id: string, input: UpdateDeliveryZoneDto, context: DeliveryConfigMutationContext) {
    return this.prisma
      .$transaction(async (transaction) => {
        const current = await requireZone(transaction, id);
        assertTimestamp(current.updatedAt, input.expectedUpdatedAt, 'DELIVERY_ZONE');
        validateZoneBounds({ ...current, ...input });
        const updated = await transaction.deliveryZone.updateMany({
          where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
          data: {
            ...(input.code === undefined ? {} : { code: input.code }),
            ...(input.nameFr === undefined ? {} : { nameFr: input.nameFr.trim() }),
            ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr.trim() }),
            ...(input.priority === undefined ? {} : { priority: input.priority }),
            ...(input.minOrderMillimes === undefined
              ? {}
              : { minOrderMillimes: input.minOrderMillimes }),
            ...(input.maxCodMillimes === undefined ? {} : { maxCodMillimes: input.maxCodMillimes }),
            ...(input.freeDeliveryThresholdMillimes === undefined
              ? {}
              : { freeDeliveryThresholdMillimes: input.freeDeliveryThresholdMillimes }),
            ...(input.estimatedMinDays === undefined
              ? {}
              : { estimatedMinDays: input.estimatedMinDays }),
            ...(input.estimatedMaxDays === undefined
              ? {}
              : { estimatedMaxDays: input.estimatedMaxDays }),
            ...(input.estimatedMinMinutes === undefined
              ? {}
              : { estimatedMinMinutes: input.estimatedMinMinutes }),
            ...(input.estimatedMaxMinutes === undefined
              ? {}
              : { estimatedMaxMinutes: input.estimatedMaxMinutes }),
            ...(input.paymentMethod === undefined ? {} : { paymentMethod: input.paymentMethod }),
            ...(input.assignmentMode === undefined ? {} : { assignmentMode: input.assignmentMode }),
            ...(input.driverCommunication === undefined
              ? {}
              : { driverCommunication: input.driverCommunication }),
            ...(input.phoneConfirmationRequired === undefined
              ? {}
              : { phoneConfirmationRequired: input.phoneConfirmationRequired }),
            ...(input.manualReviewRequired === undefined
              ? {}
              : { manualReviewRequired: input.manualReviewRequired }),
          },
        });
        if (updated.count !== 1) throw versionConflict('DELIVERY_ZONE');
        const changed = await requireZone(transaction, id);
        await assertZoneFeeConfiguration(transaction, changed);
        if (changed.active && changed.code === BIZERTE_EXPRESS_CODE) {
          await assertBizerteExpressReady(transaction, changed);
        }
        await writeAudit(
          transaction,
          context,
          'delivery.zone.update',
          'DeliveryZone',
          id,
          zoneAudit(current),
          zoneAudit(changed),
        );
        return { data: zoneResponse(changed) };
      }, SERIALIZABLE)
      .catch((error: unknown) => rethrowUnique(error, 'DELIVERY_ZONE_CODE_CONFLICT'));
  }

  async setActive(
    id: string,
    expectedUpdatedAt: string,
    active: boolean,
    context: DeliveryConfigMutationContext,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const current = await requireZone(transaction, id);
      assertTimestamp(current.updatedAt, expectedUpdatedAt, 'DELIVERY_ZONE');
      if (active) {
        validateZoneBounds(current);
        await assertZoneFeeConfiguration(transaction, current);
        if (current.code === BIZERTE_EXPRESS_CODE) {
          await assertBizerteExpressReady(transaction, current);
        }
        const [links, rates] = await Promise.all([
          transaction.deliveryZoneLocality.count({
            where: {
              deliveryZoneId: id,
              active: true,
              locality: {
                is: {
                  active: true,
                  delegation: { is: { active: true, governorate: { is: { active: true } } } },
                },
              },
            },
          }),
          transaction.deliveryRate.count({
            where: {
              ...currentRateWhere(new Date()),
              deliveryZoneId: id,
              type: 'BASE',
              governorateId: null,
              delegationId: null,
              localityId: null,
            },
          }),
        ]);
        if (links === 0)
          throw conflict(
            'DELIVERY_ZONE_GEOGRAPHY_MISSING',
            'Link at least one active locality before activation.',
          );
        if (rates === 0)
          throw conflict(
            'DELIVERY_ZONE_RATE_MISSING',
            'Configure a current active base rate before activation.',
          );
      }
      const result = await transaction.deliveryZone.updateMany({
        where: { id, updatedAt: new Date(expectedUpdatedAt) },
        data: { active, supported: active, temporarilySuspended: false },
      });
      if (result.count !== 1) throw versionConflict('DELIVERY_ZONE');
      const changed = await requireZone(transaction, id);
      await writeAudit(
        transaction,
        context,
        active ? 'delivery.zone.activate' : 'delivery.zone.deactivate',
        'DeliveryZone',
        id,
        zoneAudit(current),
        zoneAudit(changed),
      );
      return { data: zoneResponse(changed) };
    }, SERIALIZABLE);
  }

  async linkGeography(
    id: string,
    input: LinkZoneGeographyDto,
    context: DeliveryConfigMutationContext,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const current = await requireZone(transaction, id);
      assertTimestamp(current.updatedAt, input.expectedUpdatedAt, 'DELIVERY_ZONE');
      if (current.code === BIZERTE_EXPRESS_CODE && input.active && input.scope === 'GOVERNORATE') {
        throw conflict(
          'BIZERTE_EXPRESS_EXPLICIT_COVERAGE_REQUIRED',
          'Bizerte Express coverage must be selected by delegation or locality.',
        );
      }
      const localityIds = await resolveLocalityIds(transaction, input.scope, input.geographyId);
      if (localityIds.length === 0)
        throw conflict(
          'DELIVERY_GEOGRAPHY_EMPTY',
          'The selected geography has no active localities.',
        );
      if (localityIds.length > MAX_RESOLVED_LOCALITIES)
        throw conflict(
          'DELIVERY_GEOGRAPHY_TOO_LARGE',
          'The selected geography exceeds the bounded link limit.',
        );
      if (current.code === BIZERTE_EXPRESS_CODE && input.active) {
        const bizerteLocalityCount = await transaction.locality.count({
          where: {
            id: { in: localityIds },
            delegation: { is: { governorate: { is: { code: BIZERTE_GOVERNORATE_CODE } } } },
          },
        });
        if (bizerteLocalityCount !== localityIds.length) {
          throw conflict(
            'BIZERTE_EXPRESS_COVERAGE_INVALID',
            'Bizerte Express can cover only explicitly selected Bizerte localities.',
          );
        }
      }
      const now = new Date();
      const touched = await transaction.deliveryZone.updateMany({
        where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
        data: { updatedAt: now },
      });
      if (touched.count !== 1) throw versionConflict('DELIVERY_ZONE');
      for (const localityId of localityIds) {
        await transaction.deliveryZoneLocality.upsert({
          where: { deliveryZoneId_localityId: { deliveryZoneId: id, localityId } },
          create: {
            deliveryZoneId: id,
            localityId,
            active: input.active,
            priorityOverride: input.priorityOverride ?? null,
          },
          update: { active: input.active, priorityOverride: input.priorityOverride ?? null },
        });
      }
      if (current.active) await assertZoneHasSupportedLocality(transaction, id);
      const changed = await requireZone(transaction, id);
      if (changed.active && changed.code === BIZERTE_EXPRESS_CODE) {
        await assertBizerteExpressReady(transaction, changed);
      }
      await transaction.auditLog.create({
        data: {
          ...audit(context),
          action: 'delivery.zone.geography_link',
          resourceType: 'DeliveryZone',
          resourceId: id,
          beforeSummary: { updatedAt: current.updatedAt.toISOString() },
          afterSummary: {
            scope: input.scope,
            localityCount: localityIds.length,
            active: input.active,
            updatedAt: changed.updatedAt.toISOString(),
          },
        },
      });
      return { data: zoneResponse(changed) };
    }, SERIALIZABLE);
  }
}

const RATE_SELECT = {
  id: true,
  type: true,
  name: true,
  deliveryZoneId: true,
  governorateId: true,
  delegationId: true,
  localityId: true,
  priority: true,
  feeMillimes: true,
  minWeightGrams: true,
  maxWeightGrams: true,
  minOrderMillimes: true,
  maxOrderMillimes: true,
  maxCodMillimes: true,
  express: true,
  active: true,
  validFrom: true,
  validUntil: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.DeliveryRateSelect;
type RateRecord = Prisma.DeliveryRateGetPayload<{ select: typeof RATE_SELECT }>;

@Injectable()
export class DeliveryRatesConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: DeliveryConfigListQueryDto) {
    const search = query.q?.trim();
    const where: Prisma.DeliveryRateWhereInput = {
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(search ? { name: { contains: search } } : {}),
    };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.deliveryRate.findMany({
        where,
        orderBy: [{ type: 'asc' }, { priority: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: RATE_SELECT,
      }),
      this.prisma.deliveryRate.count({ where }),
    ]);
    return page(records.map(rateResponse), query, total);
  }

  async get(id: string) {
    const record = await this.prisma.deliveryRate.findUnique({
      where: { id },
      select: RATE_SELECT,
    });
    if (!record) throw notFound('DELIVERY_RATE');
    return { data: rateResponse(record) };
  }

  async create(input: CreateDeliveryRateDto, context: DeliveryConfigMutationContext) {
    return this.prisma.$transaction(async (transaction) => {
      const candidate = rateInput(input, false, 1);
      await validateRate(transaction, candidate);
      const created = await transaction.deliveryRate.create({
        data: candidate,
        select: { id: true },
      });
      await transaction.auditLog.create({
        data: {
          ...audit(context),
          action: 'delivery.rate.create',
          resourceType: 'DeliveryRate',
          resourceId: created.id,
          afterSummary: { type: input.type, feeMillimes: input.feeMillimes, active: false },
        },
      });
      return { data: rateResponse(await requireRate(transaction, created.id)) };
    }, SERIALIZABLE);
  }

  async update(id: string, input: UpdateDeliveryRateDto, context: DeliveryConfigMutationContext) {
    return this.prisma.$transaction(async (transaction) => {
      const current = await requireRate(transaction, id);
      if (current.version !== input.expectedVersion) throw versionConflict('DELIVERY_RATE');
      const candidate = rateInput({ ...current, ...input }, current.active, current.version + 1);
      await validateRate(transaction, candidate);
      if (candidate.active) await assertNoAmbiguousRate(transaction, candidate, id);
      const result = await transaction.deliveryRate.updateMany({
        where: { id, version: input.expectedVersion },
        data: { ...candidate, version: { increment: 1 } },
      });
      if (result.count !== 1) throw versionConflict('DELIVERY_RATE');
      const changed = await requireRate(transaction, id);
      await assertAffectedActiveZonesHaveCurrentBase(transaction, current, changed);
      await writeAudit(
        transaction,
        context,
        'delivery.rate.update',
        'DeliveryRate',
        id,
        rateAudit(current),
        rateAudit(changed),
      );
      return { data: rateResponse(changed) };
    }, SERIALIZABLE);
  }

  async setActive(
    id: string,
    expectedVersion: number,
    active: boolean,
    context: DeliveryConfigMutationContext,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const current = await requireRate(transaction, id);
      if (current.version !== expectedVersion) throw versionConflict('DELIVERY_RATE');
      await validateRate(transaction, current);
      if (active) await assertNoAmbiguousRate(transaction, current, id);
      const result = await transaction.deliveryRate.updateMany({
        where: { id, version: expectedVersion },
        data: { active, version: { increment: 1 } },
      });
      if (result.count !== 1) throw versionConflict('DELIVERY_RATE');
      const changed = await requireRate(transaction, id);
      await assertAffectedActiveZonesHaveCurrentBase(transaction, current, changed);
      await writeAudit(
        transaction,
        context,
        active ? 'delivery.rate.activate' : 'delivery.rate.deactivate',
        'DeliveryRate',
        id,
        rateAudit(current),
        rateAudit(changed),
      );
      return { data: rateResponse(changed) };
    }, SERIALIZABLE);
  }
}

const PICKUP_SELECT = {
  id: true,
  inventoryLocationId: true,
  code: true,
  nameFr: true,
  nameAr: true,
  address: true,
  phoneE164: true,
  active: true,
  minOrderMillimes: true,
  maxCodMillimes: true,
  openingHours: true,
} as const satisfies Prisma.PickupLocationSelect;
type PickupRecord = Prisma.PickupLocationGetPayload<{ select: typeof PICKUP_SELECT }>;

@Injectable()
export class PickupLocationsConfigService {
  constructor(private readonly prisma: PrismaService) {}
  async list(query: DeliveryConfigListQueryDto) {
    const search = query.q?.trim();
    const where: Prisma.PickupLocationWhereInput = {
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(search
        ? {
            OR: [
              { code: { contains: search } },
              { nameFr: { contains: search } },
              { nameAr: { contains: search } },
            ],
          }
        : {}),
    };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.pickupLocation.findMany({
        where,
        orderBy: [{ nameFr: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: PICKUP_SELECT,
      }),
      this.prisma.pickupLocation.count({ where }),
    ]);
    return page(records.map(pickupResponse), query, total);
  }
  async get(id: string) {
    const record = await this.prisma.pickupLocation.findUnique({
      where: { id },
      select: PICKUP_SELECT,
    });
    if (!record) throw notFound('PICKUP_LOCATION');
    return { data: pickupResponse(record) };
  }
  async create(input: CreatePickupLocationDto, context: DeliveryConfigMutationContext) {
    return this.prisma
      .$transaction(async (transaction) => {
        await validateInventoryLocation(transaction, input.inventoryLocationId ?? null);
        const created = await transaction.pickupLocation.create({
          data: { ...pickupData(input), active: false },
          select: { id: true },
        });
        await transaction.auditLog.create({
          data: {
            ...audit(context),
            action: 'delivery.pickup.create',
            resourceType: 'PickupLocation',
            resourceId: created.id,
            afterSummary: { code: input.code, active: false },
          },
        });
        return { data: pickupResponse(await requirePickup(transaction, created.id)) };
      }, SERIALIZABLE)
      .catch((error: unknown) => rethrowUnique(error, 'PICKUP_CODE_CONFLICT'));
  }
  async update(id: string, input: UpdatePickupLocationDto, context: DeliveryConfigMutationContext) {
    return this.prisma
      .$transaction(async (transaction) => {
        await lockRow(transaction, 'PickupLocation', id);
        const current = await requirePickup(transaction, id);
        assertToken(pickupToken(current), input.expectedStateToken, 'PICKUP_LOCATION');
        const merged = { ...current, ...input };
        await validateInventoryLocation(transaction, merged.inventoryLocationId ?? null);
        await transaction.pickupLocation.update({ where: { id }, data: pickupData(merged) });
        const changed = await requirePickup(transaction, id);
        await writeAudit(
          transaction,
          context,
          'delivery.pickup.update',
          'PickupLocation',
          id,
          pickupAudit(current),
          pickupAudit(changed),
        );
        return { data: pickupResponse(changed) };
      }, SERIALIZABLE)
      .catch((error: unknown) => rethrowUnique(error, 'PICKUP_CODE_CONFLICT'));
  }
  async setActive(
    id: string,
    token: string,
    active: boolean,
    context: DeliveryConfigMutationContext,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await lockRow(transaction, 'PickupLocation', id);
      const current = await requirePickup(transaction, id);
      assertToken(pickupToken(current), token, 'PICKUP_LOCATION');
      await validateInventoryLocation(transaction, current.inventoryLocationId);
      await transaction.pickupLocation.update({ where: { id }, data: { active } });
      const changed = await requirePickup(transaction, id);
      await writeAudit(
        transaction,
        context,
        active ? 'delivery.pickup.activate' : 'delivery.pickup.deactivate',
        'PickupLocation',
        id,
        pickupAudit(current),
        pickupAudit(changed),
      );
      return { data: pickupResponse(changed) };
    }, SERIALIZABLE);
  }
}

const WINDOW_SELECT = {
  id: true,
  deliveryZoneId: true,
  pickupLocationId: true,
  code: true,
  labelFr: true,
  labelAr: true,
  dayOfWeek: true,
  startsAt: true,
  endsAt: true,
  capacity: true,
  active: true,
} as const satisfies Prisma.DeliveryTimeWindowSelect;
type WindowRecord = Prisma.DeliveryTimeWindowGetPayload<{ select: typeof WINDOW_SELECT }>;

@Injectable()
export class DeliveryWindowsConfigService {
  constructor(private readonly prisma: PrismaService) {}
  async list(query: DeliveryConfigListQueryDto) {
    const search = query.q?.trim();
    const where: Prisma.DeliveryTimeWindowWhereInput = {
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(search
        ? {
            OR: [
              { code: { contains: search } },
              { labelFr: { contains: search } },
              { labelAr: { contains: search } },
            ],
          }
        : {}),
    };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.deliveryTimeWindow.findMany({
        where,
        orderBy: [{ dayOfWeek: 'asc' }, { startsAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: WINDOW_SELECT,
      }),
      this.prisma.deliveryTimeWindow.count({ where }),
    ]);
    return page(records.map(windowResponse), query, total);
  }
  async get(id: string) {
    const record = await this.prisma.deliveryTimeWindow.findUnique({
      where: { id },
      select: WINDOW_SELECT,
    });
    if (!record) throw notFound('DELIVERY_WINDOW');
    return { data: windowResponse(record) };
  }
  async create(input: CreateDeliveryWindowDto, context: DeliveryConfigMutationContext) {
    return this.prisma
      .$transaction(async (transaction) => {
        await validateWindowOwner(
          transaction,
          input.deliveryZoneId ?? null,
          input.pickupLocationId ?? null,
          false,
        );
        validateWindowTimes(input.startsAt, input.endsAt);
        const created = await transaction.deliveryTimeWindow.create({
          data: { ...windowData(input), active: false },
          select: { id: true },
        });
        await transaction.auditLog.create({
          data: {
            ...audit(context),
            action: 'delivery.window.create',
            resourceType: 'DeliveryTimeWindow',
            resourceId: created.id,
            afterSummary: { code: input.code, active: false },
          },
        });
        return { data: windowResponse(await requireWindow(transaction, created.id)) };
      }, SERIALIZABLE)
      .catch((error: unknown) => rethrowUnique(error, 'DELIVERY_WINDOW_CODE_CONFLICT'));
  }
  async update(id: string, input: UpdateDeliveryWindowDto, context: DeliveryConfigMutationContext) {
    return this.prisma
      .$transaction(async (transaction) => {
        await lockRow(transaction, 'DeliveryTimeWindow', id);
        const current = await requireWindow(transaction, id);
        assertToken(windowToken(current), input.expectedStateToken, 'DELIVERY_WINDOW');
        const merged = { ...windowInput(current), ...input };
        await validateWindowOwner(
          transaction,
          merged.deliveryZoneId ?? null,
          merged.pickupLocationId ?? null,
          current.active,
        );
        validateWindowTimes(merged.startsAt, merged.endsAt);
        await transaction.deliveryTimeWindow.update({ where: { id }, data: windowData(merged) });
        const changed = await requireWindow(transaction, id);
        await writeAudit(
          transaction,
          context,
          'delivery.window.update',
          'DeliveryTimeWindow',
          id,
          windowAudit(current),
          windowAudit(changed),
        );
        return { data: windowResponse(changed) };
      }, SERIALIZABLE)
      .catch((error: unknown) => rethrowUnique(error, 'DELIVERY_WINDOW_CODE_CONFLICT'));
  }
  async setActive(
    id: string,
    token: string,
    active: boolean,
    context: DeliveryConfigMutationContext,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await lockRow(transaction, 'DeliveryTimeWindow', id);
      const current = await requireWindow(transaction, id);
      assertToken(windowToken(current), token, 'DELIVERY_WINDOW');
      await validateWindowOwner(
        transaction,
        current.deliveryZoneId,
        current.pickupLocationId,
        active,
      );
      await transaction.deliveryTimeWindow.update({ where: { id }, data: { active } });
      const changed = await requireWindow(transaction, id);
      await writeAudit(
        transaction,
        context,
        active ? 'delivery.window.activate' : 'delivery.window.deactivate',
        'DeliveryTimeWindow',
        id,
        windowAudit(current),
        windowAudit(changed),
      );
      return { data: windowResponse(changed) };
    }, SERIALIZABLE);
  }
}

async function requireZone(transaction: Transaction, id: string): Promise<ZoneRecord> {
  const record = await transaction.deliveryZone.findUnique({ where: { id }, select: ZONE_SELECT });
  if (!record) throw notFound('DELIVERY_ZONE');
  return record;
}
async function requireRate(transaction: Transaction, id: string): Promise<RateRecord> {
  const record = await transaction.deliveryRate.findUnique({ where: { id }, select: RATE_SELECT });
  if (!record) throw notFound('DELIVERY_RATE');
  return record;
}
async function requirePickup(transaction: Transaction, id: string): Promise<PickupRecord> {
  const record = await transaction.pickupLocation.findUnique({
    where: { id },
    select: PICKUP_SELECT,
  });
  if (!record) throw notFound('PICKUP_LOCATION');
  return record;
}
async function requireWindow(transaction: Transaction, id: string): Promise<WindowRecord> {
  const record = await transaction.deliveryTimeWindow.findUnique({
    where: { id },
    select: WINDOW_SELECT,
  });
  if (!record) throw notFound('DELIVERY_WINDOW');
  return record;
}

async function assertZoneHasSupportedLocality(
  transaction: Transaction,
  deliveryZoneId: string,
): Promise<void> {
  const count = await transaction.deliveryZoneLocality.count({
    where: {
      deliveryZoneId,
      active: true,
      locality: {
        is: {
          active: true,
          delegation: { is: { active: true, governorate: { is: { active: true } } } },
        },
      },
    },
  });
  if (count === 0)
    throw conflict(
      'ACTIVE_DELIVERY_ZONE_GEOGRAPHY_REQUIRED',
      'Deactivate the delivery zone before removing its last supported locality.',
    );
}

async function assertAffectedActiveZonesHaveCurrentBase(
  transaction: Transaction,
  before: RateRecord,
  after: RateRecord,
): Promise<void> {
  const zoneIds = new Set<string>();
  if (before.type === DeliveryRateType.BASE && before.deliveryZoneId)
    zoneIds.add(before.deliveryZoneId);
  if (after.type === DeliveryRateType.BASE && after.deliveryZoneId)
    zoneIds.add(after.deliveryZoneId);
  for (const deliveryZoneId of zoneIds) {
    const zone = await transaction.deliveryZone.findUnique({
      where: { id: deliveryZoneId },
      select: { active: true },
    });
    if (!zone?.active) continue;
    const count = await transaction.deliveryRate.count({
      where: {
        ...currentRateWhere(new Date()),
        deliveryZoneId,
        type: DeliveryRateType.BASE,
        governorateId: null,
        delegationId: null,
        localityId: null,
      },
    });
    if (count === 0)
      throw conflict(
        'ACTIVE_DELIVERY_ZONE_RATE_REQUIRED',
        'Deactivate the delivery zone before removing its last current base rate.',
      );
  }
}

async function resolveLocalityIds(
  transaction: Transaction,
  scope: LinkZoneGeographyDto['scope'],
  id: string,
): Promise<string[]> {
  if (scope === 'LOCALITY') {
    const record = await transaction.locality.findFirst({
      where: {
        id,
        active: true,
        delegation: { is: { active: true, governorate: { is: { active: true } } } },
      },
      select: { id: true },
    });
    return record ? [record.id] : [];
  }
  if (scope === 'DELEGATION') {
    const delegation = await transaction.delegation.findFirst({
      where: { id, active: true, governorate: { is: { active: true } } },
      select: { id: true },
    });
    if (!delegation) return [];
    return (
      await transaction.locality.findMany({
        where: { delegationId: id, active: true },
        orderBy: { id: 'asc' },
        take: MAX_RESOLVED_LOCALITIES + 1,
        select: { id: true },
      })
    ).map(({ id: localityId }) => localityId);
  }
  const governorate = await transaction.governorate.findFirst({
    where: { id, active: true },
    select: { id: true },
  });
  if (!governorate) return [];
  return (
    await transaction.locality.findMany({
      where: { active: true, delegation: { is: { active: true, governorateId: id } } },
      orderBy: { id: 'asc' },
      take: MAX_RESOLVED_LOCALITIES + 1,
      select: { id: true },
    })
  ).map(({ id: localityId }) => localityId);
}

function validateZoneBounds(input: {
  minOrderMillimes?: number | null;
  maxCodMillimes?: number | null;
  freeDeliveryThresholdMillimes?: number | null;
  estimatedMinDays?: number | null;
  estimatedMaxDays?: number | null;
  estimatedMinMinutes?: number | null;
  estimatedMaxMinutes?: number | null;
}): void {
  for (const value of [
    input.minOrderMillimes,
    input.maxCodMillimes,
    input.freeDeliveryThresholdMillimes,
  ])
    if (
      value !== undefined &&
      value !== null &&
      (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY_MILLIMES)
    )
      throw conflict(
        'DELIVERY_ZONE_AMOUNT_INVALID',
        `Zone monetary values must be integer millimes from 0 to ${MAX_MONEY_MILLIMES}.`,
      );
  validateEstimatePair(input.estimatedMinDays, input.estimatedMaxDays, 0, MAX_ESTIMATE_DAYS);
  validateEstimatePair(
    input.estimatedMinMinutes,
    input.estimatedMaxMinutes,
    1,
    MAX_ESTIMATE_MINUTES,
  );
  const hasDayEstimate = input.estimatedMinDays !== undefined && input.estimatedMinDays !== null;
  const hasMinuteEstimate =
    input.estimatedMinMinutes !== undefined && input.estimatedMinMinutes !== null;
  if (hasDayEstimate && hasMinuteEstimate) {
    throw conflict(
      'DELIVERY_ZONE_ESTIMATE_UNIT_INVALID',
      'Choose either a day estimate or a minute estimate, not both.',
    );
  }
}

async function assertZoneFeeConfiguration(
  transaction: Transaction,
  zone: Pick<ZoneRecord, 'id' | 'freeDeliveryThresholdMillimes'>,
): Promise<void> {
  if (zone.freeDeliveryThresholdMillimes === 0) return;
  const activeZeroRateCount = await transaction.deliveryRate.count({
    where: {
      active: true,
      deliveryZoneId: zone.id,
      feeMillimes: 0,
    },
  });
  if (activeZeroRateCount > 0) {
    throw conflict(
      'DELIVERY_RATE_FREE_CONFIGURATION_REQUIRED',
      'A zero delivery fee requires an explicitly free delivery zone.',
    );
  }
}

async function assertBizerteExpressReady(
  transaction: Transaction,
  zone: ZoneRecord,
): Promise<void> {
  if (
    zone.estimatedMinMinutes !== 30 ||
    zone.estimatedMaxMinutes !== 50 ||
    zone.estimatedMinDays !== null ||
    zone.estimatedMaxDays !== null ||
    zone.paymentMethod !== DeliveryPaymentMethod.CASH_ON_DELIVERY ||
    zone.assignmentMode !== DeliveryAssignmentMode.MANUAL ||
    zone.driverCommunication !== DeliveryCommunicationChannel.WHATSAPP
  ) {
    throw conflict(
      'BIZERTE_EXPRESS_CONFIGURATION_INVALID',
      'Bizerte Express requires a 30–50 minute estimate, cash on delivery, manual assignment, and WhatsApp communication.',
    );
  }

  const [activeLocalityCount, outsideBizerteCount] = await Promise.all([
    transaction.deliveryZoneLocality.count({
      where: {
        deliveryZoneId: zone.id,
        active: true,
        locality: {
          is: {
            active: true,
            delegation: { is: { active: true, governorate: { is: { active: true } } } },
          },
        },
      },
    }),
    transaction.deliveryZoneLocality.count({
      where: {
        deliveryZoneId: zone.id,
        active: true,
        locality: {
          is: {
            delegation: {
              is: { governorate: { is: { code: { not: BIZERTE_GOVERNORATE_CODE } } } },
            },
          },
        },
      },
    }),
  ]);
  if (activeLocalityCount === 0) {
    throw conflict(
      'DELIVERY_ZONE_GEOGRAPHY_MISSING',
      'Link at least one active Bizerte locality before activation.',
    );
  }
  if (outsideBizerteCount > 0) {
    throw conflict(
      'BIZERTE_EXPRESS_COVERAGE_INVALID',
      'Bizerte Express can cover only explicitly selected Bizerte localities.',
    );
  }
}

function validateEstimatePair(
  minimum: number | null | undefined,
  maximum: number | null | undefined,
  lowerBound: number,
  upperBound: number,
): void {
  const hasMinimum = minimum !== undefined && minimum !== null;
  const hasMaximum = maximum !== undefined && maximum !== null;
  if (hasMinimum !== hasMaximum) {
    throw conflict(
      'DELIVERY_ZONE_ESTIMATE_INVALID',
      'Delivery estimates require both a minimum and a maximum.',
    );
  }
  if (!hasMinimum || !hasMaximum) return;
  if (
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum < lowerBound ||
    maximum > upperBound ||
    minimum > maximum
  ) {
    throw conflict(
      'DELIVERY_ZONE_ESTIMATE_INVALID',
      'The delivery estimate is outside the supported range.',
    );
  }
}

interface RateConfigInput {
  type: DeliveryRateType;
  name: string;
  deliveryZoneId?: string | null;
  governorateId?: string | null;
  delegationId?: string | null;
  localityId?: string | null;
  priority?: number;
  feeMillimes: number;
  minWeightGrams?: number | null;
  maxWeightGrams?: number | null;
  minOrderMillimes?: number | null;
  maxOrderMillimes?: number | null;
  maxCodMillimes?: number | null;
  express?: boolean;
  validFrom?: string | Date | null;
  validUntil?: string | Date | null;
}

function rateInput(
  input: RateConfigInput,
  active: boolean,
  version: number,
): Omit<RateRecord, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    type: input.type,
    name: input.name.trim(),
    deliveryZoneId: input.deliveryZoneId ?? null,
    governorateId: input.governorateId ?? null,
    delegationId: input.delegationId ?? null,
    localityId: input.localityId ?? null,
    priority: input.priority ?? 0,
    feeMillimes: input.feeMillimes,
    minWeightGrams: input.minWeightGrams ?? null,
    maxWeightGrams: input.maxWeightGrams ?? null,
    minOrderMillimes: input.minOrderMillimes ?? null,
    maxOrderMillimes: input.maxOrderMillimes ?? null,
    maxCodMillimes: input.maxCodMillimes ?? null,
    express: input.express ?? false,
    active,
    validFrom:
      typeof input.validFrom === 'string' ? new Date(input.validFrom) : (input.validFrom ?? null),
    validUntil:
      typeof input.validUntil === 'string'
        ? new Date(input.validUntil)
        : (input.validUntil ?? null),
    version,
  };
}

async function validateRate(
  transaction: Transaction,
  rate: Omit<RateRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<void> {
  if (
    !Number.isSafeInteger(rate.feeMillimes) ||
    rate.feeMillimes < 0 ||
    rate.feeMillimes > MAX_MONEY_MILLIMES
  )
    throw conflict(
      'DELIVERY_RATE_AMOUNT_INVALID',
      `Delivery fees must be integer millimes from 0 to ${MAX_MONEY_MILLIMES}.`,
    );
  if (rate.validFrom && rate.validUntil && rate.validFrom >= rate.validUntil)
    throw conflict('DELIVERY_RATE_DATES_INVALID', 'The rate end must be after its start.');
  for (const [min, max] of [
    [rate.minWeightGrams, rate.maxWeightGrams],
    [rate.minOrderMillimes, rate.maxOrderMillimes],
  ])
    if (min !== null && min !== undefined && max !== null && max !== undefined && min > max)
      throw conflict('DELIVERY_RATE_BOUNDS_INVALID', 'A rate minimum cannot exceed its maximum.');
  const scopeIds = [
    rate.deliveryZoneId,
    rate.governorateId,
    rate.delegationId,
    rate.localityId,
  ].filter(Boolean);
  const isValidScope =
    (rate.type === DeliveryRateType.BASE &&
      scopeIds.length <= 1 &&
      (scopeIds.length === 0 || Boolean(rate.deliveryZoneId))) ||
    (rate.type === DeliveryRateType.GOVERNORATE &&
      scopeIds.length === 1 &&
      Boolean(rate.governorateId)) ||
    (rate.type === DeliveryRateType.DELEGATION &&
      scopeIds.length === 1 &&
      Boolean(rate.delegationId)) ||
    (rate.type === DeliveryRateType.LOCALITY &&
      scopeIds.length === 1 &&
      Boolean(rate.localityId)) ||
    (!BASE_RATE_TYPES.includes(rate.type) && scopeIds.length <= 1);
  if (!isValidScope)
    throw conflict(
      'DELIVERY_RATE_SCOPE_INVALID',
      'The rate scope does not match its specificity type.',
    );
  const deliveryZone = rate.deliveryZoneId
    ? await transaction.deliveryZone.findUnique({
        where: { id: rate.deliveryZoneId },
        select: { id: true, freeDeliveryThresholdMillimes: true },
      })
    : null;
  if (rate.deliveryZoneId && !deliveryZone)
    throw conflict('DELIVERY_ZONE_NOT_FOUND', 'The selected delivery zone is unavailable.');
  if (rate.feeMillimes === 0 && deliveryZone?.freeDeliveryThresholdMillimes !== 0) {
    throw conflict(
      'DELIVERY_RATE_FREE_CONFIGURATION_REQUIRED',
      'A zero delivery fee requires an explicitly free delivery zone.',
    );
  }
  if (
    rate.governorateId &&
    !(await transaction.governorate.findFirst({
      where: { id: rate.governorateId, active: true },
      select: { id: true },
    }))
  )
    throw conflict(
      'DELIVERY_GEOGRAPHY_UNAVAILABLE',
      'The selected geography is inactive or unavailable.',
    );
  if (
    rate.delegationId &&
    !(await transaction.delegation.findFirst({
      where: { id: rate.delegationId, active: true, governorate: { is: { active: true } } },
      select: { id: true },
    }))
  )
    throw conflict(
      'DELIVERY_GEOGRAPHY_UNAVAILABLE',
      'The selected geography is inactive or unavailable.',
    );
  if (
    rate.localityId &&
    !(await transaction.locality.findFirst({
      where: {
        id: rate.localityId,
        active: true,
        delegation: { is: { active: true, governorate: { is: { active: true } } } },
      },
      select: { id: true },
    }))
  )
    throw conflict(
      'DELIVERY_GEOGRAPHY_UNAVAILABLE',
      'The selected geography is inactive or unavailable.',
    );
}

async function assertNoAmbiguousRate(
  transaction: Transaction,
  rate: RateScope,
  excludeId: string,
): Promise<void> {
  const candidate = await transaction.deliveryRate.findFirst({
    where: {
      id: { not: excludeId },
      active: true,
      type: rate.type,
      priority: rate.priority,
      deliveryZoneId: rate.deliveryZoneId,
      governorateId: rate.governorateId,
      delegationId: rate.delegationId,
      localityId: rate.localityId,
      AND: [
        ...(rate.validUntil
          ? [{ OR: [{ validFrom: null }, { validFrom: { lt: rate.validUntil } }] }]
          : []),
        ...(rate.validFrom
          ? [{ OR: [{ validUntil: null }, { validUntil: { gt: rate.validFrom } }] }]
          : []),
      ],
    },
    select: { id: true },
  });
  if (candidate)
    throw conflict(
      'DELIVERY_RATE_AMBIGUOUS',
      'An active equal-priority rate already covers this scope and validity period.',
    );
}

function pickupData(
  input: CreatePickupLocationDto | (PickupRecord & UpdatePickupLocationDto),
): Prisma.PickupLocationUncheckedCreateInput {
  return {
    code: input.code,
    nameFr: input.nameFr.trim(),
    nameAr: input.nameAr.trim(),
    address: input.address.trim(),
    phoneE164: input.phoneE164 ?? null,
    inventoryLocationId: input.inventoryLocationId ?? null,
    minOrderMillimes: input.minOrderMillimes ?? null,
    maxCodMillimes: input.maxCodMillimes ?? null,
  };
}
async function validateInventoryLocation(
  transaction: Transaction,
  id: string | null,
): Promise<void> {
  if (!id) return;
  const record = await transaction.inventoryLocation.findFirst({
    where: { id, active: true },
    select: { id: true },
  });
  if (!record)
    throw conflict(
      'INVENTORY_LOCATION_UNAVAILABLE',
      'The pickup inventory location is inactive or unavailable.',
    );
}
function pickupToken(record: PickupRecord): string {
  return deliveryConfigurationToken({
    inventoryLocationId: record.inventoryLocationId,
    code: record.code,
    nameFr: record.nameFr,
    nameAr: record.nameAr,
    address: record.address,
    phoneE164: record.phoneE164,
    active: record.active,
    minOrderMillimes: record.minOrderMillimes,
    maxCodMillimes: record.maxCodMillimes,
    openingHours: record.openingHours,
  });
}
function pickupResponse(record: PickupRecord) {
  return { ...record, stateToken: pickupToken(record) };
}
function pickupAudit(record: PickupRecord): Prisma.InputJsonObject {
  return { code: record.code, active: record.active, stateToken: pickupToken(record) };
}

function windowInput(record: WindowRecord): CreateDeliveryWindowDto {
  return {
    code: record.code,
    deliveryZoneId: record.deliveryZoneId,
    pickupLocationId: record.pickupLocationId,
    labelFr: record.labelFr,
    labelAr: record.labelAr,
    dayOfWeek: record.dayOfWeek,
    startsAt: formatDatabaseTime(record.startsAt),
    endsAt: formatDatabaseTime(record.endsAt),
    capacity: record.capacity,
  };
}
function windowData(input: CreateDeliveryWindowDto): Prisma.DeliveryTimeWindowUncheckedCreateInput {
  return {
    code: input.code,
    deliveryZoneId: input.deliveryZoneId ?? null,
    pickupLocationId: input.pickupLocationId ?? null,
    labelFr: input.labelFr.trim(),
    labelAr: input.labelAr.trim(),
    dayOfWeek: input.dayOfWeek ?? null,
    startsAt: databaseTime(input.startsAt),
    endsAt: databaseTime(input.endsAt),
    capacity: input.capacity ?? null,
  };
}
async function validateWindowOwner(
  transaction: Transaction,
  zoneId: string | null,
  pickupId: string | null,
  requireActive: boolean,
): Promise<void> {
  if (Boolean(zoneId) === Boolean(pickupId))
    throw conflict(
      'DELIVERY_WINDOW_OWNER_INVALID',
      'Select exactly one delivery zone or pickup location.',
    );
  if (zoneId) {
    const zone = await transaction.deliveryZone.findFirst({
      where: {
        id: zoneId,
        ...(requireActive ? { active: true, supported: true, temporarilySuspended: false } : {}),
      },
      select: { id: true },
    });
    if (!zone)
      throw conflict('DELIVERY_WINDOW_OWNER_UNAVAILABLE', 'The delivery zone is unavailable.');
  }
  if (pickupId) {
    const pickup = await transaction.pickupLocation.findFirst({
      where: { id: pickupId, ...(requireActive ? { active: true } : {}) },
      select: { id: true },
    });
    if (!pickup)
      throw conflict('DELIVERY_WINDOW_OWNER_UNAVAILABLE', 'The pickup location is unavailable.');
  }
}
function validateWindowTimes(startsAt: string, endsAt: string): void {
  if (databaseTime(startsAt).getTime() >= databaseTime(endsAt).getTime())
    throw conflict('DELIVERY_WINDOW_TIME_INVALID', 'The window end must be after its start.');
}
function windowToken(record: WindowRecord): string {
  return deliveryConfigurationToken({ ...windowInput(record), active: record.active });
}
function windowResponse(record: WindowRecord) {
  return {
    ...windowInput(record),
    id: record.id,
    active: record.active,
    stateToken: windowToken(record),
  };
}
function windowAudit(record: WindowRecord): Prisma.InputJsonObject {
  return { code: record.code, active: record.active, stateToken: windowToken(record) };
}

async function lockRow(
  transaction: Transaction,
  table: 'PickupLocation' | 'DeliveryTimeWindow',
  id: string,
): Promise<void> {
  const allowed =
    table === 'PickupLocation' ? Prisma.raw('PickupLocation') : Prisma.raw('DeliveryTimeWindow');
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM ${allowed} WHERE id = ${id} FOR UPDATE`,
  );
  if (rows.length !== 1)
    throw notFound(table === 'PickupLocation' ? 'PICKUP_LOCATION' : 'DELIVERY_WINDOW');
}
function assertToken(actual: string, expected: string, resource: string): void {
  if (actual !== expected) throw versionConflict(resource);
}
function assertTimestamp(actual: Date, expected: string, resource: string): void {
  if (actual.getTime() !== new Date(expected).getTime()) throw versionConflict(resource);
}
function versionConflict(resource: string): ConflictException {
  return conflict(
    `${resource}_VERSION_CONFLICT`,
    'The configuration changed. Refresh and try again.',
  );
}
function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}
function notFound(resource: string): NotFoundException {
  return new NotFoundException({
    code: `${resource}_NOT_FOUND`,
    message: 'The requested delivery configuration was not found.',
  });
}
function rethrowUnique(error: unknown, code: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    throw conflict(code, 'The delivery configuration identifier is already assigned.');
  throw error;
}
async function writeAudit(
  transaction: Transaction,
  context: DeliveryConfigMutationContext,
  action: string,
  resourceType: string,
  resourceId: string,
  beforeSummary: Prisma.InputJsonObject,
  afterSummary: Prisma.InputJsonObject,
): Promise<void> {
  await transaction.auditLog.create({
    data: { ...audit(context), action, resourceType, resourceId, beforeSummary, afterSummary },
  });
}
function zoneAudit(record: ZoneRecord): Prisma.InputJsonObject {
  return {
    code: record.code,
    active: record.active,
    supported: record.supported,
    priority: record.priority,
    estimatedMinDays: record.estimatedMinDays,
    estimatedMaxDays: record.estimatedMaxDays,
    estimatedMinMinutes: record.estimatedMinMinutes,
    estimatedMaxMinutes: record.estimatedMaxMinutes,
    paymentMethod: record.paymentMethod,
    assignmentMode: record.assignmentMode,
    driverCommunication: record.driverCommunication,
    updatedAt: record.updatedAt.toISOString(),
  };
}
function rateAudit(record: RateRecord): Prisma.InputJsonObject {
  return {
    type: record.type,
    feeMillimes: record.feeMillimes,
    priority: record.priority,
    active: record.active,
    version: record.version,
  };
}
function zoneResponse(record: ZoneRecord) {
  return {
    id: record.id,
    code: record.code,
    nameFr: record.nameFr,
    nameAr: record.nameAr,
    priority: record.priority,
    active: record.active,
    supported: record.supported,
    temporarilySuspended: record.temporarilySuspended,
    phoneConfirmationRequired: record.phoneConfirmationRequired,
    manualReviewRequired: record.manualReviewRequired,
    minOrderMillimes: record.minOrderMillimes,
    maxCodMillimes: record.maxCodMillimes,
    freeDeliveryThresholdMillimes: record.freeDeliveryThresholdMillimes,
    estimatedMinDays: record.estimatedMinDays,
    estimatedMaxDays: record.estimatedMaxDays,
    estimatedMinMinutes: record.estimatedMinMinutes,
    estimatedMaxMinutes: record.estimatedMaxMinutes,
    paymentMethod: record.paymentMethod,
    assignmentMode: record.assignmentMode,
    driverCommunication: record.driverCommunication,
    localityCount: record._count.localities,
    activeRateCount: record._count.rates,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
function rateResponse(record: RateRecord) {
  return {
    ...record,
    validFrom: record.validFrom?.toISOString() ?? null,
    validUntil: record.validUntil?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
