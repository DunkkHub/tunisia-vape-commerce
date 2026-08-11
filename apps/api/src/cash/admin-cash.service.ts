import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  CashCollectionStatus,
  CashDiscrepancyStatus,
  CashRemittanceStatus,
  DeliveryMethodType,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import type { Request } from 'express';
import { serializeCsv } from '../common/export/csv';
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
  discrepancy: {
    select: {
      id: true,
      cashCollectionId: true,
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
  collectedByUserId: true,
  recordIdempotencyKeyHash: true,
  recordRequestHash: true,
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
          discrepancy: {
            select: {
              id: true,
              status: true,
              expectedMillimes: true,
              actualMillimes: true,
              differenceMillimes: true,
            },
          },
          order: {
            select: {
              id: true,
              paymentStatus: true,
              expectedCodMillimes: true,
              version: true,
            },
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

interface AccountableCollection {
  expectedMillimes: number;
  collectedMillimes: number;
  discrepancy: {
    id: string;
    status: CashDiscrepancyStatus;
    expectedMillimes: number;
    actualMillimes: number;
    differenceMillimes: number;
  } | null;
}

interface CollectionAccountingProjectionInput {
  expectedMillimes: number;
  collectedMillimes: number;
  discrepancy: {
    status: CashDiscrepancyStatus;
    expectedMillimes: number;
    actualMillimes: number;
    differenceMillimes: number;
  } | null;
}

const REMITTABLE_COLLECTION_STATUSES = new Set<CashCollectionStatus>([
  CashCollectionStatus.COLLECTED,
  CashCollectionStatus.PARTIALLY_COLLECTED,
]);
const ACCOUNTED_COLLECTION_STATUSES = new Set<CashCollectionStatus>([
  CashCollectionStatus.COLLECTED,
  CashCollectionStatus.REMITTED,
]);

const COLLECTABLE_PAYMENT_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.PAYMENT_PENDING,
  PaymentStatus.CASH_EXPECTED,
]);
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:+-]{16,128}$/;
const CASH_EXPORT_LIMIT = 500;

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
          discrepancy: {
            select: {
              status: true,
              expectedMillimes: true,
              actualMillimes: true,
              differenceMillimes: true,
            },
          },
          order: { select: { orderNumber: true, paymentStatus: true } },
          courier: { select: { name: true } },
        },
      }),
      this.prisma.cashCollection.count({ where }),
    ]);
    return {
      data: this.page(
        records.map((record) => ({
          ...this.collectionAccountingProjection(record),
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

  async exportCollections(query: AdminCollectionListQueryDto, request: Request) {
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
    const records = await this.prisma.$transaction(async (transaction) => {
      const found = await transaction.cashCollection.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: CASH_EXPORT_LIMIT + 1,
        select: {
          id: true,
          status: true,
          method: true,
          expectedMillimes: true,
          collectedMillimes: true,
          collectedAt: true,
          createdAt: true,
          discrepancy: {
            select: {
              status: true,
              expectedMillimes: true,
              actualMillimes: true,
              differenceMillimes: true,
            },
          },
          order: { select: { orderNumber: true, status: true, paymentStatus: true } },
          courier: { select: { code: true, name: true } },
        },
      });
      if (found.length > CASH_EXPORT_LIMIT) {
        throw new ServiceUnavailableException({
          code: 'CASH_EXPORT_TOO_LARGE',
          message: 'Narrow the cash filters before exporting more than 500 rows.',
        });
      }
      await this.audit(transaction, request, {
        action: 'cash.collection.csv_exported',
        resourceType: 'CashCollectionExport',
        resourceId: request.requestId.slice(0, 80),
        before: null,
        after: {
          schemaVersion: 'COD_COLLECTIONS_V2',
          rowCount: found.length,
          filters: { status: query.status ?? null, q: search ?? null },
        },
      });
      return found;
    });
    const csv = serializeCsv(
      [
        'schemaVersion',
        'collectionId',
        'orderNumber',
        'orderStatus',
        'paymentStatus',
        'courierCode',
        'courierName',
        'collectionStatus',
        'method',
        'expectedMillimes',
        'collectedMillimes',
        'differenceMillimes',
        'accountableMillimes',
        'adjustmentMillimes',
        'discrepancyStatus',
        'collectedAt',
        'createdAt',
      ],
      records.map((record) => {
        const accounting = this.collectionAccountingProjection(record);
        return [
          'COD_COLLECTIONS_V2',
          record.id,
          record.order.orderNumber,
          record.order.status,
          record.order.paymentStatus,
          record.courier?.code,
          record.courier?.name,
          record.status,
          record.method,
          record.expectedMillimes,
          record.collectedMillimes,
          cashDifference(record.expectedMillimes, record.collectedMillimes),
          accounting.accountableMillimes,
          accounting.adjustmentMillimes,
          accounting.discrepancyStatus,
          record.collectedAt?.toISOString(),
          record.createdAt.toISOString(),
        ];
      }),
    );
    return {
      csv,
      filename: `cod-collections-${new Date().toISOString().slice(0, 10)}.csv`,
      rowCount: records.length,
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

  async recordCollection(
    id: string,
    input: RecordCashCollectionDto,
    idempotencyKey: string | undefined,
    request: Request,
  ) {
    const normalizedKey = this.requireIdempotencyKey(idempotencyKey);
    const keyHash = createHash('sha256')
      .update(`cash-collection\0${request.auth!.userId}\0${id}\0${normalizedKey}`)
      .digest('hex');
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          collectedMillimes: input.collectedMillimes,
          confirmation: input.confirmation,
          expectedDeliveryVersion: input.expectedDeliveryVersion,
          expectedOrderVersion: input.expectedOrderVersion,
          reasonCode: input.reasonCode?.trim() ?? null,
          reasonDetail: input.reasonDetail?.trim() ?? null,
        }),
      )
      .digest('hex');
    return this.prisma.$transaction(async (transaction) => {
      const collection = await this.lockCollection(transaction, id);
      if (collection.recordIdempotencyKeyHash) {
        if (
          collection.recordIdempotencyKeyHash === keyHash &&
          collection.recordRequestHash === requestHash
        ) {
          return {
            data: this.serializeCollection(await this.requireCollectionDetail(transaction, id)),
          };
        }
        if (collection.recordIdempotencyKeyHash === keyHash) {
          throw this.conflict(
            'IDEMPOTENCY_KEY_REUSED',
            'The Idempotency-Key was already used with different cash collection data.',
          );
        }
      }
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
        where: {
          id: collection.id,
          status: CashCollectionStatus.EXPECTED,
          recordIdempotencyKeyHash: null,
        },
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
          recordIdempotencyKeyHash: keyHash,
          recordRequestHash: requestHash,
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
          cashCollectionId: collection.id,
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
            cashCollectionId: collection.id,
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
            cashCollectionId: collection.id,
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

  async exportRemittances(query: AdminRemittanceListQueryDto, request: Request) {
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
    const records = await this.prisma.$transaction(async (transaction) => {
      const found = await transaction.cashRemittance.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: CASH_EXPORT_LIMIT + 1,
        select: {
          id: true,
          remittanceNumber: true,
          status: true,
          declaredMillimes: true,
          verifiedMillimes: true,
          differenceMillimes: true,
          submittedAt: true,
          remittedAt: true,
          verifiedAt: true,
          createdAt: true,
          courier: { select: { code: true, name: true } },
        },
      });
      if (found.length > CASH_EXPORT_LIMIT) {
        throw new ServiceUnavailableException({
          code: 'CASH_EXPORT_TOO_LARGE',
          message: 'Narrow the cash filters before exporting more than 500 rows.',
        });
      }
      await this.audit(transaction, request, {
        action: 'cash.remittance.csv_exported',
        resourceType: 'CashRemittanceExport',
        resourceId: request.requestId.slice(0, 80),
        before: null,
        after: {
          schemaVersion: 'COD_REMITTANCES_V1',
          rowCount: found.length,
          filters: { status: query.status ?? null, q: search ?? null },
        },
      });
      return found;
    });
    const csv = serializeCsv(
      [
        'schemaVersion',
        'remittanceId',
        'remittanceNumber',
        'courierCode',
        'courierName',
        'status',
        'declaredMillimes',
        'verifiedMillimes',
        'differenceMillimes',
        'submittedAt',
        'remittedAt',
        'verifiedAt',
        'createdAt',
      ],
      records.map((record) => [
        'COD_REMITTANCES_V1',
        record.id,
        record.remittanceNumber,
        record.courier.code,
        record.courier.name,
        record.status,
        record.declaredMillimes,
        record.verifiedMillimes,
        record.differenceMillimes,
        record.submittedAt?.toISOString(),
        record.remittedAt?.toISOString(),
        record.verifiedAt?.toISOString(),
        record.createdAt.toISOString(),
      ]),
    );
    return {
      csv,
      filename: `cod-remittances-${new Date().toISOString().slice(0, 10)}.csv`,
      rowCount: records.length,
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
              expectedMillimes: true,
              collectedMillimes: true,
              discrepancy: {
                select: {
                  id: true,
                  status: true,
                  expectedMillimes: true,
                  actualMillimes: true,
                  differenceMillimes: true,
                },
              },
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
          const accountableMillimes = this.accountableCollectionMillimes(collection);
          if (
            collection.courierId !== courier.id ||
            !REMITTABLE_COLLECTION_STATUSES.has(collection.status)
          ) {
            throw this.stateConflict('COLLECTION_NOT_REMITTABLE');
          }
          if ((alreadyAllocated.get(collection.id) ?? 0) + amount > accountableMillimes) {
            throw this.conflict(
              'COLLECTION_OVER_ALLOCATED',
              'A collection cannot be allocated more than its reconciled cash balance.',
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
      const reference = await transaction.cashDiscrepancy.findUnique({
        where: { id },
        select: {
          id: true,
          remittanceId: true,
          cashCollectionId: true,
          orderId: true,
        },
      });
      if (!reference) throw this.discrepancyNotFound();
      if (reference.cashCollectionId && reference.orderId && !reference.remittanceId) {
        return this.resolveCollectionDiscrepancy(
          transaction,
          reference.cashCollectionId,
          id,
          input,
          request,
        );
      }
      if (reference.remittanceId && !reference.cashCollectionId && !reference.orderId) {
        return this.resolveRemittanceDiscrepancy(
          transaction,
          reference.remittanceId,
          id,
          input,
          request,
        );
      }
      throw this.stateConflict('DISCREPANCY_SCOPE_INVALID');
    });
  }

  private async resolveCollectionDiscrepancy(
    transaction: Transaction,
    cashCollectionId: string,
    id: string,
    input: ResolveCashDiscrepancyDto,
    request: Request,
  ) {
    const collection = await this.lockCollection(transaction, cashCollectionId);
    const locked = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM CashDiscrepancy WHERE id = ${id} FOR UPDATE
    `);
    if (locked.length !== 1) throw this.discrepancyNotFound();
    const discrepancy = await transaction.cashDiscrepancy.findUnique({
      where: { id },
      select: {
        id: true,
        remittanceId: true,
        cashCollectionId: true,
        orderId: true,
        status: true,
        expectedMillimes: true,
        actualMillimes: true,
        differenceMillimes: true,
        openedByUserId: true,
      },
    });
    if (!discrepancy) throw this.discrepancyNotFound();
    if (
      discrepancy.remittanceId !== null ||
      discrepancy.cashCollectionId !== collection.id ||
      discrepancy.orderId !== collection.orderId ||
      collection.deliveryId === null ||
      collection.delivery?.id !== collection.deliveryId ||
      collection.delivery.orderId !== collection.orderId ||
      discrepancy.expectedMillimes !== collection.expectedMillimes ||
      discrepancy.actualMillimes !== collection.collectedMillimes ||
      discrepancy.differenceMillimes !==
        cashDifference(collection.expectedMillimes, collection.collectedMillimes)
    ) {
      throw this.stateConflict('COLLECTION_DISCREPANCY_LINKAGE_INVALID');
    }
    if (!canTransitionDiscrepancy(discrepancy.status, input.resolution)) {
      throw this.stateConflict('DISCREPANCY_RESOLUTION_NOT_ALLOWED');
    }
    if (
      !REMITTABLE_COLLECTION_STATUSES.has(collection.status) ||
      collection.order.paymentStatus !== PaymentStatus.RECONCILIATION_DISCREPANCY
    ) {
      throw this.stateConflict('COLLECTION_DISCREPANCY_STATE_INVALID');
    }
    if (
      !collection.collectedByUserId ||
      discrepancy.openedByUserId === request.auth!.userId ||
      collection.collectedByUserId === request.auth!.userId
    ) {
      throw new ForbiddenException({
        code: 'SEPARATE_RECONCILIATION_APPROVER_REQUIRED',
        message: 'A different administrator must resolve the collection discrepancy.',
      });
    }
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM CashRemittanceItem
      WHERE cashCollectionId = ${collection.id}
      ORDER BY id ASC
      FOR UPDATE
    `);
    const allocationCount = await transaction.cashRemittanceItem.count({
      where: { cashCollectionId: collection.id },
    });
    if (allocationCount !== 0) {
      throw this.stateConflict('COLLECTION_DISCREPANCY_ALREADY_ALLOCATED');
    }

    const now = new Date();
    const adjustmentMillimes = collection.expectedMillimes - collection.collectedMillimes;
    if (input.resolution === CashDiscrepancyStatus.RESOLVED) {
      if (input.finalVerifiedMillimes !== collection.expectedMillimes) {
        throw this.badRequest(
          'FINAL_VERIFIED_AMOUNT_INVALID',
          'Resolution requires final verified cash to equal the expected collection.',
        );
      }
      const paymentStatus =
        collection.order.deliveryMethodType === DeliveryMethodType.STORE_PICKUP
          ? PaymentStatus.CASH_COLLECTED_AT_STORE
          : PaymentStatus.CASH_COLLECTED_BY_COURIER;
      const orderCollections = await transaction.cashCollection.findMany({
        where: { orderId: collection.orderId, status: { not: CashCollectionStatus.VOIDED } },
        select: {
          id: true,
          status: true,
          expectedMillimes: true,
          collectedMillimes: true,
          discrepancy: {
            select: {
              status: true,
              expectedMillimes: true,
              actualMillimes: true,
              differenceMillimes: true,
            },
          },
        },
      });
      let accountableTotal = 0;
      let currentCollectionFound = false;
      const projectionReady = orderCollections.every((item) => {
        if (item.id === collection.id) {
          currentCollectionFound = true;
          accountableTotal += collection.expectedMillimes;
          return true;
        }
        const difference = cashDifference(item.expectedMillimes, item.collectedMillimes);
        if (!item.discrepancy) {
          if (!ACCOUNTED_COLLECTION_STATUSES.has(item.status) || difference !== 0) return false;
          accountableTotal += item.collectedMillimes;
          return true;
        }
        if (
          item.discrepancy.status !== CashDiscrepancyStatus.RESOLVED ||
          item.discrepancy.expectedMillimes !== item.expectedMillimes ||
          item.discrepancy.actualMillimes !== item.collectedMillimes ||
          item.discrepancy.differenceMillimes !== difference ||
          !ACCOUNTED_COLLECTION_STATUSES.has(item.status)
        ) {
          return false;
        }
        accountableTotal += item.expectedMillimes;
        return true;
      });
      const clearProjection =
        currentCollectionFound &&
        projectionReady &&
        accountableTotal === collection.order.expectedCodMillimes;
      const collectionUpdated = await transaction.cashCollection.updateMany({
        where: { id: collection.id, status: collection.status },
        data: { status: CashCollectionStatus.COLLECTED },
      });
      if (collectionUpdated.count !== 1) throw this.versionConflict();
      if (clearProjection) {
        const [orderUpdated, deliveryUpdated] = await Promise.all([
          transaction.order.updateMany({
            where: {
              id: collection.order.id,
              version: collection.order.version,
              paymentStatus: PaymentStatus.RECONCILIATION_DISCREPANCY,
            },
            data: { paymentStatus, version: { increment: 1 } },
          }),
          transaction.delivery.updateMany({
            where: { id: collection.delivery.id, version: collection.delivery.version },
            data: { cashCollectedResult: true, version: { increment: 1 } },
          }),
        ]);
        if (orderUpdated.count !== 1 || deliveryUpdated.count !== 1) {
          throw this.versionConflict();
        }
      }
      await transaction.cashReconciliationEvent.create({
        data: {
          cashCollectionId: collection.id,
          type: 'ADJUSTMENT_RECORDED',
          amountMillimes: adjustmentMillimes,
          actorUserId: request.auth!.userId,
          summary: 'Collection cash balance corrected by an independent exact second count.',
          metadata: {
            discrepancyId: discrepancy.id,
            originalCollectedMillimes: collection.collectedMillimes,
            finalVerifiedMillimes: input.finalVerifiedMillimes,
            adjustmentMillimes,
            resolutionReason: input.reasonDetail.trim(),
          },
          requestId: request.requestId,
        },
      });
    } else if (input.finalVerifiedMillimes !== undefined) {
      throw this.badRequest(
        'FINAL_VERIFIED_AMOUNT_NOT_APPLICABLE',
        'A written-off discrepancy does not change the verified collection amount.',
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
          cashCollectionId: collection.id,
          type: 'DISCREPANCY_RESOLVED',
          amountMillimes: discrepancy.differenceMillimes,
          actorUserId: request.auth!.userId,
          summary:
            input.resolution === CashDiscrepancyStatus.RESOLVED
              ? 'Collection discrepancy resolved with exact independently verified cash.'
              : 'Collection discrepancy written off; the order remains discrepant.',
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
        before: {
          scope: 'COLLECTION',
          status: discrepancy.status,
          paymentStatus: collection.order.paymentStatus,
          collectedMillimes: collection.collectedMillimes,
        },
        after: {
          scope: 'COLLECTION',
          status: input.resolution,
          finalVerifiedMillimes: input.finalVerifiedMillimes ?? null,
          adjustmentMillimes:
            input.resolution === CashDiscrepancyStatus.RESOLVED ? adjustmentMillimes : null,
        },
      }),
    ]);
    return {
      data: this.serializeCollection(
        await this.requireCollectionDetail(transaction, collection.id),
      ),
    };
  }

  private async resolveRemittanceDiscrepancy(
    transaction: Transaction,
    remittanceId: string,
    id: string,
    input: ResolveCashDiscrepancyDto,
    request: Request,
  ) {
    const locked = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM CashDiscrepancy WHERE id = ${id} FOR UPDATE
    `);
    if (locked.length !== 1) throw this.discrepancyNotFound();
    const discrepancy = await transaction.cashDiscrepancy.findUnique({
      where: { id },
      select: {
        id: true,
        remittanceId: true,
        cashCollectionId: true,
        orderId: true,
        status: true,
        differenceMillimes: true,
        openedByUserId: true,
      },
    });
    if (
      !discrepancy ||
      discrepancy.remittanceId !== remittanceId ||
      discrepancy.cashCollectionId !== null ||
      discrepancy.orderId !== null
    ) {
      throw this.stateConflict('DISCREPANCY_SCOPE_INVALID');
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
    const remittance = await this.lockRemittanceWithCash(transaction, remittanceId);
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
    const orders = this.uniqueOrders(remittance);
    const orderIds = orders.map(({ id }) => id);
    const siblingCollectionReferences = await transaction.cashCollection.findMany({
      where: { orderId: { in: orderIds } },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    await this.lockRows(
      transaction,
      'CashCollection',
      siblingCollectionReferences.map(({ id }) => id),
    );

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
    for (const item of remittance.items) {
      const collection = item.cashCollection;
      const accountableMillimes = this.accountableCollectionMillimes(collection);
      const allocated = allocatedByCollection.get(collection.id) ?? 0;
      if (allocated > accountableMillimes) {
        throw this.stateConflict('COLLECTION_OVER_ALLOCATED');
      }
      if (allocated !== accountableMillimes) continue;
      if (!canTransitionCollection(collection.status, CashCollectionStatus.REMITTED)) {
        throw this.stateConflict('COLLECTION_REMITTANCE_STATE_INVALID');
      }
      const collectionUpdated = await transaction.cashCollection.updateMany({
        where: { id: collection.id, status: collection.status },
        data: { status: 'REMITTED' },
      });
      if (collectionUpdated.count !== 1) throw this.stateConflict('COLLECTION_REMITTANCE_CONFLICT');
    }

    const accountableCollections = await transaction.cashCollection.findMany({
      where: {
        orderId: { in: orderIds },
        status: { not: CashCollectionStatus.VOIDED },
      },
      orderBy: [{ orderId: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        orderId: true,
        status: true,
        expectedMillimes: true,
        collectedMillimes: true,
        discrepancy: {
          select: {
            id: true,
            status: true,
            expectedMillimes: true,
            actualMillimes: true,
            differenceMillimes: true,
          },
        },
      },
    });
    const collectionsByOrder = new Map<string, typeof accountableCollections>();
    for (const collection of accountableCollections) {
      const orderCollections = collectionsByOrder.get(collection.orderId) ?? [];
      orderCollections.push(collection);
      collectionsByOrder.set(collection.orderId, orderCollections);
    }
    for (const order of orders) {
      const orderCollections = collectionsByOrder.get(order.id) ?? [];
      if (
        orderCollections.length === 0 ||
        orderCollections.some(({ status }) => status !== CashCollectionStatus.REMITTED)
      ) {
        continue;
      }
      const accountableTotal = sumMillimes(
        orderCollections.map((collection) => this.accountableCollectionMillimes(collection)),
      );
      if (accountableTotal !== order.expectedCodMillimes) continue;
      const orderUpdated = await transaction.order.updateMany({
        where: { id: order.id, version: order.version },
        data: { paymentStatus: 'CASH_REMITTED', version: { increment: 1 } },
      });
      if (orderUpdated.count !== 1) throw this.versionConflict();
    }
  }

  private accountableCollectionMillimes(collection: AccountableCollection): number {
    const recordedDifference = cashDifference(
      collection.expectedMillimes,
      collection.collectedMillimes,
    );
    const discrepancy = collection.discrepancy;
    if (!discrepancy) {
      if (recordedDifference !== 0) {
        throw this.stateConflict('COLLECTION_DISCREPANCY_LINK_MISSING');
      }
      return collection.collectedMillimes;
    }
    if (
      discrepancy.expectedMillimes !== collection.expectedMillimes ||
      discrepancy.actualMillimes !== collection.collectedMillimes ||
      discrepancy.differenceMillimes !== recordedDifference
    ) {
      throw this.stateConflict('COLLECTION_DISCREPANCY_LINKAGE_INVALID');
    }
    if (
      discrepancy.status === CashDiscrepancyStatus.OPEN ||
      discrepancy.status === CashDiscrepancyStatus.INVESTIGATING
    ) {
      throw this.stateConflict('COLLECTION_DISCREPANCY_UNRESOLVED');
    }
    return discrepancy.status === CashDiscrepancyStatus.RESOLVED
      ? collection.expectedMillimes
      : collection.collectedMillimes;
  }

  private collectionAccountingProjection(collection: CollectionAccountingProjectionInput) {
    const rawDifference = cashDifference(collection.expectedMillimes, collection.collectedMillimes);
    const discrepancy = collection.discrepancy;
    if (!discrepancy) {
      return {
        accountableMillimes: rawDifference === 0 ? collection.collectedMillimes : null,
        adjustmentMillimes: rawDifference === 0 ? 0 : null,
        discrepancyStatus: null,
      };
    }
    const linkageValid =
      discrepancy.expectedMillimes === collection.expectedMillimes &&
      discrepancy.actualMillimes === collection.collectedMillimes &&
      discrepancy.differenceMillimes === rawDifference;
    if (!linkageValid) {
      return {
        accountableMillimes: null,
        adjustmentMillimes: null,
        discrepancyStatus: discrepancy.status,
      };
    }
    if (discrepancy.status === CashDiscrepancyStatus.RESOLVED) {
      return {
        accountableMillimes: collection.expectedMillimes,
        adjustmentMillimes: collection.expectedMillimes - collection.collectedMillimes,
        discrepancyStatus: discrepancy.status,
      };
    }
    if (discrepancy.status === CashDiscrepancyStatus.WRITTEN_OFF) {
      return {
        accountableMillimes: collection.collectedMillimes,
        adjustmentMillimes: 0,
        discrepancyStatus: discrepancy.status,
      };
    }
    return {
      accountableMillimes: null,
      adjustmentMillimes: null,
      discrepancyStatus: discrepancy.status,
    };
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
      ...this.collectionAccountingProjection(collection),
      collectedByUserId: collection.collectedByUserId,
      collectedAt: collection.collectedAt?.toISOString() ?? null,
      method: collection.method,
      note: collection.note,
      allocations: [...collection.remittanceItems].reverse().map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
      discrepancies: collection.discrepancy
        ? [
            {
              ...collection.discrepancy,
              openedAt: collection.discrepancy.openedAt.toISOString(),
              resolvedAt: collection.discrepancy.resolvedAt?.toISOString() ?? null,
            },
          ]
        : [],
      historyTruncated: collection._count.remittanceItems > collection.remittanceItems.length,
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

  private requireIdempotencyKey(value: string | undefined): string {
    if (!value || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
      throw this.badRequest(
        'INVALID_IDEMPOTENCY_KEY',
        'A valid Idempotency-Key header is required.',
      );
    }
    return value;
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
