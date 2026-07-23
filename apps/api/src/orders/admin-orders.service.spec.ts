import { OrderStatus } from '@prisma/client';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../common/security/crypto.service';
import type { PrismaService } from '../database/prisma.service';
import { AdminOrdersService } from './admin-orders.service';

const request = {
  auth: { userId: 'admin-id' },
  requestId: 'request-id',
  ip: '127.0.0.1',
  socket: {},
  get: vi.fn().mockReturnValue('vitest'),
} as unknown as Request;

const operationOrder = (status: OrderStatus = OrderStatus.PENDING_CONFIRMATION) => ({
  id: 'order-id',
  orderNumber: 'TN-000001',
  customerPhoneSnapshot: '+21620111222',
  customerEmailSnapshot: 'customer@example.test',
  status,
  paymentStatus: 'CASH_EXPECTED',
  version: 3,
  customer: { locale: 'fr' },
  delivery: { id: 'delivery-id', status, version: 2 },
  items: [{ id: 'order-item-id', variantId: 'variant-id', quantity: 2 }],
  cashCollections: [{ id: 'cash-id', status: 'EXPECTED' }],
});

const detailOrder = (status: OrderStatus) => ({
  id: 'order-id',
  orderNumber: 'TN-000001',
  customerNameSnapshot: 'Customer',
  customerPhoneSnapshot: '+21620111222',
  customerEmailSnapshot: null,
  status,
  paymentStatus: status === OrderStatus.CANCELLED ? 'CANCELLED' : 'CASH_EXPECTED',
  currency: 'TND',
  subtotalMillimes: 10_000,
  discountTotalMillimes: 0,
  deliveryTotalMillimes: 2_000,
  taxTotalMillimes: 0,
  grandTotalMillimes: 12_000,
  expectedCodMillimes: 12_000,
  deliveryMethodType: 'COURIER',
  deliveryMethodSnapshot: 'Courier delivery',
  preferredDeliveryDate: null,
  deliveryInstructions: null,
  ageConfirmedAt: new Date('2026-07-13T08:00:00.000Z'),
  minimumAgeSnapshot: 18,
  ageVerificationAtDeliveryRequired: true,
  confirmedAt: status === OrderStatus.CONFIRMED ? new Date('2026-07-13T09:00:00.000Z') : null,
  cancelledAt: status === OrderStatus.CANCELLED ? new Date('2026-07-13T09:00:00.000Z') : null,
  cancellationReason: status === OrderStatus.CANCELLED ? 'Customer requested cancellation.' : null,
  version: 4,
  createdAt: new Date('2026-07-13T08:00:00.000Z'),
  updatedAt: new Date('2026-07-13T09:00:00.000Z'),
  items: [],
  addressSnapshots: [],
  statusHistory: [],
  notes: [],
  delivery: {
    id: 'delivery-id',
    status,
    trackingNumber: null,
    ageVerificationRequired: true,
    ageVerificationResult: 'PENDING',
    cashCollectedResult: null,
    assignedAt: null,
    handedToCourierAt: null,
    deliveredAt: null,
    nextAttemptAt: null,
    internalNotes: null,
    customerVisibleNotes: null,
    courierFeeMillimes: null,
    version: 3,
    courier: null,
    attempts: [],
    events: [],
  },
  cashCollections: [],
  cashDiscrepancies: [],
});

const crypto = {
  hashToken: vi.fn().mockReturnValue('a'.repeat(64)),
  encrypt: vi.fn().mockReturnValue('encrypted-recipient'),
} as unknown as CryptoService;

const successfulTransaction = (targetStatus: OrderStatus) => {
  const inventoryUpdate = vi.fn().mockResolvedValue({ count: 1 });
  const transaction = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ id: 'order-id' }])
      .mockResolvedValueOnce([{ id: 'reservation-id', inventoryItemId: 'inventory-id' }])
      .mockResolvedValueOnce([{ id: 'inventory-id' }]),
    order: {
      findUnique: vi
        .fn()
        .mockResolvedValueOnce(operationOrder())
        .mockResolvedValueOnce(detailOrder(targetStatus)),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    stockReservation: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'reservation-id',
          inventoryItemId: 'inventory-id',
          orderItemId: 'order-item-id',
          quantity: 2,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryItem: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'inventory-id',
          variantId: 'variant-id',
          locationId: 'location-id',
          batchId: null,
          onHandQuantity: 5,
          version: 7,
        },
      ]),
      updateMany: inventoryUpdate,
    },
    stockMovement: { create: vi.fn().mockResolvedValue({}) },
    storeSetting: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    productVariant: { findMany: vi.fn().mockResolvedValue([]) },
    delivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    cashCollection: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
    deliveryEvent: { create: vi.fn().mockResolvedValue({}) },
    notification: {
      create: vi.fn().mockResolvedValue({
        id: 'notification-id',
        channel: 'EMAIL',
        event: 'ORDER_CONFIRMED',
      }),
      upsert: vi.fn().mockResolvedValue({
        id: 'low-stock-notification-id',
        channel: 'EMAIL',
        event: 'LOW_STOCK_ALERT',
      }),
    },
    outboxEvent: {
      create: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) =>
      Promise.resolve(callback(transaction)),
    ),
  } as unknown as PrismaService;
  return { service: new AdminOrdersService(prisma, crypto), transaction, inventoryUpdate };
};

describe('administrator order intake service', () => {
  it('confirms once, decrements locked stock, consumes reservations, and appends records', async () => {
    const { service, transaction, inventoryUpdate } = successfulTransaction(OrderStatus.CONFIRMED);

    await expect(
      service.confirm('order-id', { expectedVersion: 3, confirmed: true }, request),
    ).resolves.toMatchObject({ data: { id: 'order-id', status: 'CONFIRMED', version: 4 } });
    const inventoryCall = inventoryUpdate.mock.calls[0]?.[0] as {
      where: { id: string; version: number };
      data: { onHandQuantity: { decrement: number }; version: { increment: number } };
    };
    expect(inventoryCall).toMatchObject({
      where: { id: 'inventory-id', version: 7 },
      data: { onHandQuantity: { decrement: 2 }, version: { increment: 1 } },
    });
    const movementCall = transaction.stockMovement.create.mock.calls[0]?.[0] as {
      data: { type: string; quantityDelta: number; onHandAfter: number };
    };
    expect(movementCall.data).toMatchObject({
      type: 'ORDER_CONFIRMED',
      quantityDelta: -2,
      onHandAfter: 3,
    });
    const consumeCall = transaction.stockReservation.updateMany.mock.calls[0]?.[0] as {
      data: { state: string; activeKey: null };
    };
    expect(consumeCall.data).toMatchObject({ state: 'CONSUMED', activeKey: null });
    expect(transaction.notification.create).toHaveBeenCalledOnce();
    expect(transaction.outboxEvent.create).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });

  it('rejects repeated confirmation before any inventory mutation', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'order-id' }]),
      order: { findUnique: vi.fn().mockResolvedValue(operationOrder(OrderStatus.CONFIRMED)) },
      inventoryItem: { updateMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    } as unknown as PrismaService;
    const service = new AdminOrdersService(prisma, crypto);

    await expect(
      service.confirm('order-id', { expectedVersion: 3, confirmed: true }, request),
    ).rejects.toMatchObject({ response: { code: 'ORDER_CONFIRMATION_NOT_ALLOWED' } });
    expect(transaction.inventoryItem.updateMany).not.toHaveBeenCalled();
  });

  it('rejects confirmation that would make physical stock negative', async () => {
    const { service, transaction, inventoryUpdate } = successfulTransaction(OrderStatus.CONFIRMED);
    transaction.inventoryItem.findMany.mockResolvedValueOnce([
      {
        id: 'inventory-id',
        variantId: 'variant-id',
        locationId: 'location-id',
        batchId: null,
        onHandQuantity: 1,
        version: 7,
      },
    ]);

    await expect(
      service.confirm('order-id', { expectedVersion: 3, confirmed: true }, request),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_STOCK' } });
    expect(inventoryUpdate).not.toHaveBeenCalled();
    expect(transaction.stockReservation.updateMany).not.toHaveBeenCalled();
  });

  it('coalesces an email alert when confirmed stock is at or below its threshold', async () => {
    const { service, transaction } = successfulTransaction(OrderStatus.CONFIRMED);
    transaction.storeSetting.findUnique.mockImplementation(
      ({ where }: { where: { key: string } }) =>
        Promise.resolve({
          value: where.key === 'notifications.low_stock_alert_email' ? 'stock@example.test' : false,
        }),
    );
    transaction.storeSetting.findMany.mockResolvedValue([
      { key: 'notifications.low_stock_alert_email', value: 'stock@example.test' },
      { key: 'notifications.operational_alert_locale', value: 'fr' },
    ]);
    transaction.productVariant.findMany.mockResolvedValue([
      {
        id: 'variant-id',
        sku: 'SKU-1',
        nameFr: 'Menthe',
        nameAr: 'نعناع',
        lowStockThreshold: 3,
        inventoryItems: [{ onHandQuantity: 3, reservations: [{ quantity: 1 }] }],
      },
    ]);

    await service.confirm('order-id', { expectedVersion: 3, confirmed: true }, request);

    const alert = transaction.notification.upsert.mock.calls[0]![0] as {
      create: { event: string; channel: string; payload: Record<string, unknown> };
    };
    expect(alert.create).toMatchObject({
      event: 'LOW_STOCK_ALERT',
      channel: 'EMAIL',
      payload: { sku: 'SKU-1', remainingQuantity: 2, threshold: 3 },
    });
    expect(JSON.stringify(transaction.outboxEvent.upsert.mock.calls)).not.toContain(
      'stock@example.test',
    );
  });

  it('cancels an early order, releases reservations, voids cash, and does not alter on-hand', async () => {
    const { service, transaction, inventoryUpdate } = successfulTransaction(OrderStatus.CANCELLED);

    await expect(
      service.cancel(
        'order-id',
        {
          expectedVersion: 3,
          confirmed: true,
          confirmation: 'CANCEL_ORDER',
          reason: 'Customer requested cancellation.',
        },
        request,
      ),
    ).resolves.toMatchObject({ data: { status: 'CANCELLED', paymentStatus: 'CANCELLED' } });
    const releaseCall = transaction.stockReservation.updateMany.mock.calls[0]?.[0] as {
      data: { state: string; activeKey: null; releaseReason: string };
    };
    expect(releaseCall.data).toMatchObject({
      state: 'RELEASED',
      activeKey: null,
      releaseReason: 'Customer requested cancellation.',
    });
    expect(transaction.cashCollection.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order-id', status: 'EXPECTED' },
      data: { status: 'VOIDED' },
    });
    expect(inventoryUpdate).not.toHaveBeenCalled();
    expect(transaction.stockMovement.create).not.toHaveBeenCalled();
  });
});
