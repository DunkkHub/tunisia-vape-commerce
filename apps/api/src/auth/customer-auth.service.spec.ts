import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../common/security/crypto.service';
import type { Environment } from '../config/environment';
import type { PrismaService } from '../database/prisma.service';
import type { AuthEventService } from './auth-event.service';
import { CustomerAuthService } from './customer-auth.service';
import type { DistributedAuthThrottleService } from './distributed-auth-throttle.service';
import type { SessionService } from './session.service';

vi.mock('argon2', () => ({
  argon2id: 2,
  default: {
    hash: vi.fn().mockResolvedValue('replacement-password-hash'),
    verify: vi.fn().mockResolvedValue(false),
  },
}));

const request = {
  get: vi.fn().mockReturnValue('vitest'),
  ip: '127.0.0.1',
  socket: {},
  requestId: 'request-password-reset',
} as unknown as Request;

describe('customer password reset requests', () => {
  it('returns the same generic success for an unknown email without queuing a reset', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const runTransaction = vi.fn();
    const prisma = {
      user: { findFirst },
      $transaction: runTransaction,
    } as unknown as PrismaService;
    const consume = vi.fn().mockResolvedValue(undefined);
    const throttle = { consume } as unknown as DistributedAuthThrottleService;
    const audit = vi.fn().mockResolvedValue(undefined);
    const events = { audit } as unknown as AuthEventService;
    const service = new CustomerAuthService(
      prisma,
      {} as SessionService,
      {} as CryptoService,
      throttle,
      events,
      {} as ConfigService<Environment, true>,
    );

    await expect(
      service.requestPasswordReset({ email: ' Missing@Example.com ' }, request),
    ).resolves.toBeUndefined();

    expect(consume).toHaveBeenCalledWith(
      'customer-password-reset',
      ' Missing@Example.com ',
      request,
      3,
      15 * 60,
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        // Vitest's nested asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        where: expect.objectContaining({
          audience: 'CUSTOMER',
          emailNormalized: 'missing@example.com',
        }),
      }),
    );
    expect(runTransaction).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.customer.password_reset.request',
        outcome: 'SUCCESS',
      }),
    );
  });

  it('coalesces Google-only guidance without creating or rewriting a reset token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T10:15:00.000Z'));
    try {
      const transaction = {
        notification: {
          upsert: vi.fn().mockResolvedValue({
            id: 'provider-guidance-1',
            channel: 'EMAIL',
            event: 'PASSWORD_RESET',
          }),
        },
        outboxEvent: { upsert: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
        passwordResetToken: { create: vi.fn() },
      };
      const prisma = {
        user: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'google-customer-1',
            emailNormalized: 'google@example.com',
            passwordHash: null,
            customerProfile: {
              locale: 'fr',
              externalIdentities: [{ provider: 'GOOGLE' }],
            },
          }),
        },
        $transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
        ),
      } as unknown as PrismaService;
      const crypto = {
        hashToken: vi.fn().mockReturnValue('recipient-hash'),
        encrypt: vi.fn().mockReturnValue('encrypted-recipient'),
      } as unknown as CryptoService;
      const throttle = {
        consume: vi.fn().mockResolvedValue(undefined),
      } as unknown as DistributedAuthThrottleService;
      const audit = vi.fn().mockResolvedValue(undefined);
      const events = { audit } as unknown as AuthEventService;
      const getConfig = vi.fn();
      const config = { get: getConfig } as unknown as ConfigService<Environment, true>;
      const service = new CustomerAuthService(
        prisma,
        {} as SessionService,
        crypto,
        throttle,
        events,
        config,
      );

      await expect(
        service.requestPasswordReset({ email: 'google@example.com' }, request),
      ).resolves.toBeUndefined();
      await expect(
        service.requestPasswordReset({ email: 'google@example.com' }, request),
      ).resolves.toBeUndefined();

      expect(transaction.notification.upsert).toHaveBeenCalledTimes(2);
      expect(transaction.notification.upsert).toHaveBeenNthCalledWith(1, {
        where: {
          idempotencyKey: 'password-reset-provider:google-customer-1:2026-08-04T10',
        },
        // Vitest's nested asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        create: expect.objectContaining({
          idempotencyKey: 'password-reset-provider:google-customer-1:2026-08-04T10',
          event: 'PASSWORD_RESET',
          channel: 'EMAIL',
          payload: { kind: 'PROVIDER_SIGN_IN', provider: 'GOOGLE' },
        }),
        update: {},
        select: { id: true, channel: true, event: true },
      });
      expect(transaction.notification.upsert.mock.calls[1]?.[0]).toEqual(
        transaction.notification.upsert.mock.calls[0]?.[0],
      );
      expect(transaction.outboxEvent.upsert).toHaveBeenCalledTimes(2);
      expect(transaction.outboxEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deterministicKey: 'notification-dispatch:v1:provider-guidance-1' },
          update: {},
        }),
      );
      expect(transaction.passwordResetToken.create).not.toHaveBeenCalled();
      expect(getConfig).not.toHaveBeenCalled();
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.customer.password_reset.provider_guidance',
          outcome: 'SUCCESS',
          userId: 'google-customer-1',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('queues a local-password reset token and outbox event using the configured TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T11:00:00.000Z'));
    try {
      const transaction = {
        passwordResetToken: { create: vi.fn().mockResolvedValue({ id: 'reset-record-1' }) },
        notification: {
          create: vi.fn().mockResolvedValue({
            id: 'reset-notification-1',
            channel: 'EMAIL',
            event: 'PASSWORD_RESET',
          }),
        },
        outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
      };
      const prisma = {
        user: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'local-customer-1',
            emailNormalized: 'local@example.com',
            passwordHash: 'local-password-hash',
            customerProfile: { locale: 'ar', externalIdentities: [] },
          }),
        },
        $transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
        ),
      } as unknown as PrismaService;
      const crypto = {
        randomToken: vi.fn().mockReturnValue('plain-reset-token'),
        hashToken: vi.fn((value: string) =>
          value === 'plain-reset-token' ? 'reset-token-hash' : 'recipient-hash',
        ),
        encrypt: vi.fn((value: string) => `encrypted:${value}`),
      } as unknown as CryptoService;
      const throttle = {
        consume: vi.fn().mockResolvedValue(undefined),
      } as unknown as DistributedAuthThrottleService;
      const events = { audit: vi.fn().mockResolvedValue(undefined) } as unknown as AuthEventService;
      const getConfig = vi.fn().mockReturnValue(17);
      const config = { get: getConfig } as unknown as ConfigService<Environment, true>;
      const service = new CustomerAuthService(
        prisma,
        {} as SessionService,
        crypto,
        throttle,
        events,
        config,
      );

      await expect(
        service.requestPasswordReset({ email: 'local@example.com' }, request),
      ).resolves.toBeUndefined();

      expect(getConfig).toHaveBeenCalledWith('PASSWORD_RESET_TTL_MINUTES', { infer: true });
      expect(transaction.passwordResetToken.create).toHaveBeenCalledWith({
        data: {
          userId: 'local-customer-1',
          audience: 'CUSTOMER',
          tokenHash: 'reset-token-hash',
          requestedIp: '127.0.0.1',
          expiresAt: new Date('2026-08-04T11:17:00.000Z'),
        },
      });
      expect(transaction.notification.create).toHaveBeenCalledWith({
        // Vitest's nested asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          idempotencyKey: 'password-reset:local-customer-1:reset-token-hash',
          event: 'PASSWORD_RESET',
          channel: 'EMAIL',
          recipientHash: 'recipient-hash',
          encryptedRecipient: 'encrypted:local@example.com',
          locale: 'ar',
          payload: {
            kind: 'PASSWORD_RESET',
            encryptedResetToken: 'encrypted:plain-reset-token',
            expiresInMinutes: 17,
          },
          status: 'QUEUED',
        }),
        select: { id: true, channel: true, event: true },
      });
      expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
        // Vitest's nested asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          deterministicKey: 'notification-dispatch:v1:reset-notification-1',
          aggregateType: 'Notification',
          aggregateId: 'reset-notification-1',
          eventType: 'notification.dispatch.requested',
          payload: { notificationId: 'reset-notification-1' },
        }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the generic response for an account with no local password or provider', async () => {
    const transaction = vi.fn();
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'passwordless-customer-1',
          emailNormalized: 'passwordless@example.com',
          passwordHash: null,
          customerProfile: { locale: 'fr', externalIdentities: [] },
        }),
      },
      $transaction: transaction,
    } as unknown as PrismaService;
    const throttle = {
      consume: vi.fn().mockResolvedValue(undefined),
    } as unknown as DistributedAuthThrottleService;
    const audit = vi.fn().mockResolvedValue(undefined);
    const events = { audit } as unknown as AuthEventService;
    const getConfig = vi.fn();
    const config = { get: getConfig } as unknown as ConfigService<Environment, true>;
    const service = new CustomerAuthService(
      prisma,
      {} as SessionService,
      {} as CryptoService,
      throttle,
      events,
      config,
    );

    await expect(
      service.requestPasswordReset({ email: 'passwordless@example.com' }, request),
    ).resolves.toBeUndefined();

    expect(transaction).not.toHaveBeenCalled();
    expect(getConfig).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.customer.password_reset.request',
        outcome: 'SUCCESS',
        userId: 'passwordless-customer-1',
      }),
    );
  });
});

describe('customer password reset completion', () => {
  it('consumes every outstanding customer reset token before changing the password', async () => {
    const now = Date.now();
    const token = {
      id: 'reset-token-1',
      userId: 'customer-user-1',
      audience: 'CUSTOMER' as const,
      consumedAt: null,
      expiresAt: new Date(now + 30 * 60_000),
      user: {
        id: 'customer-user-1',
        audience: 'CUSTOMER' as const,
        status: 'ACTIVE' as const,
        passwordHash: 'existing-password-hash',
        customerProfile: { id: 'customer-profile-1', suspendedAt: null },
      },
    };
    const consumeTokens = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 2 });
    const transaction = {
      passwordResetToken: { updateMany: consumeTokens },
      user: { update: vi.fn().mockResolvedValue({}) },
      session: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      passwordResetToken: { findUnique: vi.fn().mockResolvedValue(token) },
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    } as unknown as PrismaService;
    const crypto = {
      hashToken: vi.fn().mockReturnValue('hashed-reset-token'),
    } as unknown as CryptoService;
    const throttle = {
      consume: vi.fn().mockResolvedValue(undefined),
    } as unknown as DistributedAuthThrottleService;
    const events = { audit: vi.fn().mockResolvedValue(undefined) } as unknown as AuthEventService;
    const service = new CustomerAuthService(
      prisma,
      {} as SessionService,
      crypto,
      throttle,
      events,
      {} as ConfigService<Environment, true>,
    );

    await expect(
      service.completePasswordReset(
        { token: 'valid-reset-token-value', newPassword: 'Long-new-password-2026!' },
        request,
      ),
    ).resolves.toBeUndefined();

    expect(consumeTokens).toHaveBeenNthCalledWith(1, {
      // Vitest's asymmetric matcher is intentionally dynamic.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      where: { id: token.id, consumedAt: null, expiresAt: { gt: expect.any(Date) } },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: { consumedAt: expect.any(Date) },
    });
    expect(consumeTokens).toHaveBeenNthCalledWith(2, {
      where: {
        userId: token.userId,
        audience: 'CUSTOMER',
        consumedAt: null,
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: { consumedAt: expect.any(Date) },
    });
    expect(transaction.session.updateMany).toHaveBeenCalledWith({
      where: { userId: token.userId, audience: 'CUSTOMER', status: 'ACTIVE' },
      data: {
        status: 'REVOKED',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        revokedAt: expect.any(Date),
        revokedReason: 'password_reset',
      },
    });
  });
});
