import {
  CashCollectionStatus,
  CashRemittanceStatus,
  DeliveryStatus,
  OrderStatus,
  PaymentStatus,
} from '@prisma/client';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { AdminCashService } from './admin-cash.service';

const request = {
  auth: { userId: 'cash-admin' },
  requestId: 'request-id',
  ip: '127.0.0.1',
  socket: {},
  get: vi.fn().mockReturnValue('vitest'),
} as unknown as Request;

const collectionOperation = () => ({
  id: 'collection-id',
  orderId: 'order-id',
  deliveryId: 'delivery-id',
  courierId: null,
  status: CashCollectionStatus.EXPECTED,
  expectedMillimes: 12_000,
  collectedMillimes: 0,
  order: {
    id: 'order-id',
    orderNumber: 'TN-000001',
    status: OrderStatus.OUT_FOR_DELIVERY,
    paymentStatus: PaymentStatus.CASH_EXPECTED,
    expectedCodMillimes: 12_000,
    deliveryMethodType: 'COURIER',
    version: 3,
  },
  delivery: {
    id: 'delivery-id',
    orderId: 'order-id',
    status: DeliveryStatus.OUT_FOR_DELIVERY,
    courierId: 'courier-id',
    version: 4,
  },
});

const collectionDetail = () => ({
  id: 'collection-id',
  orderId: 'order-id',
  deliveryId: 'delivery-id',
  courierId: 'courier-id',
  status: CashCollectionStatus.COLLECTED,
  expectedMillimes: 12_000,
  collectedMillimes: 12_000,
  collectedByUserId: 'cash-admin',
  collectedAt: new Date('2026-07-13T12:00:00.000Z'),
  method: 'CASH',
  note: null,
  createdAt: new Date('2026-07-13T10:00:00.000Z'),
  updatedAt: new Date('2026-07-13T12:00:00.000Z'),
  order: {
    orderNumber: 'TN-000001',
    status: OrderStatus.OUT_FOR_DELIVERY,
    paymentStatus: PaymentStatus.CASH_COLLECTED_BY_COURIER,
    expectedCodMillimes: 12_000,
    deliveryMethodType: 'COURIER',
    version: 4,
    cashDiscrepancies: [],
    _count: { cashDiscrepancies: 0 },
  },
  delivery: {
    id: 'delivery-id',
    orderId: 'order-id',
    status: DeliveryStatus.OUT_FOR_DELIVERY,
    version: 5,
    courier: { id: 'courier-id', code: 'MANUAL-1', name: 'Manual Courier' },
  },
  remittanceItems: [],
  _count: { remittanceItems: 0 },
});

const collectionTransaction = () => ({
  $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
  cashCollection: {
    findUnique: vi
      .fn()
      .mockResolvedValueOnce({ orderId: 'order-id', deliveryId: 'delivery-id' })
      .mockResolvedValueOnce(collectionOperation())
      .mockResolvedValueOnce(collectionDetail()),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  featureFlag: { findFirst: vi.fn().mockResolvedValue(null) },
  order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  delivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  cashReconciliationEvent: { create: vi.fn().mockResolvedValue({}) },
  cashDiscrepancy: { create: vi.fn().mockResolvedValue({ id: 'discrepancy-id' }) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
});

const remittanceOperation = (receivedByUserId = 'receiver-admin') => ({
  id: 'remittance-id',
  remittanceNumber: 'REM-0001',
  courierId: 'courier-id',
  status: CashRemittanceStatus.SUBMITTED,
  declaredMillimes: 12_000,
  verifiedMillimes: null,
  differenceMillimes: null,
  receivedByUserId,
  verifiedByUserId: null,
  items: [
    {
      id: 'allocation-id',
      cashCollectionId: 'collection-id',
      amountMillimes: 12_000,
      cashCollection: {
        id: 'collection-id',
        orderId: 'order-id',
        courierId: 'courier-id',
        status: CashCollectionStatus.COLLECTED,
        expectedMillimes: 12_000,
        collectedMillimes: 12_000,
        order: { id: 'order-id', paymentStatus: 'CASH_COLLECTED_BY_COURIER', version: 5 },
      },
    },
  ],
});

const remittanceDetail = () => ({
  id: 'remittance-id',
  remittanceNumber: 'REM-0001',
  courierId: 'courier-id',
  status: CashRemittanceStatus.VERIFIED,
  declaredMillimes: 12_000,
  verifiedMillimes: 12_000,
  differenceMillimes: 0,
  submittedAt: new Date('2026-07-13T12:00:00.000Z'),
  remittedAt: new Date('2026-07-13T12:00:00.000Z'),
  receivedByUserId: 'receiver-admin',
  verifiedByUserId: 'cash-admin',
  verifiedAt: new Date('2026-07-13T13:00:00.000Z'),
  note: null,
  createdAt: new Date('2026-07-13T11:00:00.000Z'),
  updatedAt: new Date('2026-07-13T13:00:00.000Z'),
  courier: { id: 'courier-id', code: 'MANUAL-1', name: 'Manual Courier' },
  items: [],
  discrepancies: [],
  events: [],
  _count: { items: 0, discrepancies: 0, events: 0 },
});

const remittanceTransaction = (receivedByUserId = 'receiver-admin') => ({
  $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
  cashRemittance: {
    findUnique: vi
      .fn()
      .mockResolvedValueOnce(remittanceOperation(receivedByUserId))
      .mockResolvedValueOnce(remittanceOperation(receivedByUserId))
      .mockResolvedValueOnce(remittanceDetail()),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  cashRemittanceItem: {
    findMany: vi
      .fn()
      .mockResolvedValue([{ cashCollectionId: 'collection-id', amountMillimes: 12_000 }]),
  },
  cashCollection: {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn().mockResolvedValue(0),
  },
  order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  cashDiscrepancy: { create: vi.fn().mockResolvedValue({ id: 'discrepancy-id' }) },
  cashReconciliationEvent: { create: vi.fn().mockResolvedValue({}) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
});

const serviceFor = <T>(transaction: T) => {
  const prisma = {
    $transaction: vi.fn((callback: (tx: T) => unknown) => Promise.resolve(callback(transaction))),
  } as unknown as PrismaService;
  return new AdminCashService(prisma);
};

describe('administrator COD service', () => {
  it('records exact physical cash once and updates linked order and delivery versions', async () => {
    const transaction = collectionTransaction();
    const service = serviceFor(transaction);

    await expect(
      service.recordCollection(
        'collection-id',
        {
          collectedMillimes: 12_000,
          expectedOrderVersion: 3,
          expectedDeliveryVersion: 4,
          confirmation: 'RECORD_COLLECTION',
        },
        request,
      ),
    ).resolves.toMatchObject({ data: { status: 'COLLECTED', collectedMillimes: 12_000 } });
    expect(transaction.cashCollection.updateMany).toHaveBeenCalledOnce();
    expect(transaction.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { paymentStatus: 'CASH_COLLECTED_BY_COURIER', version: { increment: 1 } },
      }),
    );
    expect(transaction.delivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { cashCollectedResult: true, version: { increment: 1 } },
      }),
    );
    expect(transaction.cashReconciliationEvent.create).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });

  it('fails closed on partial collection while its feature flag is disabled', async () => {
    const transaction = collectionTransaction();
    const service = serviceFor(transaction);

    await expect(
      service.recordCollection(
        'collection-id',
        {
          collectedMillimes: 10_000,
          expectedOrderVersion: 3,
          expectedDeliveryVersion: 4,
          reasonCode: 'SHORT_CASH',
          reasonDetail: 'Courier returned less cash than expected.',
          confirmation: 'RECORD_COLLECTION',
        },
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'PARTIAL_CASH_COLLECTION_DISABLED' } });
    expect(transaction.cashCollection.updateMany).not.toHaveBeenCalled();
  });

  it('rejects duplicate allocation IDs before opening a database transaction', async () => {
    const transaction = vi.fn();
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const service = new AdminCashService(prisma);

    await expect(
      service.createRemittance(
        {
          courierId: 'courier-id',
          remittanceNumber: 'REM-0001',
          declaredMillimes: 12_000,
          allocations: [
            { cashCollectionId: 'collection-id', amountMillimes: 6_000 },
            { cashCollectionId: 'collection-id', amountMillimes: 6_000 },
          ],
          confirmation: 'CREATE_REMITTANCE',
        },
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'DUPLICATE_COLLECTION_ALLOCATION' } });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('enforces separate remittance submission and reconciliation actors', async () => {
    const transaction = remittanceTransaction('cash-admin');
    const service = serviceFor(transaction);

    await expect(
      service.reconcileRemittance(
        'remittance-id',
        { verifiedMillimes: 12_000, confirmation: 'RECONCILE_REMITTANCE' },
        request,
      ),
    ).rejects.toMatchObject({
      response: { code: 'SEPARATE_RECONCILIATION_APPROVER_REQUIRED' },
    });
    expect(transaction.cashRemittance.updateMany).not.toHaveBeenCalled();
  });

  it('requires a reason code and detail for every remittance cash difference', async () => {
    const transaction = remittanceTransaction();
    const service = serviceFor(transaction);

    await expect(
      service.reconcileRemittance(
        'remittance-id',
        { verifiedMillimes: 11_000, confirmation: 'RECONCILE_REMITTANCE' },
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'DISCREPANCY_REASON_REQUIRED' } });
    expect(transaction.cashRemittance.updateMany).not.toHaveBeenCalled();
  });

  it('verifies an exact remittance and marks its fully allocated cash as remitted', async () => {
    const transaction = remittanceTransaction();
    const service = serviceFor(transaction);

    await expect(
      service.reconcileRemittance(
        'remittance-id',
        { verifiedMillimes: 12_000, confirmation: 'RECONCILE_REMITTANCE' },
        request,
      ),
    ).resolves.toMatchObject({ data: { status: 'VERIFIED', differenceMillimes: 0 } });
    expect(transaction.cashCollection.updateMany).toHaveBeenCalledWith({
      where: { id: 'collection-id', status: 'COLLECTED' },
      data: { status: 'REMITTED' },
    });
    expect(transaction.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { paymentStatus: 'CASH_REMITTED', version: { increment: 1 } },
      }),
    );
    const eventCall = transaction.cashReconciliationEvent.create.mock.calls[0]?.[0] as {
      data: { type: string };
    };
    expect(eventCall.data.type).toBe('REMITTANCE_VERIFIED');
  });
});
