import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CashCollectionStatus,
  CashDiscrepancyStatus,
  CashRemittanceStatus,
  DeliveryMethodType,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import { cashDifference, sumMillimes } from './cash-calculations';
import {
  canTransitionCollection,
  canTransitionDiscrepancy,
  canTransitionRemittance,
} from './cash-state-policy';
import type {
  AdminCollectionListQueryDto,
  AdminRemittanceListQueryDto,
  CreateCashRemittanceDto,
  ReconcileCashRemittanceDto,
  RecordCashCollectionDto,
  ResolveCashDiscrepancyDto,
} from './dto/admin-cash.dto';

const COLLECTION_DETAIL_SELECT = {
  id: true,
  orderId: true,
  deliveryId: true,
  courierId: true,
  status: true,
  expectedMillimes: true,
  collectedMillimes: true,
  collectedByUserId: true,
  collectedAt: true,
  method: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  order: {
    select: {
      orderNumber: true,
      status: true,
      paymentStatus: true,
      expectedCodMillimes: true,
      deliveryMethodType: true,
      version: true,
      cashDiscrepancies: {
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          id: true,
          status: true,
          expectedMillimes: true,
          actualMillimes: true,
          differenceMillimes: true,
          reasonCode: true,
          reasonDetail: true,
          openedAt: true,
          resolvedAt: true,
        },
      },
      _count: { select: { cashDiscrepancies: true } },
    },
  },
  delivery: {
    select: {
      id: true,
      orderId: true,
      status: true,
      version: true,
      courier: { select: { id: true, code: true, name: true } },
    },
  },
  remittanceItems: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
    select: {
      id: true,
      amountMillimes: true,
      createdAt: true,
      remittance: {
        select: { id: true, remittanceNumber: true, status: true },
      },
    },
  },
  _count: { select: { remittanceItems: true } },
} as const satisfies Prisma.CashCollectionSelect;

const REMITTANCE_DETAIL_SELECT = {
  id: true,
  remittanceNumber: true,
  courierId: true,
  status: true,
  declaredMillimes: true,
  verifiedMillimes: true,
  differenceMillimes: true,
  submittedAt: true,
  remittedAt: true,
  receivedByUserId: true,
  verifiedByUserId: true,
  verifiedAt: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  courier: { select: { id: true, code: true, name: true } },
  items: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: {
      id: true,
      amountMillimes: true,
      createdAt: true,
      cashCollection: {
        select: {
          id: true,
          status: true,
          expectedMillimes: true,
          collectedMillimes: true,
          order: { select: { id: true, orderNumber: true } },
        },
      },
    },
  },
  discrepancies: {
    orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
    take: 100,
    select: {
      id: true,
      status: true,
      expectedMillimes: true,
      actualMillimes: true,
      differenceMillimes: true,
      reasonCode: true,
      reasonDetail: true,
      openedByUserId: true,
      resolvedByUserId: true,
      openedAt: true,
      resolvedAt: true,
    },
  },
  events: {
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: {
      id: true,
      type: true,
      amountMillimes: true,
      actorUserId: true,
      summary: true,
      metadata: true,
      requestId: true,
      occurredAt: true,
    },
  },
  _count: { select: { items: true, discrepancies: true, events: true } },
} as const satisfies Prisma.CashRemittanceSelect;

const COLLECTION_OPERATION_SELECT = {
  id: true,
  orderId: true,
  deliveryId: true,
  courierId: true,
  status: true,
  expectedMillimes: true,
  collectedMillimes: true,
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      expectedCodMillimes: true,
      deliveryMethodType: true,
      version: true,
    },
  },
  delivery: {
    select: { id: true, orderId: true, status: true, courierId: true, version: true },
  },
} as const satisfies Prisma.CashCollectionSelect;

const REMITTANCE_OPERATION_SELECT = {
  id: true,
  remittanceNumber: true,
  courierId: true,
  status: true,
  declaredMillimes: true,
  verifiedMillimes: true,
  differenceMillimes: true,
  receivedByUserId: true,
  verifiedByUserId: true,
  items: {
    select: {
      id: true,
      cashCollectionId: true,
      amountMillimes: true,
      cashCollection: {
        select: {
          id: true,
          orderId: true,
          courierId: true,
          status: true,
          expectedMillimes: true,
          collectedMillimes: true,
          order: {
            select: { id: true, paymentStatus: true, version: true },
          },
        },
      },
    },
  },
} as const satisfies Prisma.CashRemittanceSelect;

type CollectionDetail = Prisma.CashCollectionGetPayload<{
  select: typeof COLLECTION_DETAIL_SELECT;
}>;
type CollectionOperation = Prisma.CashCollectionGetPayload<{
  select: typeof COLLECTION_OPERATION_SELECT;
}>;
type RemittanceDetail = Prisma.CashRemittanceGetPayload<{
  select: typeof REMITTANCE_DETAIL_SELECT;
}>;
type RemittanceOperation = Prisma.CashRemittanceGetPayload<{
  select: typeof REMITTANCE_OPERATION_SELECT;
}>;
type Transaction = Prisma.TransactionClient;

interface ExistingAllocationRow {
  cashCollectionId: string;
  amountMillimes: number;
}

const REMITTABLE_COLLECTION_STATUSES = new Set<CashCollectionStatus>([
  CashCollectionStatus.COLLECTED,
  CashCollectionStatus.PARTIALLY_COLLECTED,
]);

const COLLECTABLE_PAYMENT_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.PAYMENT_PENDING,
  PaymentStatus.CASH_EXPECTED,
]);

@Injectable()
export class AdminCashService {
  constructor(private readonly prisma: PrismaService) {}

  async listCollections(query: AdminCollectionListQueryDto) {
    const search = query.q?.trim().replace(/\s+/g, ' ');
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { order: { is: { orderNumber: { contains: search } } } },
              { courier: { is: { name: { contains: search } } } },
            ],
          }
        : {}),
    } satisfies Prisma.CashCollectionWhereInput;
    const [records, total] = await this.prisma.$transaction([
      this.prisma.cashCollection.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          status: true,
          expectedMillimes: true,
          collectedMillimes: true,
          collectedAt: true,
          createdAt: true,
          order: { select: { orderNumber: true, paymentStatus: true } },
          courier: { select: { name: true } },
        },
      }),
      this.prisma.cashCollection.count({ where }),
    ]);
    return {
      data: this.page(
        records.map((record) => ({
          id: record.id,
          orderNumber: record.order.orderNumber,
          courierName: record.courier?.name ?? null,
          status: record.status,
          paymentStatus: record.order.paymentStatus,
          expectedMillimes: record.expectedMillimes,
          collectedMillimes: record.collectedMillimes,
          collectedAt: record.collectedAt?.toISOString() ?? null,
          createdAt: record.createdAt.toISOString(),
        })),
        query,
        total,
      ),
    };
  }

  async getCollection(id: string) {
    const collection = await this.prisma.cashCollection.findUnique({
      where: { id },
      select: COLLECTION_DETAIL_SELECT,
    });
    if (!collection) throw this.collectionNotFound();
    return { data: this.serializeCollection(collection) };
  }

  async recordCollection(id: string, input: RecordCashCollectionDto, request: Request) {
    return this.prisma.$transaction(async (transaction) => {
      const collection = await this.lockCollection(transaction, id);
      if (collection.order.version !== input.expectedOrderVersion) throw this.versionConflict();
      if (!collection.delivery || collection.delivery.version !== input.expectedDeliveryVersion) {
        throw this.versionConflict();
      }
      if (
        collection.deliveryId !== collection.delivery.id ||
        collection.orderId !== collection.order.id ||
        collection.delivery.orderId !== collection.order.id ||
        collection.expectedMillimes !== collection.order.expectedCodMillimes
      ) {
        throw this.stateConflict('COLLECTION_LINKAGE_INVALID');
      }
      if (collection.status !== CashCollectionStatus.EXPECTED) {
        throw this.stateConflict('COLLECTION_ALREADY_RECORDED');
      }
      if (
        collection.order.status !== collection.delivery.status ||
        !COLLECTABLE_PAYMENT_STATUSES.has(collection.order.paymentStatus)
      ) {
        throw this.stateConflict('COLLECTION_ORDER_STATE_INVALID');
      }
      const expectedDeliveryStatus =
        collection.order.deliveryMethodType === DeliveryMethodType.STORE_PICKUP
          ? 'READY_FOR_PICKUP'
          : 'OUT_FOR_DELIVERY';
      if (collection.delivery.status !== expectedDeliveryStatus) {
        throw this.stateConflict('COLLECTION_DELIVERY_STATE_INVALID');
      }
      if (input.collectedMillimes <= 0) {
        throw this.badRequest('COLLECTED_AMOUNT_INVALID', 'Collected cash must be positive.');
      }
      const difference = cashDifference(collection.expectedMillimes, input.collectedMillimes);
      const isPartial = difference < 0;
      if (isPartial) {
        const partialEnabled = await transaction.featureFlag.findFirst({
          where: { key: 'partial_cod_collection', environment: 'ALL', enabled: true },
          select: { id: true },
        });
        if (!partialEnabled) {
          throw this.conflict(
            'PARTIAL_CASH_COLLECTION_DISABLED',
            'Partial cash collection is disabled.',
          );
        }
      }
      if (difference !== 0) this.requireDiscrepancyReason(input.reasonCode, input.reasonDetail);
      const target = isPartial
        ? CashCollectionStatus.PARTIALLY_COLLECTED
        : CashCollectionStatus.COLLECTED;
      if (!canTransitionCollection(collection.status, target)) {
        throw this.stateConflict('COLLECTION_TRANSITION_NOT_ALLOWED');
      }
      if (
        collection.order.deliveryMethodType === DeliveryMethodType.COURIER &&
        (!collection.delivery.courierId ||
          (collection.courierId !== null && collection.courierId !== collection.delivery.courierId))
      ) {
        throw this.stateConflict('COLLECTION_COURIER_REQUIRED');
      }

      const now = new Date();
      const collectionUpdated = await transaction.cashCollection.updateMany({
        where: { id: collection.id, status: CashCollectionStatus.EXPECTED },
        data: {
          status: target,
          collectedMillimes: input.collectedMillimes,
          collectedByUserId: request.auth!.userId,
          collectedAt: now,
          courierId:
            collection.order.deliveryMethodType === DeliveryMethodType.COURIER
              ? collection.delivery.courierId
              : null,
          note: input.reasonDetail?.trim() ?? null,
        },
      });
      const paymentStatus =
        difference !== 0
          ? PaymentStatus.RECONCILIATION_DISCREPANCY
          : collection.order.deliveryMethodType === DeliveryMethodType.STORE_PICKUP
            ? PaymentStatus.CASH_COLLECTED_AT_STORE
            : PaymentStatus.CASH_COLLECTED_BY_COURIER;
      const [orderUpdated, deliveryUpdated] = await Promise.all([
        transaction.order.updateMany({
          where: {
            id: collection.order.id,
            version: input.expectedOrderVersion,
            paymentStatus: collection.order.paymentStatus,
          },
          data: { paymentStatus, version: { increment: 1 } },
        }),
        transaction.delivery.updateMany({
          where: { id: collection.delivery.id, version: input.expectedDeliveryVersion },
          data: { cashCollectedResult: difference === 0, version: { increment: 1 } },
        }),
      ]);
      if (
        collectionUpdated.count !== 1 ||
        orderUpdated.count !== 1 ||
        deliveryUpdated.count !== 1
      ) {
        throw this.versionConflict();
      }

      await transaction.cashReconciliationEvent.create({
        data: {
          type: 'COLLECTION_RECORDED',
          amountMillimes: input.collectedMillimes,
          actorUserId: request.auth!.userId,
          summary: 'Physical cash collection recorded.',
          metadata: {
            cashCollectionId: collection.id,
            orderId: collection.order.id,
            expectedMillimes: collection.expectedMillimes,
            differenceMillimes: difference,
          },
          requestId: request.requestId,
        },
      });
      if (difference !== 0) {
        const discrepancy = await transaction.cashDiscrepancy.create({
          data: {
            orderId: collection.order.id,
            expectedMillimes: collection.expectedMillimes,
            actualMillimes: input.collectedMillimes,
            differenceMillimes: difference,
            reasonCode: input.reasonCode!.trim(),
            reasonDetail: input.reasonDetail!.trim(),
            openedByUserId: request.auth!.userId,
          },
        });
        await transaction.cashReconciliationEvent.create({
          data: {
            type: 'DISCREPANCY_OPENED',
            amountMillimes: difference,
            actorUserId: request.auth!.userId,
            summary: 'A collection discrepancy was opened.',
            metadata: { discrepancyId: discrepancy.id, cashCollectionId: collection.id },
            requestId: request.requestId,
          },
        });
      }
      await this.audit(transaction, request, {
        action: 'cash.collection.recorded',
        resourceType: 'CashCollection',
        resourceId: collection.id,
        before: {
          status: collection.status,
          collectedMillimes: collection.collectedMillimes,
        },
        after: { status: target, collectedMillimes: input.collectedMillimes, difference },
      });
      return {
        data: this.serializeCollection(await this.requireCollectionDetail(transaction, id)),
      };
    });
  }

  async listRemittances(query: AdminRemittanceListQueryDto) {
    const search = query.q?.trim().replace(/\s+/g, ' ');
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { remittanceNumber: { contains: search } },
              { courier: { is: { name: { contains: search } } } },
            ],
          }
        : {}),
    } satisfies Prisma.CashRemittanceWhereInput;
    const [records, total] = await this.prisma.$transaction([
      this.prisma.cashRemittance.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          remittanceNumber: true,
          status: true,
          declaredMillimes: true,
          verifiedMillimes: true,
          differenceMillimes: true,
          createdAt: true,
          courier: { select: { name: true } },
        },
      }),
      this.prisma.cashRemittance.count({ where }),
    ]);
    return {
      data: this.page(
        records.map((record) => ({
          id: record.id,
          remittanceNumber: record.remittanceNumber,
          status: record.status,
          declaredMillimes: record.declaredMillimes,
          verifiedMillimes: record.verifiedMillimes,
          differenceMillimes: record.differenceMillimes,
          courierName: record.courier.name,
          createdAt: record.createdAt.toISOString(),
        })),
        query,
        total,
      ),
    };
  }

  async getRemittance(id: string) {
    const remittance = await this.prisma.cashRemittance.findUnique({
      where: { id },
      select: REMITTANCE_DETAIL_SELECT,
    });
    if (!remittance) throw this.remittanceNotFound();
    return { data: this.serializeRemittance(remittance) };
  }

  async createRemittance(input: CreateCashRemittanceDto, request: Request) {
    const allocationIds = input.allocations.map(({ cashCollectionId }) => cashCollectionId);
    if (new Set(allocationIds).size !== allocationIds.length) {
      throw this.badRequest(
        'DUPLICATE_COLLECTION_ALLOCATION',
        'A collection can appear only once in a remittance.',
      );
    }
    if (input.allocations.some(({ amountMillimes }) => amountMillimes <= 0)) {
      throw this.badRequest(
        'REMITTANCE_ALLOCATION_INVALID',
        'Every remittance allocation must be positive.',
      );
    }
    if (
      sumMillimes(input.allocations.map(({ amountMillimes }) => amountMillimes)) !==
      input.declaredMillimes
    ) {
      throw this.badRequest(
        'REMITTANCE_TOTAL_MISMATCH',
        'Declared cash must equal the allocation total.',
      );
    }
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const references = await transaction.cashCollection.findMany({
          where: { id: { in: allocationIds } },
          select: { id: true, orderId: true },
        });
        if (references.length !== allocationIds.length) throw this.collectionNotFound();
        await this.lockRows(
          transaction,
          'Order',
          references.map(({ orderId }) => orderId),
        );
        await transaction.$queryRaw(
          Prisma.sql`SELECT id FROM Courier WHERE id = ${input.courierId} FOR UPDATE`,
        );
        await this.lockRows(transaction, 'CashCollection', allocationIds);
        const existingAllocations = await transaction.$queryRaw<ExistingAllocationRow[]>(Prisma.sql`
          SELECT cashCollectionId, amountMillimes
          FROM CashRemittanceItem
          WHERE cashCollectionId IN (${Prisma.join([...allocationIds].sort())})
          ORDER BY cashCollectionId ASC, id ASC
          FOR UPDATE
        `);
        const [courier, collections] = await Promise.all([
          transaction.courier.findFirst({
            where: { id: input.courierId, status: 'ACTIVE' },
            select: { id: true },
          }),
          transaction.cashCollection.findMany({
            where: { id: { in: allocationIds } },
            orderBy: { id: 'asc' },
            select: {
              id: true,
              courierId: true,
              status: true,
              collectedMillimes: true,
            },
          }),
        ]);
        if (!courier) {
          throw this.conflict('COURIER_UNAVAILABLE', 'The remittance courier is unavailable.');
        }
        const requested = new Map(
          input.allocations.map((allocation) => [
            allocation.cashCollectionId,
            allocation.amountMillimes,
          ]),
        );
        const alreadyAllocated = new Map<string, number>();
        for (const allocation of existingAllocations) {
          alreadyAllocated.set(
            allocation.cashCollectionId,
            (alreadyAllocated.get(allocation.cashCollectionId) ?? 0) + allocation.amountMillimes,
          );
        }
        for (const collection of collections) {
          const amount = requested.get(collection.id)!;
          if (
            collection.courierId !== courier.id ||
            !REMITTABLE_COLLECTION_STATUSES.has(collection.status)
          ) {
            throw this.stateConflict('COLLECTION_NOT_REMITTABLE');
          }
          if ((alreadyAllocated.get(collection.id) ?? 0) + amount > collection.collectedMillimes) {
            throw this.conflict(
              'COLLECTION_OVER_ALLOCATED',
              'A collection cannot be allocated more than its recorded cash.',
            );
          }
        }
        const remittance = await transaction.cashRemittance.create({
          data: {
            remittanceNumber: input.remittanceNumber.trim(),
            courierId: courier.id,
            status: 'DRAFT',
            declaredMillimes: input.declaredMillimes,
            note: input.note?.trim() ?? null,
            items: {
              create: input.allocations.map((allocation) => ({
                cashCollectionId: allocation.cashCollectionId,
                amountMillimes: allocation.amountMillimes,
              })),
            },
          },
          select: { id: true },
        });
        await this.audit(transaction, request, {
          action: 'cash.remittance.created',
          resourceType: 'CashRemittance',
          resourceId: remittance.id,
          before: null,
          after: {
            status: CashRemittanceStatus.DRAFT,
            courierId: courier.id,
            declaredMillimes: input.declaredMillimes,
            allocationCount: input.allocations.length,
          },
        });
        return {
          data: this.serializeRemittance(
            await this.requireRemittanceDetail(transaction, remittance.id),
          ),
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.conflict(
          'REMITTANCE_CONFLICT',
          'The remittance number or collection allocation conflicts with an existing record.',
        );
      }
      throw error;
    }
  }

  async submitRemittance(id: string, _input: unknown, request: Request) {
    return this.prisma.$transaction(async (transaction) => {
      const remittance = await this.lockRemittance(transaction, id);
      if (!canTransitionRemittance(remittance.status, CashRemittanceStatus.SUBMITTED)) {
        throw this.stateConflict('REMITTANCE_SUBMISSION_NOT_ALLOWED');
      }
      if (
        sumMillimes(remittance.items.map(({ amountMillimes }) => amountMillimes)) !==
        remittance.declaredMillimes
      ) {
        throw this.stateConflict('REMITTANCE_TOTAL_INVALID');
      }
      const now = new Date();
      const updated = await transaction.cashRemittance.updateMany({
        where: { id, status: CashRemittanceStatus.DRAFT },
        data: {
          status: 'SUBMITTED',
          submittedAt: now,
          remittedAt: now,
          receivedByUserId: request.auth!.userId,
        },
      });
      if (updated.count !== 1) throw this.stateConflict('REMITTANCE_SUBMISSION_NOT_ALLOWED');
      await Promise.all([
        transaction.cashReconciliationEvent.create({
          data: {
            remittanceId: remittance.id,
            type: 'REMITTANCE_SUBMITTED',
            amountMillimes: remittance.declaredMillimes,
            actorUserId: request.auth!.userId,
            summary: 'Courier remittance submitted for independent verification.',
            requestId: request.requestId,
          },
        }),
        this.audit(transaction, request, {
          action: 'cash.remittance.submitted',
          resourceType: 'CashRemittance',
          resourceId: remittance.id,
          before: { status: remittance.status },
          after: { status: CashRemittanceStatus.SUBMITTED },
        }),
      ]);
      return {
        data: this.serializeRemittance(await this.requireRemittanceDetail(transaction, id)),
      };
    });
  }

  async reconcileRemittance(id: string, input: ReconcileCashRemittanceDto, request: Request) {
    return this.prisma.$transaction(async (transaction) => {
      const remittance = await this.lockRemittanceWithCash(transaction, id);
      if (!canTransitionRemittance(remittance.status, CashRemittanceStatus.VERIFIED)) {
        throw this.stateConflict('REMITTANCE_RECONCILIATION_NOT_ALLOWED');
      }
      this.assertIndependentActor(remittance.receivedByUserId, request.auth!.userId);
      const allocationTotal = sumMillimes(
        remittance.items.map(({ amountMillimes }) => amountMillimes),
      );
      if (allocationTotal !== remittance.declaredMillimes) {
        throw this.stateConflict('REMITTANCE_TOTAL_INVALID');
      }
      if (
        remittance.items.some(
          ({ cashCollection }) =>
            cashCollection.courierId !== remittance.courierId ||
            !REMITTABLE_COLLECTION_STATUSES.has(cashCollection.status),
        )
      ) {
        throw this.stateConflict('REMITTANCE_COLLECTION_STATE_INVALID');
      }
      const difference = cashDifference(remittance.declaredMillimes, input.verifiedMillimes);
      if (difference !== 0) this.requireDiscrepancyReason(input.reasonCode, input.reasonDetail);
      const now = new Date();
      const target =
        difference === 0 ? CashRemittanceStatus.VERIFIED : CashRemittanceStatus.DISCREPANCY;
      if (!canTransitionRemittance(remittance.status, target)) {
        throw this.stateConflict('REMITTANCE_RECONCILIATION_NOT_ALLOWED');
      }
      const updated = await transaction.cashRemittance.updateMany({
        where: { id, status: CashRemittanceStatus.SUBMITTED },
        data: {
          status: target,
          verifiedMillimes: input.verifiedMillimes,
          differenceMillimes: difference,
          verifiedByUserId: request.auth!.userId,
          verifiedAt: now,
        },
      });
      if (updated.count !== 1) throw this.stateConflict('REMITTANCE_RECONCILIATION_NOT_ALLOWED');

      if (difference === 0) {
        await this.applyVerifiedAllocations(transaction, remittance);
        await transaction.cashReconciliationEvent.create({
          data: {
            remittanceId: remittance.id,
            type: 'REMITTANCE_VERIFIED',
            amountMillimes: input.verifiedMillimes,
            actorUserId: request.auth!.userId,
            summary: 'Courier remittance independently verified.',
            requestId: request.requestId,
          },
        });
      } else {
        const discrepancy = await transaction.cashDiscrepancy.create({
          data: {
            remittanceId: remittance.id,
            expectedMillimes: remittance.declaredMillimes,
            actualMillimes: input.verifiedMillimes,
            differenceMillimes: difference,
            reasonCode: input.reasonCode!.trim(),
            reasonDetail: input.reasonDetail!.trim(),
            openedByUserId: request.auth!.userId,
          },
        });
        await transaction.cashReconciliationEvent.create({
          data: {
            remittanceId: remittance.id,
            type: 'DISCREPANCY_OPENED',
            amountMillimes: difference,
            actorUserId: request.auth!.userId,
            summary: 'A remittance discrepancy was opened for independent resolution.',
            metadata: { discrepancyId: discrepancy.id },
            requestId: request.requestId,
          },
        });
        const orderUpdates = await Promise.all(
          this.uniqueOrders(remittance).map((order) =>
            transaction.order.updateMany({
              where: { id: order.id, version: order.version },
              data: {
                paymentStatus: 'RECONCILIATION_DISCREPANCY',
                version: { increment: 1 },
              },
            }),
          ),
        );
        if (orderUpdates.some(({ count }) => count !== 1)) throw this.versionConflict();
      }
      await this.audit(transaction, request, {
        action: 'cash.remittance.reconciled',
        resourceType: 'CashRemittance',
        resourceId: remittance.id,
        before: { status: remittance.status },
        after: { status: target, verifiedMillimes: input.verifiedMillimes, difference },
      });
      return {
        data: this.serializeRemittance(await this.requireRemittanceDetail(transaction, id)),
      };
    });
  }

  async resolveDiscrepancy(id: string, input: ResolveCashDiscrepancyDto, request: Request) {
    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM CashDiscrepancy WHERE id = ${id} FOR UPDATE
      `);
      if (locked.length !== 1) throw this.discrepancyNotFound();
      const discrepancy = await transaction.cashDiscrepancy.findUnique({
        where: { id },
        select: {
          id: true,
          remittanceId: true,
          status: true,
          differenceMillimes: true,
          openedByUserId: true,
        },
      });
      if (!discrepancy) throw this.discrepancyNotFound();
      if (!discrepancy.remittanceId) {
        throw this.stateConflict('COLLECTION_DISCREPANCY_RESOLUTION_UNSUPPORTED');
      }
      if (!canTransitionDiscrepancy(discrepancy.status, input.resolution)) {
        throw this.stateConflict('DISCREPANCY_RESOLUTION_NOT_ALLOWED');
      }
      if (discrepancy.openedByUserId === request.auth!.userId) {
        throw new ForbiddenException({
          code: 'SEPARATE_RECONCILIATION_APPROVER_REQUIRED',
          message: 'A different administrator must resolve the discrepancy.',
        });
      }
      const remittance = await this.lockRemittanceWithCash(transaction, discrepancy.remittanceId);
      if (remittance.status !== CashRemittanceStatus.DISCREPANCY) {
        throw this.stateConflict('REMITTANCE_DISCREPANCY_STATE_INVALID');
      }
      this.assertIndependentActor(remittance.receivedByUserId, request.auth!.userId);
      const now = new Date();
      if (input.resolution === CashDiscrepancyStatus.RESOLVED) {
        if (input.finalVerifiedMillimes !== remittance.declaredMillimes) {
          throw this.badRequest(
            'FINAL_VERIFIED_AMOUNT_INVALID',
            'Resolution requires final verified cash to equal the declared remittance.',
          );
        }
        await this.applyVerifiedAllocations(transaction, remittance);
        const remittanceUpdated = await transaction.cashRemittance.updateMany({
          where: { id: remittance.id, status: 'DISCREPANCY' },
          data: {
            status: 'VERIFIED',
            verifiedMillimes: remittance.declaredMillimes,
            differenceMillimes: 0,
            verifiedByUserId: request.auth!.userId,
            verifiedAt: now,
          },
        });
        if (remittanceUpdated.count !== 1) {
          throw this.stateConflict('DISCREPANCY_RESOLUTION_NOT_ALLOWED');
        }
      } else if (input.finalVerifiedMillimes !== undefined) {
        throw this.badRequest(
          'FINAL_VERIFIED_AMOUNT_NOT_APPLICABLE',
          'A written-off discrepancy does not change the verified amount.',
        );
      }
      const discrepancyUpdated = await transaction.cashDiscrepancy.updateMany({
        where: { id, status: discrepancy.status },
        data: {
          status: input.resolution,
          resolvedByUserId: request.auth!.userId,
          resolvedAt: now,
        },
      });
      if (discrepancyUpdated.count !== 1) {
        throw this.stateConflict('DISCREPANCY_RESOLUTION_NOT_ALLOWED');
      }
      await Promise.all([
        transaction.cashReconciliationEvent.create({
          data: {
            remittanceId: remittance.id,
            type: 'DISCREPANCY_RESOLVED',
            amountMillimes: discrepancy.differenceMillimes,
            actorUserId: request.auth!.userId,
            summary:
              input.resolution === CashDiscrepancyStatus.RESOLVED
                ? 'Remittance discrepancy resolved with exact verified cash.'
                : 'Remittance discrepancy written off; remittance remains unreconciled.',
            metadata: {
              discrepancyId: discrepancy.id,
              resolution: input.resolution,
              resolutionReason: input.reasonDetail.trim(),
            },
            requestId: request.requestId,
          },
        }),
        this.audit(transaction, request, {
          action: 'cash.discrepancy.resolved',
          resourceType: 'CashDiscrepancy',
          resourceId: discrepancy.id,
          before: { status: discrepancy.status },
          after: { status: input.resolution },
        }),
      ]);
      return {
        data: this.serializeRemittance(
          await this.requireRemittanceDetail(transaction, remittance.id),
        ),
      };
    });
  }

  private async lockCollection(transaction: Transaction, id: string): Promise<CollectionOperation> {
    const reference = await transaction.cashCollection.findUnique({
      where: { id },
      select: { orderId: true, deliveryId: true },
    });
    if (!reference?.deliveryId) throw this.collectionNotFound();
    await this.lockRows(transaction, 'Order', [reference.orderId]);
    await this.lockRows(transaction, 'Delivery', [reference.deliveryId]);
    await this.lockRows(transaction, 'CashCollection', [id]);
    const collection = await transaction.cashCollection.findUnique({
      where: { id },
      select: COLLECTION_OPERATION_SELECT,
    });
    if (!collection) throw this.collectionNotFound();
    return collection;
  }

  private async lockRemittance(transaction: Transaction, id: string): Promise<RemittanceOperation> {
    const locked = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM CashRemittance WHERE id = ${id} FOR UPDATE
    `);
    if (locked.length !== 1) throw this.remittanceNotFound();
    const remittance = await transaction.cashRemittance.findUnique({
      where: { id },
      select: REMITTANCE_OPERATION_SELECT,
    });
    if (!remittance) throw this.remittanceNotFound();
    return remittance;
  }

  private async lockRemittanceWithCash(
    transaction: Transaction,
    id: string,
  ): Promise<RemittanceOperation> {
    const remittance = await this.lockRemittance(transaction, id);
    const orderIds = remittance.items.map(({ cashCollection }) => cashCollection.orderId);
    const collectionIds = remittance.items.map(({ cashCollectionId }) => cashCollectionId);
    await this.lockRows(transaction, 'Order', orderIds);
    await this.lockRows(transaction, 'CashCollection', collectionIds);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM CashRemittanceItem
      WHERE remittanceId = ${id}
      ORDER BY cashCollectionId ASC, id ASC
      FOR UPDATE
    `);
    const refreshed = await transaction.cashRemittance.findUnique({
      where: { id },
      select: REMITTANCE_OPERATION_SELECT,
    });
    if (!refreshed) throw this.remittanceNotFound();
    return refreshed;
  }

  private async applyVerifiedAllocations(
    transaction: Transaction,
    remittance: RemittanceOperation,
  ): Promise<void> {
    const collectionIds = remittance.items.map(({ cashCollectionId }) => cashCollectionId);
    const allocations = await transaction.cashRemittanceItem.findMany({
      where: {
        cashCollectionId: { in: collectionIds },
        OR: [{ remittanceId: remittance.id }, { remittance: { is: { status: 'VERIFIED' } } }],
      },
      select: { cashCollectionId: true, amountMillimes: true },
    });
    const allocatedByCollection = new Map<string, number>();
    for (const allocation of allocations) {
      allocatedByCollection.set(
        allocation.cashCollectionId,
        (allocatedByCollection.get(allocation.cashCollectionId) ?? 0) + allocation.amountMillimes,
      );
    }
    const ordersEligibleForRemittance = new Map<
      string,
      RemittanceOperation['items'][number]['cashCollection']['order']
    >();
    for (const item of remittance.items) {
      const collection = item.cashCollection;
      const allocated = allocatedByCollection.get(collection.id) ?? 0;
      if (allocated > collection.collectedMillimes) {
        throw this.stateConflict('COLLECTION_OVER_ALLOCATED');
      }
      if (allocated !== collection.collectedMillimes) continue;
      if (!canTransitionCollection(collection.status, CashCollectionStatus.REMITTED)) {
        throw this.stateConflict('COLLECTION_REMITTANCE_STATE_INVALID');
      }
      const collectionUpdated = await transaction.cashCollection.updateMany({
        where: { id: collection.id, status: collection.status },
        data: { status: 'REMITTED' },
      });
      if (collectionUpdated.count !== 1) throw this.stateConflict('COLLECTION_REMITTANCE_CONFLICT');
      if (collection.collectedMillimes === collection.expectedMillimes) {
        ordersEligibleForRemittance.set(collection.order.id, collection.order);
      }
    }
    for (const order of ordersEligibleForRemittance.values()) {
      const remainingCollections = await transaction.cashCollection.count({
        where: { orderId: order.id, status: { not: CashCollectionStatus.REMITTED } },
      });
      if (remainingCollections !== 0) continue;
      const orderUpdated = await transaction.order.updateMany({
        where: { id: order.id, version: order.version },
        data: { paymentStatus: 'CASH_REMITTED', version: { increment: 1 } },
      });
      if (orderUpdated.count !== 1) throw this.versionConflict();
    }
  }

  private uniqueOrders(remittance: RemittanceOperation) {
    return [
      ...new Map(
        remittance.items.map(({ cashCollection }) => [
          cashCollection.order.id,
          cashCollection.order,
        ]),
      ).values(),
    ];
  }

  private async lockRows(
    transaction: Transaction,
    table: 'Order' | 'Delivery' | 'CashCollection',
    ids: readonly string[],
  ): Promise<void> {
    const sorted = [...new Set(ids)].sort();
    if (sorted.length === 0) return;
    const tableSql =
      table === 'Order'
        ? Prisma.raw('`Order`')
        : table === 'Delivery'
          ? Prisma.raw('Delivery')
          : Prisma.raw('CashCollection');
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM ${tableSql}
      WHERE id IN (${Prisma.join(sorted)})
      ORDER BY id ASC
      FOR UPDATE
    `);
  }

  private audit(
    transaction: Transaction,
    request: Request,
    input: {
      action: string;
      resourceType: string;
      resourceId: string;
      before: Prisma.InputJsonValue | null;
      after: Prisma.InputJsonValue;
    },
  ) {
    return transaction.auditLog.create({
      data: {
        actorUserId: request.auth!.userId,
        actorType: 'ADMIN',
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        outcome: 'SUCCESS',
        requestId: request.requestId,
        ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
        userAgent: request.get('user-agent')?.slice(0, 512) ?? null,
        beforeSummary: input.before ?? Prisma.JsonNull,
        afterSummary: input.after,
      },
    });
  }

  private async requireCollectionDetail(
    transaction: Transaction,
    id: string,
  ): Promise<CollectionDetail> {
    const collection = await transaction.cashCollection.findUnique({
      where: { id },
      select: COLLECTION_DETAIL_SELECT,
    });
    if (!collection) throw this.collectionNotFound();
    return collection;
  }

  private async requireRemittanceDetail(
    transaction: Transaction,
    id: string,
  ): Promise<RemittanceDetail> {
    const remittance = await transaction.cashRemittance.findUnique({
      where: { id },
      select: REMITTANCE_DETAIL_SELECT,
    });
    if (!remittance) throw this.remittanceNotFound();
    return remittance;
  }

  private serializeCollection(collection: CollectionDetail) {
    return {
      id: collection.id,
      orderId: collection.orderId,
      orderNumber: collection.order.orderNumber,
      orderStatus: collection.order.status,
      paymentStatus: collection.order.paymentStatus,
      orderVersion: collection.order.version,
      deliveryId: collection.deliveryId,
      delivery: collection.delivery,
      courierId: collection.courierId,
      status: collection.status,
      expectedMillimes: collection.expectedMillimes,
      collectedMillimes: collection.collectedMillimes,
      collectedByUserId: collection.collectedByUserId,
      collectedAt: collection.collectedAt?.toISOString() ?? null,
      method: collection.method,
      note: collection.note,
      allocations: [...collection.remittanceItems].reverse().map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
      discrepancies: [...collection.order.cashDiscrepancies].reverse().map((discrepancy) => ({
        ...discrepancy,
        openedAt: discrepancy.openedAt.toISOString(),
        resolvedAt: discrepancy.resolvedAt?.toISOString() ?? null,
      })),
      historyTruncated:
        collection._count.remittanceItems > collection.remittanceItems.length ||
        collection.order._count.cashDiscrepancies > collection.order.cashDiscrepancies.length,
      createdAt: collection.createdAt.toISOString(),
      updatedAt: collection.updatedAt.toISOString(),
    };
  }

  private serializeRemittance(remittance: RemittanceDetail) {
    return {
      id: remittance.id,
      remittanceNumber: remittance.remittanceNumber,
      courier: remittance.courier,
      status: remittance.status,
      declaredMillimes: remittance.declaredMillimes,
      verifiedMillimes: remittance.verifiedMillimes,
      differenceMillimes: remittance.differenceMillimes,
      submittedAt: remittance.submittedAt?.toISOString() ?? null,
      remittedAt: remittance.remittedAt?.toISOString() ?? null,
      receivedByUserId: remittance.receivedByUserId,
      verifiedByUserId: remittance.verifiedByUserId,
      verifiedAt: remittance.verifiedAt?.toISOString() ?? null,
      note: remittance.note,
      items: [...remittance.items].reverse().map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
      discrepancies: [...remittance.discrepancies].reverse().map((discrepancy) => ({
        ...discrepancy,
        openedAt: discrepancy.openedAt.toISOString(),
        resolvedAt: discrepancy.resolvedAt?.toISOString() ?? null,
      })),
      events: [...remittance.events].reverse().map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
      })),
      historyTruncated:
        remittance._count.items > remittance.items.length ||
        remittance._count.discrepancies > remittance.discrepancies.length ||
        remittance._count.events > remittance.events.length,
      createdAt: remittance.createdAt.toISOString(),
      updatedAt: remittance.updatedAt.toISOString(),
    };
  }

  private page<T>(items: T[], query: { page: number; limit: number }, total: number) {
    return {
      items,
      page: query.page,
      pageSize: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  private assertIndependentActor(receivedByUserId: string | null, actorUserId: string): void {
    if (!receivedByUserId || receivedByUserId === actorUserId) {
      throw new ForbiddenException({
        code: 'SEPARATE_RECONCILIATION_APPROVER_REQUIRED',
        message: 'A different administrator must reconcile the remittance.',
      });
    }
  }

  private requireDiscrepancyReason(reasonCode?: string, reasonDetail?: string): void {
    if (!reasonCode?.trim() || !reasonDetail || reasonDetail.trim().length < 4) {
      throw this.badRequest(
        'DISCREPANCY_REASON_REQUIRED',
        'A reason code and meaningful detail are required for a cash difference.',
      );
    }
  }

  private collectionNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'CASH_COLLECTION_NOT_FOUND',
      message: 'The cash collection was not found.',
    });
  }

  private remittanceNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'CASH_REMITTANCE_NOT_FOUND',
      message: 'The cash remittance was not found.',
    });
  }

  private discrepancyNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'CASH_DISCREPANCY_NOT_FOUND',
      message: 'The cash discrepancy was not found.',
    });
  }

  private versionConflict(): ConflictException {
    return this.conflict('VERSION_CONFLICT', 'The cash record changed. Refresh and try again.');
  }

  private stateConflict(code: string): ConflictException {
    return this.conflict(
      code,
      'The cash workflow cannot perform that action from its current state.',
    );
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }

  private badRequest(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message });
  }
}
