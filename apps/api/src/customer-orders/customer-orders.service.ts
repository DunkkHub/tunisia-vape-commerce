import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CashCollectionStatus,
  DeliveryStatus,
  NotificationChannel,
  NotificationEvent,
  OrderStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import type { Request } from 'express';
import { CryptoService } from '../common/security/crypto.service';
import { PrismaService } from '../database/prisma.service';
import { canCustomerCancelOrder } from './customer-order-policy';
import type { CustomerCancelOrderDto, CustomerOrderListQueryDto } from './dto/customer-order.dto';

const CUSTOMER_ORDER_DETAIL_SELECT = {
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
      warningSnapshotFr: true,
      warningSnapshotAr: true,
      unitPriceMillimes: true,
      unitDiscountMillimes: true,
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
    select: { id: true, fromStatus: true, toStatus: true, createdAt: true },
  },
  notes: {
    where: { visibility: 'CUSTOMER_VISIBLE' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, body: true, createdAt: true },
  },
  consentSnapshots: {
    orderBy: [{ consentedAt: 'asc' }, { id: 'asc' }],
    select: {
      consentType: true,
      granted: true,
      documentTitleSnapshot: true,
      documentVersionSnapshot: true,
      contentHashSnapshot: true,
      consentedAt: true,
    },
  },
  discounts: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      nameSnapshot: true,
      codeSnapshot: true,
      amountMillimes: true,
    },
  },
  delivery: {
    select: {
      id: true,
      status: true,
      trackingNumber: true,
      ageVerificationResult: true,
      customerVisibleNotes: true,
      assignedAt: true,
      handedToCourierAt: true,
      deliveredAt: true,
      nextAttemptAt: true,
      courier: { select: { name: true } },
      attempts: {
        orderBy: [{ attemptedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          attemptNumber: true,
          attemptedAt: true,
          outcome: true,
          nextAttemptAt: true,
          ageVerificationResult: true,
        },
      },
      events: {
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        select: { id: true, fromStatus: true, toStatus: true, occurredAt: true },
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
      collectedAt: true,
    },
  },
} as const satisfies Prisma.OrderSelect;

const CUSTOMER_ORDER_OPERATION_SELECT = {
  id: true,
  orderNumber: true,
  customerPhoneSnapshot: true,
  status: true,
  paymentStatus: true,
  version: true,
  customer: { select: { locale: true } },
  delivery: { select: { id: true, status: true, version: true } },
  cashCollections: { select: { id: true, status: true } },
} as const satisfies Prisma.OrderSelect;

type CustomerOrderDetailRecord = Prisma.OrderGetPayload<{
  select: typeof CUSTOMER_ORDER_DETAIL_SELECT;
}>;
type CustomerOrderOperationRecord = Prisma.OrderGetPayload<{
  select: typeof CUSTOMER_ORDER_OPERATION_SELECT;
}>;
type Transaction = Prisma.TransactionClient;

interface LockedReservationRow {
  id: string;
  inventoryItemId: string;
}

interface LockedReservation {
  id: string;
  inventoryItemId: string;
  quantity: number;
}

interface LockedInventoryItem {
  id: string;
  locationId: string;
  batchId: string | null;
  onHandQuantity: number;
}

@Injectable()
export class CustomerOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async list(userId: string, query: CustomerOrderListQueryDto) {
    const where: Prisma.OrderWhereInput = {
      ...this.ownedWhere(userId),
      ...(query.status ? { status: query.status } : {}),
    };
    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: [
          { createdAt: query.sort === 'oldest' ? 'asc' : 'desc' },
          { id: query.sort === 'oldest' ? 'asc' : 'desc' },
        ],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          currency: true,
          grandTotalMillimes: true,
          version: true,
          createdAt: true,
          delivery: { select: { status: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      data: {
        items: orders.map((order) => this.serializeSummary(order)),
        page: query.page,
        pageSize: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async get(userId: string, orderNumber: string) {
    const order = await this.prisma.order.findFirst({
      where: { orderNumber, ...this.ownedWhere(userId) },
      select: CUSTOMER_ORDER_DETAIL_SELECT,
    });
    if (!order) throw this.notFound();
    return { data: this.serializeDetail(order) };
  }

  async cancel(
    userId: string,
    orderNumber: string,
    input: CustomerCancelOrderDto,
    request: Request,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const order = await this.lockOwnedOrder(transaction, userId, orderNumber);
      if (order.version !== input.expectedVersion) {
        throw this.conflict('VERSION_CONFLICT', 'The order has changed. Refresh and try again.');
      }
      if (!canCustomerCancelOrder(order.status)) {
        throw this.conflict(
          'ORDER_CANCELLATION_NOT_ALLOWED',
          'The order can no longer be cancelled online.',
        );
      }
      if (!order.delivery || order.delivery.status !== DeliveryStatus.PENDING_CONFIRMATION) {
        throw this.conflict(
          'DELIVERY_CANCELLATION_NOT_ALLOWED',
          'The delivery can no longer be cancelled online.',
        );
      }
      if (
        order.paymentStatus !== PaymentStatus.PAYMENT_PENDING &&
        order.paymentStatus !== PaymentStatus.CASH_EXPECTED
      ) {
        throw this.conflict(
          'ORDER_CASH_ALREADY_COLLECTED',
          'The order can no longer be cancelled online.',
        );
      }
      if (
        order.cashCollections.length !== 1 ||
        order.cashCollections[0]?.status !== CashCollectionStatus.EXPECTED
      ) {
        throw this.conflict(
          'ORDER_COD_STATE_INVALID',
          'The order cash state does not permit cancellation.',
        );
      }

      const locked = await this.lockActiveReservationsAndInventory(transaction, order.id);
      const now = new Date();
      const reason = input.reason.trim();
      const userAgent = this.userAgent(request);
      if (locked.reservations.length > 0) {
        const released = await transaction.stockReservation.updateMany({
          where: {
            id: { in: locked.reservations.map(({ id }) => id) },
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
            'Reserved stock changed while the order was being cancelled.',
          );
        }
        const inventoryById = new Map(locked.inventory.map((item) => [item.id, item]));
        for (const reservation of locked.reservations) {
          const inventory = inventoryById.get(reservation.inventoryItemId);
          if (!inventory || reservation.quantity <= 0 || inventory.onHandQuantity < 0) {
            throw this.conflict(
              'INVENTORY_INVARIANT_BREACH',
              'Reserved stock cannot be released safely.',
            );
          }
          await transaction.stockMovement.create({
            data: {
              inventoryItemId: inventory.id,
              locationId: inventory.locationId,
              batchId: inventory.batchId,
              type: 'RESERVATION_RELEASE',
              quantityDelta: 0,
              onHandAfter: inventory.onHandQuantity,
              referenceType: 'Order',
              referenceId: order.id,
              reasonCode: 'CUSTOMER_CANCELLED',
              note: reason,
              actorUserId: userId,
              requestId: request.requestId,
            },
          });
        }
      }

      const cashVoided = await transaction.cashCollection.updateMany({
        where: { id: order.cashCollections[0].id, status: CashCollectionStatus.EXPECTED },
        data: { status: CashCollectionStatus.VOIDED },
      });
      const orderUpdated = await transaction.order.updateMany({
        where: {
          id: order.id,
          customer: { is: { userId } },
          status: order.status,
          version: input.expectedVersion,
        },
        data: {
          status: OrderStatus.CANCELLED,
          paymentStatus: PaymentStatus.CANCELLED,
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
        data: { status: DeliveryStatus.CANCELLED, version: { increment: 1 } },
      });
      if (cashVoided.count !== 1 || orderUpdated.count !== 1 || deliveryUpdated.count !== 1) {
        throw this.conflict('VERSION_CONFLICT', 'The order changed before it could be cancelled.');
      }

      await Promise.all([
        transaction.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: OrderStatus.CANCELLED,
            reasonCode: 'CUSTOMER_CANCELLED',
            note: reason,
            changedByUserId: userId,
            requestId: request.requestId,
          },
        }),
        transaction.deliveryEvent.create({
          data: {
            deliveryId: order.delivery.id,
            fromStatus: order.delivery.status,
            toStatus: DeliveryStatus.CANCELLED,
            actorUserId: userId,
            source: 'CUSTOMER_SELF_SERVICE',
            reasonCode: 'CUSTOMER_CANCELLED',
            note: reason,
            requestId: request.requestId,
          },
        }),
        transaction.notification.create({
          data: {
            orderId: order.id,
            idempotencyKey: `order:${order.id}:customer_cancelled`,
            event: NotificationEvent.ORDER_CANCELLED,
            channel: NotificationChannel.SMS,
            recipientHash: this.crypto.hashToken(order.customerPhoneSnapshot),
            encryptedRecipient: this.crypto.encrypt(order.customerPhoneSnapshot),
            locale: order.customer?.locale === 'ar' ? 'ar-TN' : 'fr-TN',
            payload: { orderNumber: order.orderNumber },
            scheduledAt: now,
          },
        }),
        transaction.auditLog.create({
          data: {
            actorUserId: userId,
            actorType: 'CUSTOMER',
            action: 'customer.order.cancelled',
            resourceType: 'Order',
            resourceId: order.id,
            outcome: 'SUCCESS',
            requestId: request.requestId,
            ipAddress: this.ipAddress(request),
            ...(userAgent ? { userAgent } : {}),
            beforeSummary: {
              status: order.status,
              paymentStatus: order.paymentStatus,
              version: order.version,
            },
            afterSummary: {
              status: OrderStatus.CANCELLED,
              paymentStatus: PaymentStatus.CANCELLED,
              version: order.version + 1,
              reasonProvided: true,
            },
          },
        }),
      ]);

      const detail = await transaction.order.findFirst({
        where: { id: order.id, ...this.ownedWhere(userId) },
        select: CUSTOMER_ORDER_DETAIL_SELECT,
      });
      if (!detail) throw this.notFound();
      return { data: this.serializeDetail(detail) };
    });
  }

  private async lockOwnedOrder(
    transaction: Transaction,
    userId: string,
    orderNumber: string,
  ): Promise<CustomerOrderOperationRecord> {
    const owned = await transaction.order.findFirst({
      where: { orderNumber, ...this.ownedWhere(userId) },
      select: { id: true },
    });
    if (!owned) throw this.notFound();
    // `Order` is a reserved identifier. Prisma.raw is used only for this reviewed constant; the
    // order ID remains parameter-bound. The lock closes the state/version race before cancellation.
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM ${Prisma.raw('`Order`')} WHERE id = ${owned.id} FOR UPDATE
    `);
    const order = await transaction.order.findFirst({
      where: { id: owned.id, ...this.ownedWhere(userId) },
      select: CUSTOMER_ORDER_OPERATION_SELECT,
    });
    if (!order) throw this.notFound();
    return order;
  }

  private async lockActiveReservationsAndInventory(transaction: Transaction, orderId: string) {
    const lockedRows = await transaction.$queryRaw<LockedReservationRow[]>(Prisma.sql`
      SELECT id, inventoryItemId
      FROM StockReservation
      WHERE orderId = ${orderId} AND state = ${'ACTIVE'}
      ORDER BY inventoryItemId ASC, id ASC
      FOR UPDATE
    `);
    const inventoryIds = [
      ...new Set(lockedRows.map(({ inventoryItemId }) => inventoryItemId)),
    ].sort();
    if (inventoryIds.length > 0) {
      await transaction.$queryRaw(Prisma.sql`
        SELECT id FROM InventoryItem
        WHERE id IN (${Prisma.join(inventoryIds)})
        ORDER BY id ASC
        FOR UPDATE
      `);
    }
    const reservationIds = lockedRows.map(({ id }) => id);
    const [reservations, inventory] = await Promise.all([
      reservationIds.length === 0
        ? Promise.resolve([] as LockedReservation[])
        : transaction.stockReservation.findMany({
            where: { id: { in: reservationIds }, state: 'ACTIVE' },
            orderBy: [{ inventoryItemId: 'asc' }, { id: 'asc' }],
            select: { id: true, inventoryItemId: true, quantity: true },
          }),
      inventoryIds.length === 0
        ? Promise.resolve([] as LockedInventoryItem[])
        : transaction.inventoryItem.findMany({
            where: { id: { in: inventoryIds } },
            orderBy: { id: 'asc' },
            select: {
              id: true,
              locationId: true,
              batchId: true,
              onHandQuantity: true,
            },
          }),
    ]);
    if (reservations.length !== lockedRows.length || inventory.length !== inventoryIds.length) {
      throw this.conflict(
        'RESERVATION_CONFLICT',
        'Reserved stock changed while the order was being cancelled.',
      );
    }
    return { reservations, inventory };
  }

  private ownedWhere(userId: string): Prisma.OrderWhereInput {
    return {
      customer: {
        is: {
          userId,
          suspendedAt: null,
          user: { is: { audience: 'CUSTOMER', status: 'ACTIVE' } },
        },
      },
    };
  }

  private serializeSummary(order: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    currency: string;
    grandTotalMillimes: number;
    version: number;
    createdAt: Date;
    delivery: { status: DeliveryStatus } | null;
  }) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      deliveryStatus: order.delivery?.status ?? null,
      grandTotalMillimes: order.grandTotalMillimes,
      currency: order.currency,
      cancellable: canCustomerCancelOrder(order.status),
      version: order.version,
      createdAt: order.createdAt.toISOString(),
    };
  }

  private serializeDetail(order: CustomerOrderDetailRecord) {
    return {
      ...this.serializeSummary(order),
      customerName: order.customerNameSnapshot,
      customerPhone: order.customerPhoneSnapshot,
      customerEmail: order.customerEmailSnapshot,
      deliveryMethodType: order.deliveryMethodType,
      deliveryMethod: order.deliveryMethodSnapshot,
      subtotalMillimes: order.subtotalMillimes,
      discountTotalMillimes: order.discountTotalMillimes,
      deliveryTotalMillimes: order.deliveryTotalMillimes,
      taxTotalMillimes: order.taxTotalMillimes,
      expectedCodMillimes: order.expectedCodMillimes,
      items: order.items.map((item) => ({
        id: item.id,
        productName: item.productNameSnapshot,
        variantName: item.variantNameSnapshot,
        sku: item.skuSnapshot,
        warningFr: item.warningSnapshotFr,
        warningAr: item.warningSnapshotAr,
        unitPriceMillimes: item.unitPriceMillimes,
        unitDiscountMillimes: item.unitDiscountMillimes,
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
        phone: address.phoneE164,
        governorate: address.governorateName,
        delegation: address.delegationName,
        locality: address.localityName,
        postalCode: address.postalCode,
        street: address.street,
        building: address.building,
        floor: address.floor,
        apartment: address.apartment,
        landmark: address.landmark,
        instructions: address.instructions,
      })),
      history: order.statusHistory.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        occurredAt: entry.createdAt.toISOString(),
      })),
      customerVisibleNotes: order.notes.map((note) => ({
        id: note.id,
        body: note.body,
        createdAt: note.createdAt.toISOString(),
      })),
      delivery: order.delivery
        ? {
            id: order.delivery.id,
            status: order.delivery.status,
            trackingNumber: order.delivery.trackingNumber,
            courierName: order.delivery.courier?.name ?? null,
            ageVerificationResult: order.delivery.ageVerificationResult,
            customerVisibleNotes: order.delivery.customerVisibleNotes,
            assignedAt: order.delivery.assignedAt?.toISOString() ?? null,
            handedToCourierAt: order.delivery.handedToCourierAt?.toISOString() ?? null,
            deliveredAt: order.delivery.deliveredAt?.toISOString() ?? null,
            nextAttemptAt: order.delivery.nextAttemptAt?.toISOString() ?? null,
            attempts: order.delivery.attempts.map((attempt) => ({
              id: attempt.id,
              attemptNumber: attempt.attemptNumber,
              outcome: attempt.outcome,
              ageVerificationResult: attempt.ageVerificationResult,
              attemptedAt: attempt.attemptedAt.toISOString(),
              nextAttemptAt: attempt.nextAttemptAt?.toISOString() ?? null,
            })),
            events: order.delivery.events.map((event) => ({
              id: event.id,
              fromStatus: event.fromStatus,
              toStatus: event.toStatus,
              occurredAt: event.occurredAt.toISOString(),
            })),
          }
        : null,
      consents: order.consentSnapshots.map((consent) => ({
        type: consent.consentType,
        granted: consent.granted,
        documentTitle: consent.documentTitleSnapshot,
        documentVersion: consent.documentVersionSnapshot,
        contentHash: consent.contentHashSnapshot,
        consentedAt: consent.consentedAt.toISOString(),
      })),
      discounts: order.discounts.map((discount) => ({
        id: discount.id,
        name: discount.nameSnapshot,
        code: discount.codeSnapshot,
        amountMillimes: discount.amountMillimes,
      })),
      codCollections: order.cashCollections.map((collection) => ({
        id: collection.id,
        status: collection.status,
        expectedMillimes: collection.expectedMillimes,
        collectedMillimes: collection.collectedMillimes,
        collectedAt: collection.collectedAt?.toISOString() ?? null,
      })),
      confirmedAt: order.confirmedAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      cancellationReason: order.cancellationReason,
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'ORDER_NOT_FOUND',
      message: 'The requested order was not found.',
    });
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }

  private ipAddress(request: Request): string {
    return (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45);
  }

  private userAgent(request: Request): string | undefined {
    return request.get('user-agent')?.slice(0, 512);
  }
}
