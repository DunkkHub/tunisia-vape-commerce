import { describe, expect, it, vi } from 'vitest';
import { parseWorkerEnvironment } from '../src/environment.js';
import { OUTBOX_EVENT_TYPES } from '../src/outbox-contracts.js';
import { OutboxProcessor } from '../src/outbox-processor.js';

const environment = parseWorkerEnvironment({
  DATABASE_URL: 'mysql://worker:secret@localhost:3306/store',
  WORKER_INSTANCE_ID: 'worker-test-1',
});

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
};

describe('reservation expiry outbox handling', () => {
  it('expires only the locked active reservation and records zero physical delta plus system audit', async () => {
    const cutoff = new Date(Date.now() - 60_000);
    const transaction = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'event-a',
            eventType: OUTBOX_EVENT_TYPES.RESERVATION_EXPIRY,
            eventVersion: 1,
            payload: { cutoff: cutoff.toISOString(), batchSize: 50 },
            status: 'PUBLISHED',
          },
        ])
        .mockResolvedValueOnce([{ id: 'reservation-a', inventoryItemId: 'inventory-a' }])
        .mockResolvedValueOnce([{ id: 'inventory-a' }]),
      outboxEvent: { update: vi.fn().mockResolvedValue({}) },
      stockReservation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'reservation-a',
            inventoryItemId: 'inventory-a',
            sourceType: 'ORDER',
            sourceId: 'order-a',
            orderId: 'order-a',
            quantity: 2,
            expiresAt: new Date(cutoff.getTime() - 60_000),
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'inventory-a',
            locationId: 'location-a',
            batchId: null,
            onHandQuantity: 5,
          },
        ]),
      },
      stockMovement: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const repository = { scheduleRetry: vi.fn() };
    const processor = new OutboxProcessor(
      prisma as never,
      repository as never,
      environment,
      logger as never,
    );

    await processor.process({
      outboxEventId: 'event-a',
      eventType: OUTBOX_EVENT_TYPES.RESERVATION_EXPIRY,
      eventVersion: 1,
    });

    expect(transaction.stockReservation.updateMany.mock.calls[0]?.[0] as unknown).toMatchObject({
      where: {
        id: 'reservation-a',
        state: 'ACTIVE',
        expiresAt: { lte: cutoff },
      },
      data: {
        state: 'EXPIRED',
        activeKey: null,
        releaseReason: 'RESERVATION_EXPIRED',
      },
    });
    expect(transaction.stockMovement.create.mock.calls[0]?.[0] as unknown).toMatchObject({
      data: {
        type: 'RESERVATION_RELEASE',
        quantityDelta: 0,
        onHandAfter: 5,
      },
    });
    expect(transaction.auditLog.create.mock.calls[0]?.[0] as unknown).toMatchObject({
      data: {
        actorType: 'SYSTEM',
        action: 'inventory.reservation.expired',
        outcome: 'SUCCESS',
      },
    });
    expect(transaction.outboxEvent.update.mock.calls.at(-1)?.[0] as unknown).toMatchObject({
      where: { id: 'event-a' },
      data: { status: 'PROCESSED' },
    });
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
  });

  it('treats an already processed event as an idempotent no-op', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: 'event-a',
          eventType: OUTBOX_EVENT_TYPES.RESERVATION_EXPIRY,
          eventVersion: 1,
          payload: { cutoff: '2026-07-13T10:00:00.000Z', batchSize: 50 },
          status: 'PROCESSED',
        },
      ]),
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const repository = { scheduleRetry: vi.fn() };
    const processor = new OutboxProcessor(
      prisma as never,
      repository as never,
      environment,
      logger as never,
    );

    await processor.process({
      outboxEventId: 'event-a',
      eventType: OUTBOX_EVENT_TYPES.RESERVATION_EXPIRY,
      eventVersion: 1,
    });

    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
  });
});
