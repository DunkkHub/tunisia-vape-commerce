import { createHash } from 'node:crypto';
import { z } from 'zod';

export const OUTBOX_EVENT_TYPES = {
  RESERVATION_EXPIRY: 'inventory.reservations.expire.requested',
  NOTIFICATION_DISPATCH: 'notification.dispatch.requested',
} as const;

export type SupportedOutboxEventType = (typeof OUTBOX_EVENT_TYPES)[keyof typeof OUTBOX_EVENT_TYPES];

export const outboxJobSchema = z.strictObject({
  outboxEventId: z
    .string()
    .min(1)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/),
  eventType: z.string().min(1).max(120),
  eventVersion: z.number().int().min(1).max(100),
});

const reservationExpiryPayloadSchema = z.strictObject({
  cutoff: z.iso.datetime({ offset: true }),
  batchSize: z.number().int().min(1).max(200),
});

const notificationDispatchPayloadSchema = z.strictObject({
  notificationId: z
    .string()
    .min(1)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/),
});

export type ReservationExpiryPayload = z.infer<typeof reservationExpiryPayloadSchema>;
export type NotificationDispatchPayload = z.infer<typeof notificationDispatchPayloadSchema>;

export class WorkerDomainError extends Error {
  constructor(readonly safeCode: string) {
    super(safeCode);
  }
}

export const parseStoredJson = (payload: unknown): unknown => {
  if (typeof payload !== 'string') return payload;
  if (payload.length > 8_192) throw new WorkerDomainError('EVENT_PAYLOAD_TOO_LARGE');
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new WorkerDomainError('EVENT_PAYLOAD_INVALID');
  }
};

export const parseEventPayload = (eventType: string, eventVersion: number, payload: unknown) => {
  if (eventVersion !== 1) throw new WorkerDomainError('EVENT_VERSION_UNSUPPORTED');
  switch (eventType) {
    case OUTBOX_EVENT_TYPES.RESERVATION_EXPIRY:
      return {
        eventType,
        payload: reservationExpiryPayloadSchema.parse(payload),
      } as const;
    case OUTBOX_EVENT_TYPES.NOTIFICATION_DISPATCH:
      return {
        eventType,
        payload: notificationDispatchPayloadSchema.parse(payload),
      } as const;
    default:
      throw new WorkerDomainError('EVENT_TYPE_UNSUPPORTED');
  }
};

export const deterministicJobId = (deterministicKey: string): string =>
  `outbox-${createHash('sha256').update(deterministicKey).digest('hex').slice(0, 48)}`;

export const exponentialRetryDelay = (
  attemptCount: number,
  baseMilliseconds: number,
  maximumMilliseconds: number,
): number => {
  const exponent = Math.max(0, Math.min(20, attemptCount - 1));
  return Math.min(maximumMilliseconds, baseMilliseconds * 2 ** exponent);
};

export const safeErrorCode = (error: unknown): string => {
  if (error instanceof WorkerDomainError) return error.safeCode.slice(0, 100);
  if (error instanceof z.ZodError) return 'EVENT_PAYLOAD_INVALID';
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^P\d{4}$/.test(error.code)
  ) {
    return 'DATABASE_OPERATION_FAILED';
  }
  return 'OUTBOX_HANDLER_FAILED';
};
