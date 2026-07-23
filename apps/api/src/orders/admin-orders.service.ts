import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CashCollectionStatus,
  DeliveryStatus,
  NotificationEvent,
  OrderStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import type { Request } from 'express';
import { neutralizeCsvFormula } from '../common/export/csv';
import { createOperationalAlertWithOutbox } from '../common/outbox/operational-alerts';
import { createOrderNotificationsWithOutbox } from '../common/outbox/order-notifications';
import { CryptoService } from '../common/security/crypto.service';
import { PrismaService } from '../database/prisma.service';
import type {
  CancelOrderDto,
  ConfirmOrderDto,
  CreateOrderNoteDto,
  RecordOrderContactAttemptDto,
  RejectOrderDto,
  TransitionOrderDto,
} from './dto/admin-order.dto';
import { canTransitionOrder, EARLY_CANCELLATION_STATUSES } from './order-state-machine';

const ADMIN_ORDER_DETAIL_SELECT = {
  id: true,
  orderNumber: true,
  customerNameSnapshot: true,
  customerPhoneSnapshot: true,
  customerEmailSnapshot: true,
  status: true,
  paymentStatus: true,
  currency: true,
  subtotalMillimes: true,
  discountTotalMillimes: true,
  deliveryTotalMillimes: true,
  taxTotalMillimes: true,
  grandTotalMillimes: true,
  expectedCodMillimes: true,
  deliveryMethodType: true,
  deliveryMethodSnapshot: true,
  preferredDeliveryDate: true,
  deliveryInstructions: true,
  ageConfirmedAt: true,
  minimumAgeSnapshot: true,
  ageVerificationAtDeliveryRequired: true,
  confirmedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      productNameSnapshot: true,
      variantNameSnapshot: true,
      skuSnapshot: true,
      barcodeSnapshot: true,
      warningSnapshotFr: true,
      warningSnapshotAr: true,
      unitPriceMillimes: true,
      unitDiscountMillimes: true,
      taxRateBpsSnapshot: true,
      unitTaxMillimes: true,
      quantity: true,
      lineSubtotalMillimes: true,
      lineDiscountMillimes: true,
      lineTaxMillimes: true,
      lineTotalMillimes: true,
    },
  },
  addressSnapshots: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      type: true,
      fullName: true,
      phoneE164: true,
      governorateName: true,
      delegationName: true,
      localityName: true,
      postalCode: true,
      street: true,
      building: true,
      floor: true,
      apartment: true,
      landmark: true,
      instructions: true,
    },
  },
  statusHistory: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      reasonCode: true,
      note: true,
      changedByUserId: true,
      createdAt: true,
    },
  },
  notes: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      authorUserId: true,
      visibility: true,
      body: true,
      createdAt: true,
    },
  },
  delivery: {
    select: {
      id: true,
      status: true,
      trackingNumber: true,
      ageVerificationRequired: true,
      ageVerificationResult: true,
      cashCollectedResult: true,
      assignedAt: true,
      handedToCourierAt: true,
      deliveredAt: true,
      nextAttemptAt: true,
      internalNotes: true,
      customerVisibleNotes: true,
      courierFeeMillimes: true,
      version: true,
      courier: { select: { id: true, name: true } },
      attempts: {
        orderBy: [{ attemptedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          attemptNumber: true,
          attemptedAt: true,
          outcome: true,
          notes: true,
          nextAttemptAt: true,
          ageVerificationResult: true,
          cashExpectedMillimes: true,
          cashCollectedMillimes: true,
          recordedByUserId: true,
        },
      },
      events: {
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          occurredAt: true,
          actorUserId: true,
          source: true,
          reasonCode: true,
          note: true,
        },
      },
    },
  },
  cashCollections: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      status: true,
      expectedMillimes: true,
      collectedMillimes: true,
      method: true,
      collectedByUserId: true,
      collectedAt: true,
      note: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  cashDiscrepancies: {
    orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
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
} as const satisfies Prisma.OrderSelect;

const ORDER_SLIP_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  currency: true,
  customerNameSnapshot: true,
  customerPhoneSnapshot: true,
  subtotalMillimes: true,
  discountTotalMillimes: true,
  deliveryTotalMillimes: true,
  taxTotalMillimes: true,
  grandTotalMillimes: true,
  expectedCodMillimes: true,
  deliveryMethodSnapshot: true,
  deliveryInstructions: true,
  ageVerificationAtDeliveryRequired: true,
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      skuSnapshot: true,
      productNameSnapshot: true,
      variantNameSnapshot: true,
      quantity: true,
      unitPriceMillimes: true,
      lineTotalMillimes: true,
    },
  },
  addressSnapshots: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 2,
    select: {
      type: true,
      fullName: true,
      phoneE164: true,
      governorateName: true,
      delegationName: true,
      localityName: true,
      postalCode: true,
      street: true,
      building: true,
      floor: true,
      apartment: true,
      landmark: true,
    },
  },
} as const satisfies Prisma.OrderSelect;

const ORDER_OPERATION_SELECT = {
  id: true,
  orderNumber: true,
  customerPhoneSnapshot: true,
  customerEmailSnapshot: true,
  status: true,
  paymentStatus: true,
  deliveryMethodType: true,
  version: true,
  customer: { select: { locale: true } },
  delivery: { select: { id: true, status: true, version: true } },
  items: { select: { id: true, variantId: true, quantity: true } },
  cashCollections: { select: { id: true, status: true } },
} as const satisfies Prisma.OrderSelect;

type AdminOrderDetailRecord = Prisma.OrderGetPayload<{
  select: typeof ADMIN_ORDER_DETAIL_SELECT;
}>;
type OrderOperationRecord = Prisma.OrderGetPayload<{ select: typeof ORDER_OPERATION_SELECT }>;
type OrderSlipRecord = Prisma.OrderGetPayload<{ select: typeof ORDER_SLIP_SELECT }>;
type Transaction = Prisma.TransactionClient;

interface LockedReservationRow {
  id: string;
  inventoryItemId: string;
}

interface LockedReservation {
  id: string;
  inventoryItemId: string;
  orderItemId: string | null;
  quantity: number;
  expiresAt: Date;
}

interface LockedInventoryItem {
  id: string;
  variantId: string;
  locationId: string;
  batchId: string | null;
  onHandQuantity: number;
  version: number;
}

interface LockedInventory {
  reservations: LockedReservation[];
  items: LockedInventoryItem[];
}

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async get(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: ADMIN_ORDER_DETAIL_SELECT,
    });
    if (!order) throw this.notFound();
    return { data: this.serializeDetail(order) };
  }

  async getSlip(id: string, request: Request) {
    return this.prisma.$transaction(async (transaction) => {
      const order = await transaction.order.findUnique({
        where: { id },
        select: ORDER_SLIP_SELECT,
      });
      if (!order) throw this.notFound();
      await transaction.auditLog.create({
        data: {
          actorUserId: request.auth!.userId,
          actorType: 'ADMIN',
          action: 'order.slip.generated',
          resourceType: 'Order',
          resourceId: order.id,
          outcome: 'SUCCESS',
          requestId: request.requestId,
          ipAddress: this.ipAddress(request),
          userAgent: this.userAgent(request),
          afterSummary: { documentType: 'ORDER_SLIP_JSON_V1' },
        },
      });
      return { data: this.serializeSlip(order) };
    });
  }

  async confirm(id: string, input: ConfirmOrderDto, request: Request) {
    return this.prisma.$transaction(async (transaction) => {
      const order = await this.lockOrder(transaction, id);
      this.assertVersion(order, input.expectedVersion);
      if (
        order.status !== OrderStatus.PENDING_CONFIRMATION ||
        !canTransitionOrder(order.status, OrderStatus.CONFIRMED)
      ) {
        throw this.stateConflict('ORDER_CONFIRMATION_NOT_ALLOWED');
      }
      if (!order.delivery) {
        throw this.stateConflict('ORDER_DELIVERY_MISSING');
      }
      if (order.delivery.status !== DeliveryStatus.PENDING_CONFIRMATION) {
        throw this.stateConflict('DELIVERY_CONFIRMATION_NOT_ALLOWED');
      }

      const locked = await this.lockActiveInventory(transaction, order.id);
      this.assertReservationCoverage(order, locked);
      const now = new Date();

      for (const inventory of locked.items) {
        const quantity = locked.reservations
          .filter((reservation) => reservation.inventoryItemId === inventory.id)
          .reduce((total, reservation) => total + reservation.quantity, 0);
        const onHandAfter = inventory.onHandQuantity - quantity;
        if (quantity <= 0 || onHandAfter < 0) {
          throw this.conflict('INSUFFICIENT_STOCK', 'The reserved stock cannot be confirmed.');
        }
        const updated = await transaction.inventoryItem.updateMany({
          where: {
            id: inventory.id,
            version: inventory.version,
            onHandQuantity: { gte: quantity },
          },
          data: { onHandQuantity: { decrement: quantity }, version: { increment: 1 } },
        });
        if (updated.count !== 1) {
          throw this.conflict(
            'INVENTORY_CONFLICT',
            'Inventory changed while the order was being confirmed.',
          );
        }
        await transaction.stockMovement.create({
          data: {
            inventoryItemId: inventory.id,
            locationId: inventory.locationId,
            batchId: inventory.batchId,
            type: 'ORDER_CONFIRMED',
            quantityDelta: -quantity,
            onHandAfter,
            referenceType: 'Order',
            referenceId: order.id,
            reasonCode: 'ORDER_CONFIRMED',
            actorUserId: request.auth!.userId,
            requestId: request.requestId,
          },
        });
      }

      const consumed = await transaction.stockReservation.updateMany({
        where: {
          id: { in: locked.reservations.map(({ id: reservationId }) => reservationId) },
          state: 'ACTIVE',
        },
        data: { state: 'CONSUMED', activeKey: null, consumedAt: now },
      });
      if (consumed.count !== locked.reservations.length) {
        throw this.conflict(
          'RESERVATION_CONFLICT',
          'Reserved stock changed while the order was being confirmed.',
        );
      }

      await this.createLowStockAlerts(
        transaction,
        [...new Set(locked.items.map(({ variantId }) => variantId))],
        now,
      );

      const orderUpdated = await transaction.order.updateMany({
        where: {
          id: order.id,
          status: OrderStatus.PENDING_CONFIRMATION,
          version: input.expectedVersion,
        },
        data: { status: 'CONFIRMED', confirmedAt: now, version: { increment: 1 } },
      });
      const deliveryUpdated = await transaction.delivery.updateMany({
        where: {
          id: order.delivery.id,
          status: DeliveryStatus.PENDING_CONFIRMATION,
          version: order.delivery.version,
        },
        data: { status: 'CONFIRMED', version: { increment: 1 } },
      });
      if (orderUpdated.count !== 1 || deliveryUpdated.count !== 1) {
        throw this.conflict('VERSION_CONFLICT', 'The order changed before it could be confirmed.');
      }

      await Promise.all([
        transaction.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: 'CONFIRMED',
            reasonCode: 'ADMIN_CONFIRMED',
            changedByUserId: request.auth!.userId,
            requestId: request.requestId,
          },
        }),
        transaction.deliveryEvent.create({
          data: {
            deliveryId: order.delivery.id,
            fromStatus: order.delivery.status,
            toStatus: 'CONFIRMED',
            actorUserId: request.auth!.userId,
            source: 'ADMIN_ORDER_INTAKE',
            reasonCode: 'ADMIN_CONFIRMED',
            requestId: request.requestId,
          },
        }),
        this.createNotification(transaction, order, NotificationEvent.ORDER_CONFIRMED, now),
        this.createAudit(transaction, {
          order,
          action: 'order.confirmed',
          request,
          before: { status: order.status, version: order.version },
          after: { status: OrderStatus.CONFIRMED, version: order.version + 1 },
        }),
      ]);

      return { data: this.serializeDetail(await this.requireDetail(transaction, order.id)) };
    });
  }

  async cancel(id: string, input: CancelOrderDto, request: Request) {
    return this.terminate('cancel', id, input, request);
  }

  async reject(id: string, input: RejectOrderDto, request: Request) {
    return this.terminate('reject', id, input, request);
  }

  async prepare(id: string, input: TransitionOrderDto, request: Request) {
    return this.transitionIntake(
      id,
      input,
      request,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      DeliveryStatus.CONFIRMED,
      DeliveryStatus.PREPARING,
      'ADMIN_PREPARING',
      NotificationEvent.ORDER_PREPARING,
    );
  }

  async readyForPickup(id: string, input: TransitionOrderDto, request: Request) {
    return this.transitionIntake(
      id,
      input,
      request,
      OrderStatus.PREPARING,
      OrderStatus.READY_FOR_PICKUP,
      DeliveryStatus.PREPARING,
      DeliveryStatus.READY_FOR_PICKUP,
      'ADMIN_READY_FOR_PICKUP',
    );
  }

  private async terminate(
    disposition: 'cancel' | 'reject',
    id: string,
    input: CancelOrderDto | RejectOrderDto,
    request: Request,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const order = await this.lockOrder(transaction, id);
      this.assertVersion(order, input.expectedVersion);
      const orderStateAllowed =
        disposition === 'reject'
          ? order.status === OrderStatus.PENDING_CONFIRMATION
          : EARLY_CANCELLATION_STATUSES.has(order.status);
      if (!orderStateAllowed || !canTransitionOrder(order.status, OrderStatus.CANCELLED)) {
        throw this.stateConflict(
          disposition === 'reject'
            ? 'ORDER_REJECTION_NOT_ALLOWED'
            : 'ORDER_CANCELLATION_NOT_ALLOWED',
        );
      }
      if (!order.delivery) {
        throw this.stateConflict('ORDER_DELIVERY_MISSING');
      }
      const deliveryStateAllowed =
        disposition === 'reject'
          ? order.delivery.status === DeliveryStatus.PENDING_CONFIRMATION
          : EARLY_CANCELLATION_STATUSES.has(order.delivery.status);
      if (!deliveryStateAllowed || order.delivery.status !== order.status) {
        throw this.stateConflict(
          disposition === 'reject'
            ? 'DELIVERY_REJECTION_NOT_ALLOWED'
            : 'DELIVERY_CANCELLATION_NOT_ALLOWED',
        );
      }
      const nonVoidableCash = order.cashCollections.some(
        ({ status }) =>
          status !== CashCollectionStatus.EXPECTED && status !== CashCollectionStatus.VOIDED,
      );
      if (
        nonVoidableCash ||
        (order.paymentStatus !== PaymentStatus.PAYMENT_PENDING &&
          order.paymentStatus !== PaymentStatus.CASH_EXPECTED)
      ) {
        throw this.stateConflict('ORDER_CASH_ALREADY_COLLECTED');
      }

      const locked = await this.lockActiveInventory(transaction, order.id);
      const now = new Date();
      const reason = input.reason.trim();
      if (locked.reservations.length > 0) {
        const released = await transaction.stockReservation.updateMany({
          where: {
            id: { in: locked.reservations.map(({ id: reservationId }) => reservationId) },
            state: 'ACTIVE',
          },
          data: {
            state: 'RELEASED',
            activeKey: null,
            releasedAt: now,
            releaseReason: reason,
          },
        });
        if (released.count !== locked.reservations.length) {
          throw this.conflict(
            'RESERVATION_CONFLICT',
            'Reserved stock changed while the order was being terminated.',
          );
        }
      }

      await transaction.cashCollection.updateMany({
        where: { orderId: order.id, status: 'EXPECTED' },
        data: { status: 'VOIDED' },
      });
      const orderUpdated = await transaction.order.updateMany({
        where: { id: order.id, status: order.status, version: input.expectedVersion },
        data: {
          status: 'CANCELLED',
          paymentStatus: 'CANCELLED',
          cancelledAt: now,
          cancellationReason: reason,
          version: { increment: 1 },
        },
      });
      const deliveryUpdated = await transaction.delivery.updateMany({
        where: {
          id: order.delivery.id,
          status: order.delivery.status,
          version: order.delivery.version,
        },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      if (orderUpdated.count !== 1 || deliveryUpdated.count !== 1) {
        throw this.conflict('VERSION_CONFLICT', 'The order changed before it could be cancelled.');
      }

      const reasonCode = disposition === 'reject' ? 'ADMIN_REJECTED' : 'ADMIN_CANCELLED';
      await Promise.all([
        transaction.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: 'CANCELLED',
            reasonCode,
            note: reason,
            changedByUserId: request.auth!.userId,
            requestId: request.requestId,
          },
        }),
        transaction.deliveryEvent.create({
          data: {
            deliveryId: order.delivery.id,
            fromStatus: order.delivery.status,
            toStatus: 'CANCELLED',
            actorUserId: request.auth!.userId,
            source: 'ADMIN_ORDER_INTAKE',
            reasonCode,
            note: reason,
            requestId: request.requestId,
          },
        }),
        this.createNotification(transaction, order, NotificationEvent.ORDER_CANCELLED, now),
        this.createAudit(transaction, {
          order,
          action: disposition === 'reject' ? 'order.rejected' : 'order.cancelled',
          request,
          before: {
            status: order.status,
            paymentStatus: order.paymentStatus,
            version: order.version,
          },
          after: {
            status: OrderStatus.CANCELLED,
            paymentStatus: 'CANCELLED',
            version: order.version + 1,
            reason,
            disposition,
          },
        }),
      ]);

      return { data: this.serializeDetail(await this.requireDetail(transaction, order.id)) };
    });
  }

  private async transitionIntake(
    id: string,
    input: TransitionOrderDto,
    request: Request,
    fromOrder: OrderStatus,
    toOrder: OrderStatus,
    fromDelivery: DeliveryStatus,
    toDelivery: DeliveryStatus,
    reasonCode: string,
    notification?: NotificationEvent,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const order = await this.lockOrder(transaction, id);
      this.assertVersion(order, input.expectedVersion);
      if (
        order.status !== fromOrder ||
        !canTransitionOrder(order.status, toOrder) ||
        !order.delivery ||
        order.delivery.status !== fromDelivery
      ) {
        throw this.stateConflict('ORDER_TRANSITION_NOT_ALLOWED');
      }
      if (toOrder === OrderStatus.READY_FOR_PICKUP && order.deliveryMethodType !== 'STORE_PICKUP') {
        throw this.stateConflict('ORDER_IS_NOT_STORE_PICKUP');
      }
      const orderUpdated = await transaction.order.updateMany({
        where: { id: order.id, status: fromOrder, version: input.expectedVersion },
        data: { status: toOrder, version: { increment: 1 } },
      });
      const deliveryUpdated = await transaction.delivery.updateMany({
        where: {
          id: order.delivery.id,
          status: fromDelivery,
          version: order.delivery.version,
        },
        data: { status: toDelivery, version: { increment: 1 } },
      });
      if (orderUpdated.count !== 1 || deliveryUpdated.count !== 1) {
        throw this.conflict('VERSION_CONFLICT', 'The order changed during the transition.');
      }
      const now = new Date();
      const events: Promise<unknown>[] = [
        transaction.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: fromOrder,
            toStatus: toOrder,
            reasonCode,
            changedByUserId: request.auth!.userId,
            requestId: request.requestId,
          },
        }),
        transaction.deliveryEvent.create({
          data: {
            deliveryId: order.delivery.id,
            fromStatus: fromDelivery,
            toStatus: toDelivery,
            actorUserId: request.auth!.userId,
            source: 'ADMIN_ORDER_FULFILLMENT',
            reasonCode,
            requestId: request.requestId,
          },
        }),
        this.createAudit(transaction, {
          order,
          action: `order.${toOrder.toLocaleLowerCase('en-US')}`,
          request,
          before: { status: fromOrder, version: order.version },
          after: { status: toOrder, version: order.version + 1 },
        }),
      ];
      if (notification) events.push(this.createNotification(transaction, order, notification, now));
      await Promise.all(events);
      return { data: this.serializeDetail(await this.requireDetail(transaction, order.id)) };
    });
  }

  async recordContactAttempt(id: string, input: RecordOrderContactAttemptDto, request: Request) {
    if (input.result === 'OTHER' && !input.explanation?.trim()) {
      throw this.conflict(
        'CONTACT_ATTEMPT_EXPLANATION_REQUIRED',
        'An explanation is required for an OTHER contact result.',
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      const order = await this.lockOrder(transaction, id);
      this.assertVersion(order, input.expectedVersion);
      const explanation = input.explanation?.trim() || null;
      const reasonCode = input.reasonCode?.trim() || null;
      const recordedAt = new Date();
      const note = await transaction.orderNote.create({
        data: {
          orderId: order.id,
          authorUserId: request.auth!.userId,
          visibility: 'INTERNAL',
          body: [
            `CONTACT_ATTEMPT method=${input.method} result=${input.result}`,
            reasonCode ? `reason=${reasonCode}` : '',
            explanation ?? '',
          ]
            .filter(Boolean)
            .join(' | '),
        },
      });
      await this.createAudit(transaction, {
        order,
        action: 'order.contact_attempt.recorded',
        request,
        before: { status: order.status, version: order.version },
        after: { method: input.method, result: input.result, reasonCode },
      });
      return {
        data: {
          id: note.id,
          method: input.method,
          result: input.result,
          reasonCode,
          explanation,
          recordedByUserId: request.auth!.userId,
          recordedAt: recordedAt.toISOString(),
        },
      };
    });
  }

  async addNote(id: string, input: CreateOrderNoteDto, request: Request) {
    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM \`Order\` WHERE id = ${id} FOR UPDATE`,
      );
      if (locked.length !== 1) throw this.notFound();
      const note = await transaction.orderNote.create({
        data: {
          orderId: id,
          authorUserId: request.auth!.userId,
          visibility: input.visibility,
          body: input.body.trim(),
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: request.auth!.userId,
          actorType: 'ADMIN',
          action: 'order.note.created',
          resourceType: 'Order',
          resourceId: id,
          outcome: 'SUCCESS',
          requestId: request.requestId,
          ipAddress: this.ipAddress(request),
          userAgent: this.userAgent(request),
          afterSummary: { visibility: note.visibility },
        },
      });
      return {
        data: {
          id: note.id,
          authorUserId: note.authorUserId,
          visibility: note.visibility,
          body: note.body,
          createdAt: note.createdAt.toISOString(),
        },
      };
    });
  }

  private async lockOrder(transaction: Transaction, id: string): Promise<OrderOperationRecord> {
    const locked = await transaction.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM \`Order\` WHERE id = ${id} FOR UPDATE`,
    );
    if (locked.length !== 1) throw this.notFound();
    const order = await transaction.order.findUnique({
      where: { id },
      select: ORDER_OPERATION_SELECT,
    });
    if (!order) throw this.notFound();
    return order;
  }

  private async lockActiveInventory(
    transaction: Transaction,
    orderId: string,
  ): Promise<LockedInventory> {
    const lockedReservations = await transaction.$queryRaw<LockedReservationRow[]>(Prisma.sql`
      SELECT id, inventoryItemId
      FROM StockReservation
      WHERE orderId = ${orderId} AND state = ${'ACTIVE'}
      ORDER BY inventoryItemId ASC, id ASC
      FOR UPDATE
    `);
    const inventoryIds = [
      ...new Set(lockedReservations.map(({ inventoryItemId }) => inventoryItemId)),
    ].sort();
    if (inventoryIds.length > 0) {
      await transaction.$queryRaw(
        Prisma.sql`
          SELECT id
          FROM InventoryItem
          WHERE id IN (${Prisma.join(inventoryIds)})
          ORDER BY id ASC
          FOR UPDATE
        `,
      );
    }
    const reservationIds = lockedReservations.map(({ id }) => id);
    const [reservations, items] = await Promise.all([
      reservationIds.length === 0
        ? Promise.resolve([])
        : transaction.stockReservation.findMany({
            where: { id: { in: reservationIds }, state: 'ACTIVE' },
            orderBy: [{ inventoryItemId: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              inventoryItemId: true,
              orderItemId: true,
              quantity: true,
              expiresAt: true,
            },
          }),
      inventoryIds.length === 0
        ? Promise.resolve([])
        : transaction.inventoryItem.findMany({
            where: { id: { in: inventoryIds } },
            orderBy: { id: 'asc' },
            select: {
              id: true,
              variantId: true,
              locationId: true,
              batchId: true,
              onHandQuantity: true,
              version: true,
            },
          }),
    ]);
    if (reservations.length !== lockedReservations.length || items.length !== inventoryIds.length) {
      throw this.conflict(
        'RESERVATION_CONFLICT',
        'Reserved inventory changed while the order was being processed.',
      );
    }
    return { reservations, items };
  }

  private assertReservationCoverage(order: OrderOperationRecord, locked: LockedInventory): void {
    if (locked.reservations.length === 0 || order.items.length === 0) {
      throw this.conflict(
        'ORDER_RESERVATION_MISSING',
        'The order does not have complete active stock reservations.',
      );
    }
    const now = Date.now();
    const inventoryById = new Map(locked.items.map((item) => [item.id, item]));
    const reservedByOrderItem = new Map<string, number>();
    for (const reservation of locked.reservations) {
      const orderItem = order.items.find(({ id }) => id === reservation.orderItemId);
      const inventory = inventoryById.get(reservation.inventoryItemId);
      if (
        reservation.quantity <= 0 ||
        reservation.expiresAt.getTime() <= now ||
        !orderItem ||
        !orderItem.variantId ||
        inventory?.variantId !== orderItem.variantId
      ) {
        throw this.conflict(
          reservation.expiresAt.getTime() <= now
            ? 'ORDER_RESERVATION_EXPIRED'
            : 'ORDER_RESERVATION_INVALID',
          'The order stock reservation is no longer valid.',
        );
      }
      reservedByOrderItem.set(
        orderItem.id,
        (reservedByOrderItem.get(orderItem.id) ?? 0) + reservation.quantity,
      );
    }
    if (
      order.items.some((orderItem) => reservedByOrderItem.get(orderItem.id) !== orderItem.quantity)
    ) {
      throw this.conflict(
        'ORDER_RESERVATION_MISMATCH',
        'The order stock reservations do not match the immutable order quantities.',
      );
    }
  }

  private assertVersion(order: OrderOperationRecord, expectedVersion: number): void {
    if (order.version !== expectedVersion) {
      throw this.conflict('VERSION_CONFLICT', 'The order has changed. Refresh and try again.');
    }
  }

  private async createNotification(
    transaction: Transaction,
    order: OrderOperationRecord,
    event: NotificationEvent,
    scheduledAt: Date,
  ) {
    return createOrderNotificationsWithOutbox(transaction, this.crypto, {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        customerEmailSnapshot: order.customerEmailSnapshot,
        customerPhoneSnapshot: order.customerPhoneSnapshot,
        locale: order.customer?.locale === 'ar' ? 'ar-TN' : 'fr-TN',
      },
      event,
      scheduledAt,
    });
  }

  private async createLowStockAlerts(
    transaction: Transaction,
    variantIds: string[],
    now: Date,
  ): Promise<void> {
    if (variantIds.length === 0) return;
    const recipient = await transaction.storeSetting.findUnique({
      where: { key: 'notifications.low_stock_alert_email' },
      select: { value: true },
    });
    if (typeof recipient?.value !== 'string' || !recipient.value.trim()) return;

    const variants = await transaction.productVariant.findMany({
      where: { id: { in: variantIds } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        sku: true,
        nameFr: true,
        nameAr: true,
        lowStockThreshold: true,
        inventoryItems: {
          where: {
            location: { is: { active: true, fulfillsOrders: true } },
            OR: [
              { batchId: null },
              {
                batch: {
                  is: {
                    archivedAt: null,
                    OR: [{ expiryDate: null }, { expiryDate: { gt: now } }],
                  },
                },
              },
            ],
          },
          select: {
            onHandQuantity: true,
            reservations: {
              where: { state: 'ACTIVE', expiresAt: { gt: now } },
              select: { quantity: true },
            },
          },
        },
      },
    });
    const hourBucket = now.toISOString().slice(0, 13);
    for (const variant of variants) {
      const remainingQuantity = variant.inventoryItems.reduce(
        (total, item) =>
          total +
          item.onHandQuantity -
          item.reservations.reduce((reserved, reservation) => reserved + reservation.quantity, 0),
        0,
      );
      if (remainingQuantity > variant.lowStockThreshold) continue;
      await createOperationalAlertWithOutbox(transaction, this.crypto, {
        kind: 'low-stock',
        event: NotificationEvent.LOW_STOCK_ALERT,
        idempotencyKey: `low-stock-alert:${variant.id}:${hourBucket}`,
        payload: {
          sku: variant.sku,
          nameFr: variant.nameFr,
          nameAr: variant.nameAr,
          remainingQuantity,
          threshold: variant.lowStockThreshold,
          observedAt: now.toISOString(),
        },
        scheduledAt: now,
      });
    }
  }

  private createAudit(
    transaction: Transaction,
    input: {
      order: OrderOperationRecord;
      action: string;
      request: Request;
      before: Prisma.InputJsonValue;
      after: Prisma.InputJsonValue;
    },
  ) {
    return transaction.auditLog.create({
      data: {
        actorUserId: input.request.auth!.userId,
        actorType: 'ADMIN',
        action: input.action,
        resourceType: 'Order',
        resourceId: input.order.id,
        outcome: 'SUCCESS',
        requestId: input.request.requestId,
        ipAddress: this.ipAddress(input.request),
        userAgent: this.userAgent(input.request),
        beforeSummary: input.before,
        afterSummary: input.after,
      },
    });
  }

  private async requireDetail(
    transaction: Transaction,
    id: string,
  ): Promise<AdminOrderDetailRecord> {
    const order = await transaction.order.findUnique({
      where: { id },
      select: ADMIN_ORDER_DETAIL_SELECT,
    });
    if (!order) throw this.notFound();
    return order;
  }

  private serializeDetail(order: AdminOrderDetailRecord) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customerNameSnapshot,
      customerPhone: order.customerPhoneSnapshot,
      customerEmail: order.customerEmailSnapshot,
      status: order.status,
      paymentStatus: order.paymentStatus,
      currency: order.currency,
      deliveryMethodType: order.deliveryMethodType,
      deliveryMethod: order.deliveryMethodSnapshot,
      subtotalMillimes: order.subtotalMillimes,
      discountTotalMillimes: order.discountTotalMillimes,
      deliveryTotalMillimes: order.deliveryTotalMillimes,
      taxTotalMillimes: order.taxTotalMillimes,
      grandTotalMillimes: order.grandTotalMillimes,
      expectedCodMillimes: order.expectedCodMillimes,
      minimumAge: order.minimumAgeSnapshot,
      ageConfirmedAt: order.ageConfirmedAt?.toISOString() ?? null,
      ageVerificationAtDeliveryRequired: order.ageVerificationAtDeliveryRequired,
      deliveryInstructions: order.deliveryInstructions,
      preferredDeliveryDate: order.preferredDeliveryDate?.toISOString() ?? null,
      confirmedAt: order.confirmedAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      cancellationReason: order.cancellationReason,
      version: order.version,
      items: order.items.map((item) => ({
        id: item.id,
        productName: item.productNameSnapshot,
        variantName: item.variantNameSnapshot,
        sku: item.skuSnapshot,
        barcode: item.barcodeSnapshot,
        warningFr: item.warningSnapshotFr,
        warningAr: item.warningSnapshotAr,
        unitPriceMillimes: item.unitPriceMillimes,
        unitDiscountMillimes: item.unitDiscountMillimes,
        taxRateBps: item.taxRateBpsSnapshot,
        unitTaxMillimes: item.unitTaxMillimes,
        quantity: item.quantity,
        lineSubtotalMillimes: item.lineSubtotalMillimes,
        lineDiscountMillimes: item.lineDiscountMillimes,
        lineTaxMillimes: item.lineTaxMillimes,
        lineTotalMillimes: item.lineTotalMillimes,
      })),
      addresses: order.addressSnapshots.map((address) => ({
        id: address.id,
        type: address.type,
        fullName: address.fullName,
        phoneE164: address.phoneE164,
        governorateName: address.governorateName,
        delegationName: address.delegationName,
        localityName: address.localityName,
        postalCode: address.postalCode,
        street: address.street,
        building: address.building,
        floor: address.floor,
        apartment: address.apartment,
        landmark: address.landmark,
        instructions: address.instructions,
      })),
      history: order.statusHistory.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      })),
      notes: order.notes.map((note) => ({
        ...note,
        createdAt: note.createdAt.toISOString(),
      })),
      delivery: order.delivery
        ? {
            id: order.delivery.id,
            status: order.delivery.status,
            trackingNumber: order.delivery.trackingNumber,
            courier: order.delivery.courier,
            ageVerificationRequired: order.delivery.ageVerificationRequired,
            ageVerificationResult: order.delivery.ageVerificationResult,
            cashCollectedResult: order.delivery.cashCollectedResult,
            assignedAt: order.delivery.assignedAt?.toISOString() ?? null,
            handedToCourierAt: order.delivery.handedToCourierAt?.toISOString() ?? null,
            deliveredAt: order.delivery.deliveredAt?.toISOString() ?? null,
            nextAttemptAt: order.delivery.nextAttemptAt?.toISOString() ?? null,
            internalNotes: order.delivery.internalNotes,
            customerVisibleNotes: order.delivery.customerVisibleNotes,
            courierFeeMillimes: order.delivery.courierFeeMillimes,
            version: order.delivery.version,
            attempts: order.delivery.attempts.map((attempt) => ({
              ...attempt,
              attemptedAt: attempt.attemptedAt.toISOString(),
              nextAttemptAt: attempt.nextAttemptAt?.toISOString() ?? null,
            })),
            events: order.delivery.events.map((event) => ({
              ...event,
              occurredAt: event.occurredAt.toISOString(),
            })),
          }
        : null,
      cashCollections: order.cashCollections.map((collection) => ({
        ...collection,
        collectedAt: collection.collectedAt?.toISOString() ?? null,
        createdAt: collection.createdAt.toISOString(),
        updatedAt: collection.updatedAt.toISOString(),
      })),
      cashDiscrepancies: order.cashDiscrepancies.map((discrepancy) => ({
        ...discrepancy,
        openedAt: discrepancy.openedAt.toISOString(),
        resolvedAt: discrepancy.resolvedAt?.toISOString() ?? null,
      })),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  private serializeSlip(order: OrderSlipRecord) {
    const safe = (value: string | null): string | null =>
      value === null ? null : neutralizeCsvFormula(value);
    const address = order.addressSnapshots[0];
    return {
      documentType: 'ORDER_SLIP_JSON_V1' as const,
      generatedAt: new Date().toISOString(),
      orderNumber: safe(order.orderNumber)!,
      status: order.status,
      customerName: safe(order.customerNameSnapshot)!,
      customerPhone: order.customerPhoneSnapshot,
      address: address
        ? {
            type: address.type,
            fullName: safe(address.fullName),
            phoneE164: address.phoneE164,
            governorateName: safe(address.governorateName),
            delegationName: safe(address.delegationName),
            localityName: safe(address.localityName),
            postalCode: safe(address.postalCode),
            street: safe(address.street),
            building: safe(address.building),
            floor: safe(address.floor),
            apartment: safe(address.apartment),
            landmark: safe(address.landmark),
          }
        : null,
      items: order.items.map((item) => ({
        sku: safe(item.skuSnapshot)!,
        productName: safe(item.productNameSnapshot)!,
        variantName: safe(item.variantNameSnapshot)!,
        quantity: item.quantity,
        unitPriceMillimes: item.unitPriceMillimes,
        lineTotalMillimes: item.lineTotalMillimes,
      })),
      totals: {
        subtotalMillimes: order.subtotalMillimes,
        discountTotalMillimes: order.discountTotalMillimes,
        deliveryTotalMillimes: order.deliveryTotalMillimes,
        taxTotalMillimes: order.taxTotalMillimes,
        grandTotalMillimes: order.grandTotalMillimes,
        expectedCodMillimes: order.expectedCodMillimes,
      },
      currency: order.currency,
      deliveryMethod: safe(order.deliveryMethodSnapshot)!,
      deliveryInstructions: safe(order.deliveryInstructions),
      ageVerificationAtDeliveryRequired: order.ageVerificationAtDeliveryRequired,
    };
  }

  private ipAddress(request: Request): string {
    return (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45);
  }

  private userAgent(request: Request): string | null {
    return request.get('user-agent')?.slice(0, 512) ?? null;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'The order was not found.' });
  }

  private stateConflict(code: string): ConflictException {
    return this.conflict(code, 'The order cannot perform that transition from its current state.');
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
