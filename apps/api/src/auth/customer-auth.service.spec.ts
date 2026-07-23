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
  default: { hash: vi.fn().mockResolvedValue('replacement-password-hash') },
}));

const request = {
  get: vi.fn().mockReturnValue('vitest'),
  ip: '127.0.0.1',
  socket: {},
  requestId: 'request-password-reset',
} as unknown as Request;

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
