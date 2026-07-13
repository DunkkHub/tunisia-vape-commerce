import { describe, expect, it } from 'vitest';
import { parseWorkerEnvironment } from '../src/environment.js';
import {
  OUTBOX_EVENT_TYPES,
  deterministicJobId,
  exponentialRetryDelay,
  parseEventPayload,
  parseStoredJson,
  safeErrorCode,
} from '../src/outbox-contracts.js';

describe('worker environment', () => {
  it('requires a MySQL database URL and applies bounded operational defaults', () => {
    expect(() =>
      parseWorkerEnvironment({ DATABASE_URL: 'postgresql://localhost/store' }),
    ).toThrow();
    const environment = parseWorkerEnvironment({
      DATABASE_URL: 'mysql://worker:secret@localhost:3306/store',
      WORKER_INSTANCE_ID: 'worker-test-1',
    });
    expect(environment).toMatchObject({
      WORKER_INSTANCE_ID: 'worker-test-1',
      OUTBOX_BATCH_SIZE: 25,
      OUTBOX_MAX_ATTEMPTS: 8,
      NOTIFICATION_ADAPTER: 'console',
    });
  });
});

describe('outbox contracts', () => {
  it('accepts minimal reservation work and rejects unknown or personal-data fields', () => {
    expect(
      parseEventPayload(OUTBOX_EVENT_TYPES.RESERVATION_EXPIRY, 1, {
        cutoff: '2026-07-13T10:00:00.000Z',
        batchSize: 50,
      }),
    ).toMatchObject({ eventType: OUTBOX_EVENT_TYPES.RESERVATION_EXPIRY });
    expect(() =>
      parseEventPayload(OUTBOX_EVENT_TYPES.RESERVATION_EXPIRY, 1, {
        cutoff: '2026-07-13T10:00:00.000Z',
        batchSize: 50,
        customerPhone: '+21620111222',
      }),
    ).toThrow();
  });

  it('decodes bounded JSON returned as text by a raw MySQL query', () => {
    expect(parseStoredJson('{"notificationId":"notification-a"}')).toEqual({
      notificationId: 'notification-a',
    });
    expect(() => parseStoredJson('{invalid')).toThrow();
    expect(() => parseStoredJson('x'.repeat(8_193))).toThrow();
  });

  it('creates BullMQ-safe deterministic IDs without embedding the source key', () => {
    const first = deterministicJobId('notification-dispatch:v1:notification-a');
    expect(first).toBe(deterministicJobId('notification-dispatch:v1:notification-a'));
    expect(first).not.toContain('notification-a');
    expect(first).toMatch(/^outbox-[a-f0-9]{48}$/);
  });

  it('uses bounded exponential retry delays and safe error classifications', () => {
    expect(exponentialRetryDelay(1, 1_000, 30_000)).toBe(1_000);
    expect(exponentialRetryDelay(4, 1_000, 30_000)).toBe(8_000);
    expect(exponentialRetryDelay(20, 1_000, 30_000)).toBe(30_000);
    expect(safeErrorCode(new Error('secret provider response'))).toBe('OUTBOX_HANDLER_FAILED');
  });
});
