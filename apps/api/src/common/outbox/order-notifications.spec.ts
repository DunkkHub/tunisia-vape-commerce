import { NotificationEvent } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../security/crypto.service';
import { createOrderNotificationsWithOutbox } from './order-notifications';

const crypto = {
  hashToken: vi.fn((value: string) => `hash:${value}`),
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
} as unknown as CryptoService;

const transactionFor = (smsEnabled: boolean) => {
  let sequence = 0;
  return {
    storeSetting: { findUnique: vi.fn().mockResolvedValue({ value: smsEnabled }) },
    notification: {
      create: vi.fn().mockImplementation(({ data }: { data: { channel: string; event: string } }) =>
        Promise.resolve({
          id: `notification-${++sequence}`,
          channel: data.channel,
          event: data.event,
        }),
      ),
    },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
};

describe('order notification channels', () => {
  it('always queues the available email path and does not queue SMS by default', async () => {
    const transaction = transactionFor(false);
    await createOrderNotificationsWithOutbox(transaction as never, crypto, {
      order: {
        id: 'order-1',
        orderNumber: 'TN-1',
        customerEmailSnapshot: 'Customer@Example.test',
        customerPhoneSnapshot: '+21620111222',
        locale: 'ar-TN',
      },
      event: NotificationEvent.ORDER_CONFIRMED,
      scheduledAt: new Date('2026-07-20T08:00:00.000Z'),
    });

    expect(transaction.notification.create).toHaveBeenCalledOnce();
    expect(transaction.notification.create.mock.calls[0]![0]).toMatchObject({
      data: {
        idempotencyKey: 'order:order-1:order_confirmed:email',
        channel: 'EMAIL',
        locale: 'ar-TN',
        encryptedRecipient: 'encrypted:customer@example.test',
      },
    });
  });

  it('adds a distinct SMS dispatch only after the operator enables it', async () => {
    const transaction = transactionFor(true);
    await createOrderNotificationsWithOutbox(transaction as never, crypto, {
      order: {
        id: 'order-1',
        orderNumber: 'TN-1',
        customerEmailSnapshot: 'customer@example.test',
        customerPhoneSnapshot: '+21620111222',
        locale: 'fr-TN',
      },
      event: NotificationEvent.OUT_FOR_DELIVERY,
      scheduledAt: new Date('2026-07-20T08:00:00.000Z'),
      idempotencyDiscriminator: 'delivery:out_for_delivery:v8',
    });

    expect(transaction.notification.create).toHaveBeenCalledTimes(2);
    expect(transaction.notification.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'order:order-1:delivery:out_for_delivery:v8:email',
        }) as object,
      }),
    );
    expect(transaction.notification.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'order:order-1:delivery:out_for_delivery:v8:sms',
        }) as object,
      }),
    );
  });
});
