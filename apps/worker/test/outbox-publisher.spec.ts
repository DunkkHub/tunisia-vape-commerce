import { describe, expect, it, vi } from 'vitest';
import { OUTBOX_EVENT_TYPES, deterministicJobId } from '../src/outbox-contracts.js';
import { OutboxPublisher } from '../src/outbox-publisher.js';

const event = {
  id: 'event-a',
  deterministicKey: 'reservation-expiry:v1:123',
  aggregateType: 'Inventory',
  aggregateId: 'reservations',
  eventType: OUTBOX_EVENT_TYPES.RESERVATION_EXPIRY,
  eventVersion: 1,
  payload: { cutoff: '2026-07-13T10:00:00.000Z', batchSize: 50 },
  status: 'LEASED' as const,
  availableAt: new Date(),
  leaseOwner: 'worker-a',
  leaseExpiresAt: new Date(Date.now() + 30_000),
  attemptCount: 1,
  maxAttempts: 8,
};

const logger = {
  debug: vi.fn(),
  warn: vi.fn(),
};

describe('outbox publisher', () => {
  it('publishes only a minimal job envelope with a deterministic job ID', async () => {
    const repository = {
      claimAvailable: vi.fn().mockResolvedValue([event]),
      markPublished: vi.fn().mockResolvedValue(true),
      scheduleRetry: vi.fn(),
    };
    const queue = { add: vi.fn().mockResolvedValue({ id: 'job-a' }) };
    const publisher = new OutboxPublisher(repository as never, queue as never, logger as never);

    await expect(publisher.pollOnce()).resolves.toBe(1);
    expect(queue.add).toHaveBeenCalledWith(
      'outbox-event',
      {
        outboxEventId: 'event-a',
        eventType: OUTBOX_EVENT_TYPES.RESERVATION_EXPIRY,
        eventVersion: 1,
      },
      expect.objectContaining({
        jobId: deterministicJobId(event.deterministicKey),
        attempts: 1,
      }),
    );
    expect(repository.markPublished).toHaveBeenCalledOnce();
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
  });

  it('does not publish an invalid payload and schedules a durable retry', async () => {
    const invalid = { ...event, payload: { ...event.payload, phone: '+21620111222' } };
    const repository = {
      claimAvailable: vi.fn().mockResolvedValue([invalid]),
      markPublished: vi.fn(),
      scheduleRetry: vi.fn().mockResolvedValue('RETRY'),
    };
    const queue = { add: vi.fn() };
    const publisher = new OutboxPublisher(repository as never, queue as never, logger as never);

    await expect(publisher.pollOnce()).resolves.toBe(1);
    expect(queue.add).not.toHaveBeenCalled();
    expect(repository.scheduleRetry).toHaveBeenCalledWith('event-a', 'EVENT_PAYLOAD_INVALID');
  });
});
