import { describe, expect, it, vi } from 'vitest';
import { createNotificationWithOutbox } from './notification-outbox';

describe('notification transactional outbox', () => {
  it('creates a deterministic dispatch event beside the notification', async () => {
    const transaction = {
      notification: {
        create: vi.fn().mockResolvedValue({
          id: 'notification-1',
          channel: 'EMAIL',
          event: 'PASSWORD_RESET',
        }),
      },
      outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'event-1' }) },
    };
    const scheduledAt = new Date('2026-07-20T08:00:00.000Z');

    await createNotificationWithOutbox(transaction as never, {
      idempotencyKey: 'password-reset:user:token',
      event: 'PASSWORD_RESET',
      channel: 'EMAIL',
      recipientHash: 'a'.repeat(64),
      encryptedRecipient: 'encrypted',
      locale: 'fr',
      payload: { schemaVersion: 1 },
      scheduledAt,
    });

    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        deterministicKey: 'notification-dispatch:v1:notification-1',
        aggregateType: 'Notification',
        aggregateId: 'notification-1',
        eventType: 'notification.dispatch.requested',
        eventVersion: 1,
        payload: { notificationId: 'notification-1' },
        availableAt: scheduledAt,
      },
    });
  });
});
