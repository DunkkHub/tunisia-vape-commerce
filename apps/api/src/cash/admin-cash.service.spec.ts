import {
  CashCollectionStatus,
  CashDiscrepancyStatus,
  CashRemittanceStatus,
  DeliveryStatus,
  OrderStatus,
  PaymentStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
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

const exactCollectionInput = {
  collectedMillimes: 12_000,
  expectedOrderVersion: 3,
  expectedDeliveryVersion: 4,
  confirmation: 'RECORD_COLLECTION' as const,
};

const collectionRequestHash = (input: typeof exactCollectionInput) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        collectedMillimes: input.collectedMillimes,
        confirmation: input.confirmation,
        expectedDeliveryVersion: input.expectedDeliveryVersion,
        expectedOrderVersion: input.expectedOrderVersion,
        reasonCode: null,
        reasonDetail: null,
      }),
    )
    .digest('hex');

const collectionKeyHash = (key: string) =>
  createHash('sha256').update(`cash-collection\0cash-admin\0collection-id\0${key}`).digest('hex');

const collectionOperation = () => ({
  id: 'collection-id',
  orderId: 'order-id',
  deliveryId: 'delivery-id',
  courierId: null,
  status: CashCollectionStatus.EXPECTED,
  expectedMillimes: 12_000,
  collectedMillimes: 0,
  recordIdempotencyKeyHash: null,
  recordRequestHash: null,
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
  },
  delivery: {
    id: 'delivery-id',
    orderId: 'order-id',
    status: DeliveryStatus.OUT_FOR_DELIVERY,
    version: 5,
    courier: { id: 'courier-id', code: 'MANUAL-1', name: 'Manual Courier' },
  },
  discrepancy: null,
  remittanceItems: [],
  _count: { remittanceItems: 0 },
});

const collectionDiscrepancyOperation = () => ({
  ...collectionOperation(),
  courierId: 'courier-id',
  status: CashCollectionStatus.PARTIALLY_COLLECTED,
  collectedMillimes: 11_000,
  collectedByUserId: 'collector-admin',
  order: {
    ...collectionOperation().order,
    paymentStatus: PaymentStatus.RECONCILIATION_DISCREPANCY,
    version: 4,
  },
  delivery: {
    ...collectionOperation().delivery,
    version: 5,
  },
});

const collectionDiscrepancyDetail = () => ({
  ...collectionDetail(),
  status: CashCollectionStatus.COLLECTED,
  collectedMillimes: 11_000,
  collectedByUserId: 'collector-admin',
  order: {
    ...collectionDetail().order,
    paymentStatus: PaymentStatus.CASH_COLLECTED_BY_COURIER,
    version: 5,
  },
  delivery: {
    ...collectionDetail().delivery,
    version: 6,
  },
  discrepancy: {
    id: 'collection-discrepancy-id',
    cashCollectionId: 'collection-id',
    status: CashDiscrepancyStatus.RESOLVED,
    expectedMillimes: 12_000,
    actualMillimes: 11_000,
    differenceMillimes: -1_000,
    reasonCode: 'SHORTAGE',
    reasonDetail: 'Initial count was short.',
    openedByUserId: 'collector-admin',
    resolvedByUserId: 'cash-admin',
    openedAt: new Date('2026-07-13T12:00:00.000Z'),
    resolvedAt: new Date('2026-07-13T13:00:00.000Z'),
  },
});

const collectionDiscrepancyTransaction = () => ({
  $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
  cashDiscrepancy: {
    findUnique: vi
      .fn()
      .mockResolvedValueOnce({
        id: 'collection-discrepancy-id',
        remittanceId: null,
        cashCollectionId: 'collection-id',
        orderId: 'order-id',
      })
      .mockResolvedValueOnce({
        id: 'collection-discrepancy-id',
        remittanceId: null,
        cashCollectionId: 'collection-id',
        orderId: 'order-id',
        status: CashDiscrepancyStatus.OPEN,
        expectedMillimes: 12_000,
        actualMillimes: 11_000,
        differenceMillimes: -1_000,
        openedByUserId: 'collector-admin',
      }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  cashCollection: {
    findUnique: vi
      .fn()
      .mockResolvedValueOnce({ orderId: 'order-id', deliveryId: 'delivery-id' })
      .mockResolvedValueOnce(collectionDiscrepancyOperation())
      .mockResolvedValueOnce(collectionDiscrepancyDetail()),
    findMany: vi.fn().mockResolvedValue([
      {
        id: 'collection-id',
        status: CashCollectionStatus.PARTIALLY_COLLECTED,
        expectedMillimes: 12_000,
        collectedMillimes: 11_000,
        discrepancy: {
          status: CashDiscrepancyStatus.OPEN,
          expectedMillimes: 12_000,
          actualMillimes: 11_000,
          differenceMillimes: -1_000,
        },
      },
    ]),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  cashRemittanceItem: { count: vi.fn().mockResolvedValue(0) },
  order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  delivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  cashReconciliationEvent: { create: vi.fn().mockResolvedValue({}) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
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
        discrepancy: null,
        order: {
          id: 'order-id',
          paymentStatus: 'CASH_COLLECTED_BY_COURIER',
          expectedCodMillimes: 12_000,
          version: 5,
        },
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
    findMany: vi
      .fn()
      .mockResolvedValueOnce([{ id: 'collection-id' }])
      .mockResolvedValueOnce([
        {
          id: 'collection-id',
          orderId: 'order-id',
          status: CashCollectionStatus.REMITTED,
          expectedMillimes: 12_000,
          collectedMillimes: 12_000,
          discrepancy: null,
        },
      ]),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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

const requestFor = (userId: string) => ({ ...request, auth: { userId } }) as unknown as Request;

describe('administrator COD service', () => {
  it('scopes collection detail to the discrepancy directly linked to that collection', async () => {
    const findUnique = vi.fn().mockResolvedValue(collectionDiscrepancyDetail());
    const prisma = { cashCollection: { findUnique } } as unknown as PrismaService;
    const service = new AdminCashService(prisma);

    await expect(service.getCollection('collection-id')).resolves.toMatchObject({
      data: {
        id: 'collection-id',
        discrepancies: [{ id: 'collection-discrepancy-id', cashCollectionId: 'collection-id' }],
      },
    });
    const query = findUnique.mock.calls[0]?.[0] as unknown;
    const select = (query as { select?: Record<string, unknown> } | undefined)?.select ?? {};
    expect(select).toHaveProperty('discrepancy');
    expect((select.order as { select: Record<string, unknown> }).select).not.toHaveProperty(
      'cashDiscrepancies',
    );
  });

  it('reports raw and accountable collection cash distinctly for resolved and written-off rows', async () => {
    const base = {
      status: CashCollectionStatus.COLLECTED,
      expectedMillimes: 12_000,
      collectedMillimes: 11_000,
      collectedAt: new Date('2026-07-13T12:00:00.000Z'),
      createdAt: new Date('2026-07-13T10:00:00.000Z'),
      order: { orderNumber: 'TN-000001', paymentStatus: PaymentStatus.RECONCILIATION_DISCREPANCY },
      courier: { name: 'Courier' },
    };
    const rows = [
      {
        ...base,
        id: 'resolved-collection',
        discrepancy: {
          status: CashDiscrepancyStatus.RESOLVED,
          expectedMillimes: 12_000,
          actualMillimes: 11_000,
          differenceMillimes: -1_000,
        },
      },
      {
        ...base,
        id: 'written-off-collection',
        status: CashCollectionStatus.PARTIALLY_COLLECTED,
        discrepancy: {
          status: CashDiscrepancyStatus.WRITTEN_OFF,
          expectedMillimes: 12_000,
          actualMillimes: 11_000,
          differenceMillimes: -1_000,
        },
      },
    ];
    const prisma = {
      cashCollection: {
        findMany: vi.fn().mockResolvedValue(rows),
        count: vi.fn().mockResolvedValue(2),
      },
      $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
    } as unknown as PrismaService;
    const service = new AdminCashService(prisma);

    const result = await service.listCollections({ page: 1, limit: 50 });

    expect(result.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'resolved-collection',
          collectedMillimes: 11_000,
          accountableMillimes: 12_000,
          adjustmentMillimes: 1_000,
          discrepancyStatus: CashDiscrepancyStatus.RESOLVED,
        }),
        expect.objectContaining({
          id: 'written-off-collection',
          collectedMillimes: 11_000,
          accountableMillimes: 11_000,
          adjustmentMillimes: 0,
          discrepancyStatus: CashDiscrepancyStatus.WRITTEN_OFF,
        }),
      ]),
    );
  });

  it('exports the additive accountable cash contract as COD_COLLECTIONS_V2', async () => {
    const transaction = {
      cashCollection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'resolved-collection',
            status: CashCollectionStatus.COLLECTED,
            method: 'CASH',
            expectedMillimes: 12_000,
            collectedMillimes: 11_000,
            collectedAt: new Date('2026-07-13T12:00:00.000Z'),
            createdAt: new Date('2026-07-13T10:00:00.000Z'),
            discrepancy: {
              status: CashDiscrepancyStatus.RESOLVED,
              expectedMillimes: 12_000,
              actualMillimes: 11_000,
              differenceMillimes: -1_000,
            },
            order: {
              orderNumber: 'TN-000001',
              status: OrderStatus.OUT_FOR_DELIVERY,
              paymentStatus: PaymentStatus.CASH_COLLECTED_BY_COURIER,
            },
            courier: { code: 'COURIER-1', name: 'Courier' },
          },
        ]),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    } as unknown as PrismaService;
    const service = new AdminCashService(prisma);

    const result = await service.exportCollections({ page: 1, limit: 50 }, request);

    expect(result.csv).toContain('accountableMillimes,adjustmentMillimes,discrepancyStatus');
    expect(result.csv).toContain('COD_COLLECTIONS_V2');
    expect(result.csv).toContain('12000,1000,RESOLVED');
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        // Vitest asymmetric matchers are intentionally untyped at this boundary.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          afterSummary: expect.objectContaining({ schemaVersion: 'COD_COLLECTIONS_V2' }),
        }),
      }),
    );
  });

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
        'cash-record-key-0001',
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

  it('returns the committed collection for an exact idempotent retry without duplicate writes', async () => {
    const key = 'cash-record-replay-0001';
    const operation = {
      ...collectionOperation(),
      status: CashCollectionStatus.COLLECTED,
      recordIdempotencyKeyHash: collectionKeyHash(key),
      recordRequestHash: collectionRequestHash(exactCollectionInput),
    };
    const transaction = collectionTransaction();
    transaction.cashCollection.findUnique
      .mockReset()
      .mockResolvedValueOnce({ orderId: 'order-id', deliveryId: 'delivery-id' })
      .mockResolvedValueOnce(operation)
      .mockResolvedValueOnce(collectionDetail());
    const service = serviceFor(transaction);

    await expect(
      service.recordCollection('collection-id', exactCollectionInput, key, request),
    ).resolves.toMatchObject({ data: { status: 'COLLECTED', collectedMillimes: 12_000 } });
    expect(transaction.cashCollection.updateMany).not.toHaveBeenCalled();
    expect(transaction.cashReconciliationEvent.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects reuse of a collection idempotency key with different request data', async () => {
    const key = 'cash-record-replay-0002';
    const transaction = collectionTransaction();
    transaction.cashCollection.findUnique
      .mockReset()
      .mockResolvedValueOnce({ orderId: 'order-id', deliveryId: 'delivery-id' })
      .mockResolvedValueOnce({
        ...collectionOperation(),
        status: CashCollectionStatus.COLLECTED,
        recordIdempotencyKeyHash: collectionKeyHash(key),
        recordRequestHash: collectionRequestHash(exactCollectionInput),
      });
    const service = serviceFor(transaction);

    await expect(
      service.recordCollection(
        'collection-id',
        { ...exactCollectionInput, collectedMillimes: 11_999 },
        key,
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(transaction.cashCollection.updateMany).not.toHaveBeenCalled();
  });

  it('requires a valid idempotency key before opening a cash transaction', async () => {
    const transaction = vi.fn();
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const service = new AdminCashService(prisma);

    await expect(
      service.recordCollection('collection-id', exactCollectionInput, 'short', request),
    ).rejects.toMatchObject({ response: { code: 'INVALID_IDEMPOTENCY_KEY' } });
    expect(transaction).not.toHaveBeenCalled();
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
        'cash-record-key-0002',
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'PARTIAL_CASH_COLLECTION_DISABLED' } });
    expect(transaction.cashCollection.updateMany).not.toHaveBeenCalled();
  });

  it('resolves a collection discrepancy with dual control and an append-only adjustment', async () => {
    const transaction = collectionDiscrepancyTransaction();
    const service = serviceFor(transaction);

    await expect(
      service.resolveDiscrepancy(
        'collection-discrepancy-id',
        {
          resolution: 'RESOLVED',
          finalVerifiedMillimes: 12_000,
          reasonDetail: 'Independent second count recovered the missing cash.',
          confirmation: 'RESOLVE_DISCREPANCY',
        },
        request,
      ),
    ).resolves.toMatchObject({
      data: {
        id: 'collection-id',
        collectedMillimes: 11_000,
        status: 'COLLECTED',
        paymentStatus: 'CASH_COLLECTED_BY_COURIER',
      },
    });
    expect(transaction.cashCollection.updateMany).toHaveBeenCalledWith({
      where: { id: 'collection-id', status: CashCollectionStatus.PARTIALLY_COLLECTED },
      data: { status: CashCollectionStatus.COLLECTED },
    });
    expect(transaction.cashCollection.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        // Vitest asymmetric matchers are intentionally untyped at this boundary.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ collectedMillimes: expect.anything() }),
      }),
    );
    expect(transaction.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          paymentStatus: PaymentStatus.CASH_COLLECTED_BY_COURIER,
          version: { increment: 1 },
        },
      }),
    );
    expect(transaction.delivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { cashCollectedResult: true, version: { increment: 1 } },
      }),
    );
    const eventCalls = transaction.cashReconciliationEvent.create.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    const eventPayloads = eventCalls.map(([call]) => call.data);
    expect(eventPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cashCollectionId: 'collection-id',
          type: 'ADJUSTMENT_RECORDED',
          amountMillimes: 1_000,
        }),
        expect.objectContaining({
          cashCollectionId: 'collection-id',
          type: 'DISCREPANCY_RESOLVED',
          amountMillimes: -1_000,
        }),
      ]),
    );
    expect(transaction.cashDiscrepancy.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // Vitest asymmetric matchers are intentionally untyped at this boundary.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ status: 'RESOLVED' }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });

  it('forbids the collection recorder from resolving their own discrepancy', async () => {
    const transaction = collectionDiscrepancyTransaction();
    const service = serviceFor(transaction);

    await expect(
      service.resolveDiscrepancy(
        'collection-discrepancy-id',
        {
          resolution: 'RESOLVED',
          finalVerifiedMillimes: 12_000,
          reasonDetail: 'Attempted self approval must be denied.',
          confirmation: 'RESOLVE_DISCREPANCY',
        },
        requestFor('collector-admin'),
      ),
    ).rejects.toMatchObject({
      response: { code: 'SEPARATE_RECONCILIATION_APPROVER_REQUIRED' },
    });
    expect(transaction.cashCollection.updateMany).not.toHaveBeenCalled();
    expect(transaction.cashDiscrepancy.updateMany).not.toHaveBeenCalled();
    expect(transaction.cashReconciliationEvent.create).not.toHaveBeenCalled();
  });

  it('retains the order warning while another collection discrepancy remains unresolved', async () => {
    const transaction = collectionDiscrepancyTransaction();
    transaction.cashCollection.findMany.mockResolvedValue([
      {
        id: 'collection-id',
        status: CashCollectionStatus.PARTIALLY_COLLECTED,
        expectedMillimes: 6_000,
        collectedMillimes: 5_000,
        discrepancy: {
          status: CashDiscrepancyStatus.OPEN,
          expectedMillimes: 6_000,
          actualMillimes: 5_000,
          differenceMillimes: -1_000,
        },
      },
      {
        id: 'sibling-collection-id',
        status: CashCollectionStatus.PARTIALLY_COLLECTED,
        expectedMillimes: 6_000,
        collectedMillimes: 5_500,
        discrepancy: {
          status: CashDiscrepancyStatus.OPEN,
          expectedMillimes: 6_000,
          actualMillimes: 5_500,
          differenceMillimes: -500,
        },
      },
    ]);
    const service = serviceFor(transaction);

    await service.resolveDiscrepancy(
      'collection-discrepancy-id',
      {
        resolution: 'RESOLVED',
        finalVerifiedMillimes: 12_000,
        reasonDetail: 'Current collection independently verified.',
        confirmation: 'RESOLVE_DISCREPANCY',
      },
      request,
    );

    expect(transaction.cashCollection.updateMany).toHaveBeenCalledOnce();
    expect(transaction.order.updateMany).not.toHaveBeenCalled();
    expect(transaction.delivery.updateMany).not.toHaveBeenCalled();
  });

  it('retains the order warning when resolved sibling cash would exceed expected COD', async () => {
    const transaction = collectionDiscrepancyTransaction();
    transaction.cashCollection.findMany.mockResolvedValue([
      {
        id: 'collection-id',
        status: CashCollectionStatus.PARTIALLY_COLLECTED,
        expectedMillimes: 12_000,
        collectedMillimes: 11_000,
        discrepancy: {
          status: CashDiscrepancyStatus.OPEN,
          expectedMillimes: 12_000,
          actualMillimes: 11_000,
          differenceMillimes: -1_000,
        },
      },
      {
        id: 'resolved-sibling-id',
        status: CashCollectionStatus.COLLECTED,
        expectedMillimes: 12_000,
        collectedMillimes: 11_500,
        discrepancy: {
          status: CashDiscrepancyStatus.RESOLVED,
          expectedMillimes: 12_000,
          actualMillimes: 11_500,
          differenceMillimes: -500,
        },
      },
    ]);
    const service = serviceFor(transaction);

    await service.resolveDiscrepancy(
      'collection-discrepancy-id',
      {
        resolution: 'RESOLVED',
        finalVerifiedMillimes: 12_000,
        reasonDetail: 'Current collection independently verified.',
        confirmation: 'RESOLVE_DISCREPANCY',
      },
      request,
    );

    expect(transaction.cashCollection.updateMany).toHaveBeenCalledOnce();
    expect(transaction.order.updateMany).not.toHaveBeenCalled();
    expect(transaction.delivery.updateMany).not.toHaveBeenCalled();
  });

  it('writes off a collection discrepancy without rewriting cash or clearing the order warning', async () => {
    const transaction = collectionDiscrepancyTransaction();
    transaction.cashCollection.findUnique
      .mockReset()
      .mockResolvedValueOnce({ orderId: 'order-id', deliveryId: 'delivery-id' })
      .mockResolvedValueOnce(collectionDiscrepancyOperation())
      .mockResolvedValueOnce({
        ...collectionDiscrepancyDetail(),
        status: CashCollectionStatus.PARTIALLY_COLLECTED,
        order: {
          ...collectionDiscrepancyDetail().order,
          paymentStatus: PaymentStatus.RECONCILIATION_DISCREPANCY,
        },
      });
    const service = serviceFor(transaction);

    await expect(
      service.resolveDiscrepancy(
        'collection-discrepancy-id',
        {
          resolution: 'WRITTEN_OFF',
          reasonDetail: 'Approved shortage treatment recorded by accounting.',
          confirmation: 'RESOLVE_DISCREPANCY',
        },
        request,
      ),
    ).resolves.toMatchObject({
      data: {
        collectedMillimes: 11_000,
        status: 'PARTIALLY_COLLECTED',
        paymentStatus: 'RECONCILIATION_DISCREPANCY',
      },
    });
    expect(transaction.cashCollection.updateMany).not.toHaveBeenCalled();
    expect(transaction.order.updateMany).not.toHaveBeenCalled();
    expect(transaction.delivery.updateMany).not.toHaveBeenCalled();
    expect(transaction.cashReconciliationEvent.create).toHaveBeenCalledOnce();
    expect(transaction.cashReconciliationEvent.create).toHaveBeenCalledWith({
      // Vitest asymmetric matchers are intentionally untyped at this boundary.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        cashCollectionId: 'collection-id',
        type: 'DISCREPANCY_RESOLVED',
      }),
    });
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

  it('does not mark the order remitted when accountable sibling cash exceeds expected COD', async () => {
    const transaction = remittanceTransaction();
    transaction.cashCollection.findMany
      .mockReset()
      .mockResolvedValueOnce([{ id: 'collection-id' }, { id: 'sibling-collection-id' }])
      .mockResolvedValueOnce([
        {
          id: 'collection-id',
          orderId: 'order-id',
          status: CashCollectionStatus.REMITTED,
          expectedMillimes: 12_000,
          collectedMillimes: 12_000,
          discrepancy: null,
        },
        {
          id: 'sibling-collection-id',
          orderId: 'order-id',
          status: CashCollectionStatus.REMITTED,
          expectedMillimes: 12_000,
          collectedMillimes: 12_000,
          discrepancy: null,
        },
      ]);
    const service = serviceFor(transaction);

    await expect(
      service.reconcileRemittance(
        'remittance-id',
        { verifiedMillimes: 12_000, confirmation: 'RECONCILE_REMITTANCE' },
        request,
      ),
    ).resolves.toMatchObject({ data: { status: 'VERIFIED' } });

    expect(transaction.cashCollection.updateMany).toHaveBeenCalledOnce();
    expect(transaction.order.updateMany).not.toHaveBeenCalled();
  });

  it('ignores voided sibling collections when deciding whether an order is fully remitted', async () => {
    const transaction = remittanceTransaction();
    transaction.cashCollection.findMany
      .mockReset()
      .mockResolvedValueOnce([{ id: 'collection-id' }, { id: 'voided-collection-id' }])
      .mockResolvedValueOnce([
        {
          id: 'collection-id',
          orderId: 'order-id',
          status: CashCollectionStatus.REMITTED,
          expectedMillimes: 12_000,
          collectedMillimes: 12_000,
          discrepancy: null,
        },
      ]);
    const service = serviceFor(transaction);

    await service.reconcileRemittance(
      'remittance-id',
      { verifiedMillimes: 12_000, confirmation: 'RECONCILE_REMITTANCE' },
      request,
    );

    expect(transaction.cashCollection.findMany.mock.calls[1]?.[0]).toMatchObject({
      where: { status: { not: CashCollectionStatus.VOIDED } },
    });
    expect(transaction.order.updateMany).toHaveBeenCalledOnce();
  });

  it('marks the order remitted when multiple collections exactly aggregate to expected COD', async () => {
    const transaction = remittanceTransaction();
    const baseRemittance = remittanceOperation();
    const baseItem = baseRemittance.items[0]!;
    const multiCollectionRemittance = {
      ...baseRemittance,
      items: [
        {
          ...baseItem,
          id: 'allocation-one',
          cashCollectionId: 'collection-one',
          amountMillimes: 6_000,
          cashCollection: {
            ...baseItem.cashCollection,
            id: 'collection-one',
            expectedMillimes: 6_000,
            collectedMillimes: 6_000,
          },
        },
        {
          ...baseItem,
          id: 'allocation-two',
          cashCollectionId: 'collection-two',
          amountMillimes: 6_000,
          cashCollection: {
            ...baseItem.cashCollection,
            id: 'collection-two',
            expectedMillimes: 6_000,
            collectedMillimes: 6_000,
          },
        },
      ],
    };
    transaction.cashRemittance.findUnique
      .mockReset()
      .mockResolvedValueOnce(multiCollectionRemittance)
      .mockResolvedValueOnce(multiCollectionRemittance)
      .mockResolvedValueOnce(remittanceDetail());
    transaction.cashRemittanceItem.findMany.mockResolvedValue([
      { cashCollectionId: 'collection-one', amountMillimes: 6_000 },
      { cashCollectionId: 'collection-two', amountMillimes: 6_000 },
    ]);
    transaction.cashCollection.findMany
      .mockReset()
      .mockResolvedValueOnce([{ id: 'collection-one' }, { id: 'collection-two' }])
      .mockResolvedValueOnce([
        {
          id: 'collection-one',
          orderId: 'order-id',
          status: CashCollectionStatus.REMITTED,
          expectedMillimes: 6_000,
          collectedMillimes: 6_000,
          discrepancy: null,
        },
        {
          id: 'collection-two',
          orderId: 'order-id',
          status: CashCollectionStatus.REMITTED,
          expectedMillimes: 6_000,
          collectedMillimes: 6_000,
          discrepancy: null,
        },
      ]);
    const service = serviceFor(transaction);

    await service.reconcileRemittance(
      'remittance-id',
      { verifiedMillimes: 12_000, confirmation: 'RECONCILE_REMITTANCE' },
      request,
    );

    expect(transaction.cashCollection.updateMany).toHaveBeenCalledTimes(2);
    expect(transaction.order.updateMany).toHaveBeenCalledOnce();
    expect(transaction.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-id', version: 5 },
      data: { paymentStatus: 'CASH_REMITTED', version: { increment: 1 } },
    });
  });
});
