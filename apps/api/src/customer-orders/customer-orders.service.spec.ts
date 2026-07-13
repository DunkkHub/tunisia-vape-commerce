import { ConflictException, NotFoundException } from '@nestjs/common';
import { CashCollectionStatus, DeliveryStatus, OrderStatus, PaymentStatus } from '@prisma/client';
import type { Request } from 'express';
import type { CryptoService } from '../common/security/crypto.service';
import type { PrismaService } from '../database/prisma.service';
import { describe, expect, it, vi } from 'vitest';
import { CustomerOrdersService } from './customer-orders.service';

const operationOrder = (status: OrderStatus = OrderStatus.PENDING_CONFIRMATION) => ({
  id: 'order-1',
  orderNumber: 'ORD-0001',
  customerPhoneSnapshot: '+21620111222',
  status,
  paymentStatus:
    status === OrderStatus.CANCELLED ? PaymentStatus.CANCELLED : PaymentStatus.CASH_EXPECTED,
  version: 3,
  customer: { locale: 'fr' },
  delivery: {
    id: 'delivery-1',
    status:
      status === OrderStatus.PENDING_CONFIRMATION
        ? DeliveryStatus.PENDING_CONFIRMATION
        : (status as unknown as DeliveryStatus),
    version: 2,
  },
  cashCollections: [{ id: 'cash-1', status: CashCollectionStatus.EXPECTED }],
});

const detailOrder = (status: OrderStatus = OrderStatus.PENDING_CONFIRMATION) => ({
  id: 'order-1',
  orderNumber: 'ORD-0001',
  customerNameSnapshot: 'Customer',
  customerPhoneSnapshot: '+21620111222',
  customerEmailSnapshot: 'customer@example.test',
  status,
  paymentStatus:
    status === OrderStatus.CANCELLED ? PaymentStatus.CANCELLED : PaymentStatus.CASH_EXPECTED,
  currency: 'TND',
  subtotalMillimes: 10_000,
  discountTotalMillimes: 0,
  deliveryTotalMillimes: 5_000,
  taxTotalMillimes: 0,
  grandTotalMillimes: 15_000,
  expectedCodMillimes: 15_000,
  deliveryMethodType: 'COURIER',
  deliveryMethodSnapshot: 'Courier',
  confirmedAt: null,
  cancelledAt: status === OrderStatus.CANCELLED ? new Date('2026-07-13T01:00:00Z') : null,
  cancellationReason: status === OrderStatus.CANCELLED ? 'Customer request' : null,
  version: status === OrderStatus.CANCELLED ? 4 : 3,
  createdAt: new Date('2026-07-13T00:00:00Z'),
  updatedAt: new Date('2026-07-13T01:00:00Z'),
  items: [],
  addressSnapshots: [],
  statusHistory: [],
  notes: [],
  consentSnapshots: [],
  discounts: [],
  delivery: {
    id: 'delivery-1',
    status:
      status === OrderStatus.CANCELLED
        ? DeliveryStatus.CANCELLED
        : DeliveryStatus.PENDING_CONFIRMATION,
    trackingNumber: null,
    ageVerificationResult: 'PENDING',
    customerVisibleNotes: null,
    assignedAt: null,
    handedToCourierAt: null,
    deliveredAt: null,
    nextAttemptAt: null,
    courier: null,
    attempts: [],
    events: [],
  },
  cashCollections: [
    {
      id: 'cash-1',
      status:
        status === OrderStatus.CANCELLED
          ? CashCollectionStatus.VOIDED
          : CashCollectionStatus.EXPECTED,
      expectedMillimes: 15_000,
      collectedMillimes: 0,
      collectedAt: null,
    },
  ],
});

const request = {
  auth: { userId: 'user-a' },
  requestId: 'request-1',
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
  get: vi.fn().mockReturnValue('test-agent'),
} as unknown as Request;

const crypto = {
  hashToken: vi.fn().mockReturnValue('recipient-hash'),
  encrypt: vi.fn().mockReturnValue('encrypted-recipient'),
} as unknown as CryptoService;

const successfulTransaction = () => {
  const inventoryUpdate = vi.fn();
  const transaction = {
    order: {
      findFirst: vi
        .fn()
        .mockResolvedValueOnce({ id: 'order-1' })
        .mockResolvedValueOnce(operationOrder())
        .mockResolvedValueOnce(detailOrder(OrderStatus.CANCELLED)),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ id: 'order-1' }])
      .mockResolvedValueOnce([{ id: 'reservation-1', inventoryItemId: 'inventory-1' }])
      .mockResolvedValueOnce([{ id: 'inventory-1' }]),
    stockReservation: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 'reservation-1', inventoryItemId: 'inventory-1', quantity: 1 }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryItem: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'inventory-1',
          locationId: 'location-1',
          batchId: null,
          onHandQuantity: 7,
        },
      ]),
      updateMany: inventoryUpdate,
    },
    stockMovement: { create: vi.fn().mockResolvedValue({}) },
    cashCollection: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    delivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
    deliveryEvent: { create: vi.fn().mockResolvedValue({}) },
    notification: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  } as unknown as PrismaService;
  return { service: new CustomerOrdersService(prisma, crypto), transaction, inventoryUpdate };
};

describe('customer-owned order service', () => {
  it('enforces ownership inside the detail query and selects no internal notes or actor metadata', async () => {
    interface DetailQuery {
      where: { customer: { is: { userId: string } } };
      select: {
        notes: { where: { visibility: string } };
        delivery: {
          select: {
            internalNotes?: unknown;
            attempts: { select: { notes?: unknown } };
            events: { select: { actorUserId?: unknown } };
          };
        };
      };
    }
    const findFirst = vi
      .fn<(query: DetailQuery) => Promise<ReturnType<typeof detailOrder>>>()
      .mockResolvedValue(detailOrder());
    const service = new CustomerOrdersService(
      { order: { findFirst } } as unknown as PrismaService,
      crypto,
    );

    await service.get('user-a', 'ORD-0001');
    const query = findFirst.mock.calls[0]![0];
    expect(query.where.customer.is.userId).toBe('user-a');
    expect(query.select.notes.where).toEqual({ visibility: 'CUSTOMER_VISIBLE' });
    expect(query.select.delivery.select).not.toHaveProperty('internalNotes');
    expect(query.select.delivery.select.attempts.select).not.toHaveProperty('notes');
    expect(query.select.delivery.select.events.select).not.toHaveProperty('actorUserId');
  });

  it('returns the same not-found response for another customer in reads and cancellation', async () => {
    const readService = new CustomerOrdersService(
      { order: { findFirst: vi.fn().mockResolvedValue(null) } } as unknown as PrismaService,
      crypto,
    );
    const readError = await readService.get('user-b', 'ORD-0001').catch((error: unknown) => error);

    const transaction = {
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn(),
    };
    const cancelService = new CustomerOrdersService(
      {
        $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
          callback(transaction),
        ),
      } as unknown as PrismaService,
      crypto,
    );
    const cancelError = await cancelService
      .cancel(
        'user-b',
        'ORD-0001',
        {
          expectedVersion: 3,
          confirmed: true,
          confirmation: 'CANCEL_ORDER',
          reason: 'Customer request',
        },
        request,
      )
      .catch((error: unknown) => error);

    expect(readError).toBeInstanceOf(NotFoundException);
    expect(cancelError).toBeInstanceOf(NotFoundException);
    expect((readError as NotFoundException).getResponse()).toEqual(
      (cancelError as NotFoundException).getResponse(),
    );
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects delivered cancellation before locking or changing reservations', async () => {
    const transaction = {
      order: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: 'order-1' })
          .mockResolvedValueOnce(operationOrder(OrderStatus.DELIVERED)),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'order-1' }]),
      stockReservation: { updateMany: vi.fn() },
    };
    const service = new CustomerOrdersService(
      {
        $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
          callback(transaction),
        ),
      } as unknown as PrismaService,
      crypto,
    );

    const error = await service
      .cancel(
        'user-a',
        'ORD-0001',
        {
          expectedVersion: 3,
          confirmed: true,
          confirmation: 'CANCEL_ORDER',
          reason: 'Customer request',
        },
        request,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'ORDER_CANCELLATION_NOT_ALLOWED',
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.stockReservation.updateMany).not.toHaveBeenCalled();
  });

  it('releases active reservations once, preserves on-hand, and closes delivery and COD atomically', async () => {
    const { service, transaction, inventoryUpdate } = successfulTransaction();

    const result = await service.cancel(
      'user-a',
      'ORD-0001',
      {
        expectedVersion: 3,
        confirmed: true,
        confirmation: 'CANCEL_ORDER',
        reason: 'Customer request',
      },
      request,
    );

    const reservationUpdate = transaction.stockReservation.updateMany.mock.calls[0]![0] as {
      data: { state: string; activeKey: null };
    };
    expect(reservationUpdate.data).toMatchObject({ state: 'RELEASED', activeKey: null });
    expect(inventoryUpdate).not.toHaveBeenCalled();
    const movement = transaction.stockMovement.create.mock.calls[0]![0] as {
      data: { type: string; quantityDelta: number; onHandAfter: number };
    };
    expect(movement.data).toMatchObject({
      type: 'RESERVATION_RELEASE',
      quantityDelta: 0,
      onHandAfter: 7,
    });
    expect(transaction.cashCollection.updateMany).toHaveBeenCalledWith({
      where: { id: 'cash-1', status: 'EXPECTED' },
      data: { status: 'VOIDED' },
    });
    const orderUpdate = transaction.order.updateMany.mock.calls[0]![0] as {
      data: { status: string; paymentStatus: string };
    };
    expect(orderUpdate.data).toMatchObject({ status: 'CANCELLED', paymentStatus: 'CANCELLED' });
    const deliveryUpdate = transaction.delivery.updateMany.mock.calls[0]![0] as {
      data: { status: string; version: { increment: number } };
    };
    expect(deliveryUpdate.data).toEqual({ status: 'CANCELLED', version: { increment: 1 } });
    const audit = transaction.auditLog.create.mock.calls[0]![0] as {
      data: { actorType: string; actorUserId: string };
    };
    expect(audit.data).toMatchObject({ actorType: 'CUSTOMER', actorUserId: 'user-a' });
    const notification = transaction.notification.create.mock.calls[0]![0] as {
      data: { event: string; orderId: string };
    };
    expect(notification.data).toMatchObject({ event: 'ORDER_CANCELLED', orderId: 'order-1' });
    expect(result.data.status).toBe(OrderStatus.CANCELLED);
  });
});
