import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../common/security/crypto.service';
import type { PrismaService } from '../database/prisma.service';
import { AuthEventService } from './auth-event.service';

const request = {
  requestId: 'request-id',
  ip: '127.0.0.1',
  socket: {},
  get: vi.fn().mockReturnValue('vitest'),
} as unknown as Request;

describe('authentication security alerts', () => {
  it('records a locked admin attempt and coalesces a recipient-free outbox alert', async () => {
    const transaction = {
      loginAttempt: { create: vi.fn().mockResolvedValue({}) },
      storeSetting: {
        findMany: vi.fn().mockResolvedValue([
          { key: 'notifications.security_alert_email', value: 'security@example.test' },
          { key: 'notifications.operational_alert_locale', value: 'ar' },
        ]),
      },
      notification: {
        upsert: vi.fn().mockResolvedValue({
          id: 'notification-id',
          channel: 'EMAIL',
          event: 'SECURITY_ALERT',
        }),
      },
      outboxEvent: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const crypto = {
      hashToken: vi.fn((value: string) => `hash:${value}`),
      encrypt: vi.fn((value: string) => `encrypted:${value}`),
    } as unknown as CryptoService;
    const service = new AuthEventService(prisma, crypto);

    await service.loginAttempt({
      audience: 'ADMIN',
      identifier: 'Admin@Example.test',
      result: 'LOCKED',
      request,
      userId: 'admin-id',
    });

    expect(transaction.loginAttempt.create).toHaveBeenCalledOnce();
    expect(transaction.notification.upsert).toHaveBeenCalledOnce();
    const notification = transaction.notification.upsert.mock.calls[0]![0] as {
      create: { locale: string; encryptedRecipient: string; payload: unknown };
    };
    expect(notification.create).toMatchObject({
      locale: 'ar-TN',
      encryptedRecipient: 'encrypted:security@example.test',
      payload: { alertCode: 'ADMIN_LOGIN_LOCKED' },
    });
    expect(JSON.stringify(transaction.outboxEvent.upsert.mock.calls)).not.toContain(
      'security@example.test',
    );
  });
});
