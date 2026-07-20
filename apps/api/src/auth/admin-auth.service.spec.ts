import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { RedisService } from '../cache/redis.service';
import type { CryptoService } from '../common/security/crypto.service';
import type { Environment } from '../config/environment';
import type { PrismaService } from '../database/prisma.service';
import { AdminAuthService } from './admin-auth.service';
import type { AuthEventService } from './auth-event.service';
import type { DistributedAuthThrottleService } from './distributed-auth-throttle.service';
import type { SessionService } from './session.service';

vi.mock('argon2', () => ({
  argon2id: 2,
  default: {
    hash: vi.fn().mockResolvedValue('dummy-password-hash'),
    verify: vi.fn().mockResolvedValue(true),
  },
}));

const request = {
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
  requestId: 'admin-login-test',
} as unknown as Request;

describe('administrator TOTP enrollment', () => {
  it('reuses an unverified pending secret across password retries', async () => {
    const pendingSecret = 'JBSWY3DPEHPK3PXP';
    const upsert = vi.fn();
    const decrypt = vi.fn().mockReturnValue(pendingSecret);
    const encrypt = vi.fn();
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'admin-1',
          email: 'admin@example.test',
          emailNormalized: 'admin@example.test',
          passwordHash: 'valid-password-hash',
          status: 'ACTIVE',
          lockedUntil: null,
          adminProfile: {
            suspendedAt: null,
            allowedIpCidrs: null,
            mustEnrollTwoFactor: true,
          },
          twoFactorSecret: {
            encryptedSecret: 'encrypted-pending-secret',
            verifiedAt: null,
            lastUsedStep: null,
          },
        }),
      },
      twoFactorSecret: { upsert },
    } as unknown as PrismaService;
    const crypto = {
      decrypt,
      encrypt,
      randomToken: vi.fn().mockReturnValue('challenge-token-value-with-at-least-32-characters'),
      hashToken: vi.fn().mockReturnValue('a'.repeat(64)),
    } as unknown as CryptoService;
    const redis = {
      connect: vi.fn().mockResolvedValue(undefined),
      client: {
        ping: vi.fn().mockResolvedValue('PONG'),
        set: vi.fn().mockResolvedValue('OK'),
      },
    } as unknown as RedisService;
    const throttle = {
      consume: vi.fn().mockResolvedValue(undefined),
    } as unknown as DistributedAuthThrottleService;
    const events = {
      loginAttempt: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthEventService;
    const config = {
      get: vi.fn().mockReturnValue(5),
    } as unknown as ConfigService<Environment, true>;
    const service = new AdminAuthService(
      prisma,
      {} as SessionService,
      crypto,
      redis,
      throttle,
      events,
      config,
    );

    const first = await service.beginLogin(
      { email: 'admin@example.test', password: 'Valid-password-2026!' },
      request,
    );
    const second = await service.beginLogin(
      { email: 'admin@example.test', password: 'Valid-password-2026!' },
      request,
    );

    expect(first.data.state).toBe('ENROLLMENT_REQUIRED');
    expect(second.data.state).toBe('ENROLLMENT_REQUIRED');
    if (first.data.state !== 'ENROLLMENT_REQUIRED' || second.data.state !== 'ENROLLMENT_REQUIRED') {
      throw new Error('Expected enrollment challenges');
    }
    expect(first.data.manualEntryKey).toBe(pendingSecret);
    expect(second.data.manualEntryKey).toBe(pendingSecret);
    expect(first.data.enrollmentUri).toContain(`secret=${pendingSecret}`);
    expect(second.data.enrollmentUri).toBe(first.data.enrollmentUri);
    expect(decrypt).toHaveBeenCalledTimes(2);
    expect(encrypt).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
