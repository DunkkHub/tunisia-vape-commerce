import { AgeVerificationResult, DeliveryAttemptOutcome, DeliveryStatus } from '@prisma/client';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { AdminDeliveriesService } from './admin-deliveries.service';

const request = {
  auth: { userId: 'admin-id' },
  requestId: 'request-id',
  ip: '127.0.0.1',
  socket: {},
  get: vi.fn().mockReturnValue('vitest'),
} as unknown as Request;

const operationDelivery = (status: DeliveryStatus = DeliveryStatus.PREPARING) => ({
  id: 'delivery-id',
  orderId: 'order-id',
  courierId: null as string | null,
  status,
  trackingNumber: null,
  courierFeeMillimes: null,
  ageVerificationRequired: true,
  ageVerificationResult: AgeVerificationResult.PENDING as AgeVerificationResult,
  version: 4,
  order: {
    id: 'order-id',
    orderNumber: 'TN-000001',
    customerId: 'customer-id',
    status,
    paymentStatus: 'CASH_EXPECTED',
    expectedCodMillimes: 12_000,
    minimumAgeSnapshot: 18,
    deliveryMethodType: 'COURIER',
    version: 7,
  },
  attempts: [],
  cashCollections: [],
});

const detailDelivery = (status: DeliveryStatus, courier = false) => ({
  id: 'delivery-id',
  orderId: 'order-id',
  status,
  trackingNumber: null,
  courierFeeMillimes: null,
  assignedAt: courier ? new Date('2026-07-13T10:00:00.000Z') : null,
  handedToCourierAt: null,
  deliveredAt: null,
  nextAttemptAt: null,
  internalNotes: null,
  customerVisibleNotes: null,
  ageVerificationRequired: true,
  ageVerificationResult: AgeVerificationResult.PENDING,
  cashCollectedResult: null,
  version: 5,
  createdAt: new Date('2026-07-13T09:00:00.000Z'),
  updatedAt: new Date('2026-07-13T10:00:00.000Z'),
  courier: courier ? { id: 'courier-id', code: 'MANUAL-1', name: 'Manual courier' } : null,
  order: {
    orderNumber: 'TN-000001',
    status,
    paymentStatus: 'CASH_EXPECTED',
    expectedCodMillimes: 12_000,
  },
  attempts: [],
  events: [],
  _count: { attempts: 0, events: 0 },
});

const transactionBase = (
  operation = operationDelivery(),
  detail?: ReturnType<typeof detailDelivery>,
) => ({
  $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked-id' }]),
  delivery: {
    findUnique: vi
      .fn()
      .mockResolvedValueOnce({ orderId: 'order-id' })
      .mockResolvedValueOnce(operation)
      .mockResolvedValueOnce(detail),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  courier: { findFirst: vi.fn().mockResolvedValue({ id: 'courier-id' }) },
  deliveryEvent: { create: vi.fn().mockResolvedValue({}) },
  orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
  deliveryAttempt: {
    create: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
  },
  ageVerificationEvent: {
    create: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
  },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
});

const serviceFor = <T extends ReturnType<typeof transactionBase>>(transaction: T) => {
  const prisma = {
    $transaction: vi.fn((callback: (tx: T) => unknown) => Promise.resolve(callback(transaction))),
  } as unknown as PrismaService;
  return new AdminDeliveriesService(prisma);
};

describe('manual administrator delivery service', () => {
  it('assigns only an active courier with optimistic versioning and immutable events', async () => {
    const transaction = transactionBase(
      operationDelivery(DeliveryStatus.PREPARING),
      detailDelivery(DeliveryStatus.PREPARING, true),
    );
    const service = serviceFor(transaction);

    await expect(
      service.assign('delivery-id', { expectedVersion: 4, courierId: 'courier-id' }, request),
    ).resolves.toMatchObject({
      data: { id: 'delivery-id', courier: { id: 'courier-id' }, version: 5 },
    });
    const updateCall = transaction.delivery.updateMany.mock.calls[0]?.[0] as {
      where: { id: string; version: number };
      data: { courierId: string; version: { increment: number } };
    };
    expect(updateCall).toMatchObject({
      where: { id: 'delivery-id', version: 4 },
      data: { courierId: 'courier-id', version: { increment: 1 } },
    });
    expect(transaction.deliveryEvent.create).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });

  it('rejects OTHER_FAILED without a meaningful explanation', async () => {
    const transaction = transactionBase(operationDelivery(DeliveryStatus.OUT_FOR_DELIVERY));
    const service = serviceFor(transaction);

    await expect(
      service.recordAttempt(
        'delivery-id',
        { expectedVersion: 4, outcome: DeliveryAttemptOutcome.OTHER_FAILED },
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'OTHER_FAILURE_EXPLANATION_REQUIRED' } });
    expect(transaction.deliveryAttempt.create).not.toHaveBeenCalled();
  });

  it('records failed age verification as terminal failure evidence', async () => {
    const transaction = transactionBase(
      operationDelivery(DeliveryStatus.OUT_FOR_DELIVERY),
      detailDelivery(DeliveryStatus.FAILED),
    );
    const service = serviceFor(transaction);

    await expect(
      service.recordAttempt(
        'delivery-id',
        {
          expectedVersion: 4,
          outcome: DeliveryAttemptOutcome.FAILED_AGE_VERIFICATION,
          explanation: 'Recipient did not satisfy the required age verification.',
        },
        request,
      ),
    ).resolves.toMatchObject({ data: { status: 'FAILED' } });
    const attemptCall = transaction.deliveryAttempt.create.mock.calls[0]?.[0] as {
      data: { outcome: string; ageVerificationResult: string };
    };
    expect(attemptCall.data).toMatchObject({
      outcome: 'FAILED_AGE_VERIFICATION',
      ageVerificationResult: 'FAILED',
    });
    const ageCall = transaction.ageVerificationEvent.create.mock.calls[0]?.[0] as {
      data: { phase: string; result: string };
    };
    expect(ageCall.data).toMatchObject({ phase: 'DELIVERY', result: 'FAILED' });
    const orderUpdateCall = transaction.order.updateMany.mock.calls[0]?.[0] as {
      data: { status: string; version: { increment: number } };
    };
    expect(orderUpdateCall.data).toEqual({ status: 'FAILED', version: { increment: 1 } });
  });

  it('never permits delivery completion after a negative age result', async () => {
    const operation = {
      ...operationDelivery(DeliveryStatus.OUT_FOR_DELIVERY),
      courierId: 'courier-id',
      ageVerificationResult: AgeVerificationResult.FAILED,
    };
    const transaction = transactionBase(operation);
    const service = serviceFor(transaction);

    await expect(
      service.complete(
        'delivery-id',
        {
          expectedVersion: 4,
          ageVerificationResult: 'PASSED',
          confirmation: 'COMPLETE_DELIVERY',
        },
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'AGE_VERIFICATION_FAILURE_TERMINAL' } });
    expect(transaction.delivery.updateMany).not.toHaveBeenCalled();
    expect(transaction.deliveryAttempt.create).not.toHaveBeenCalled();
  });

  it('rejects a stale expected version before any mutation', async () => {
    const transaction = transactionBase();
    const service = serviceFor(transaction);

    await expect(
      service.transition(
        'delivery-id',
        { expectedVersion: 3, targetStatus: DeliveryStatus.READY_FOR_PICKUP },
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(transaction.delivery.updateMany).not.toHaveBeenCalled();
  });
});
