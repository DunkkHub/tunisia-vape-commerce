import type { ExecutionContext } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { AdminAuthController } from '../../src/auth/admin-auth.controller';
import { CustomerAuthController } from '../../src/auth/customer-auth.controller';
import { AdminSessionGuard } from '../../src/auth/guards/admin-session.guard';
import { CustomerSessionGuard } from '../../src/auth/guards/customer-session.guard';
import type { SessionService } from '../../src/auth/session.service';
import { AUTH_AUDIENCES } from '../../src/common/auth/auth.constants';

const context = (): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ requestId: 'security-test' }) }),
  }) as unknown as ExecutionContext;

const resolved = (audience: 'CUSTOMER' | 'ADMIN') => ({
  sessionId: 'session',
  userId: 'user',
  audience,
  permissions: [],
  twoFactorVerified: audience === 'ADMIN',
  authenticatedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  csrfTokenHash: 'a'.repeat(64),
});

describe('authentication realm separation', () => {
  it('publishes non-overlapping controller namespaces', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CustomerAuthController)).toBe('auth/customer');
    expect(Reflect.getMetadata(PATH_METADATA, AdminAuthController)).toBe('auth/admin');
  });

  it('forces the customer guard to resolve only customer sessions', async () => {
    const resolve = vi.fn().mockResolvedValue(resolved('CUSTOMER'));
    const guard = new CustomerSessionGuard({ resolve } as unknown as SessionService);
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledWith(expect.any(Object), AUTH_AUDIENCES.CUSTOMER);
  });

  it('forces the admin guard to resolve only admin sessions', async () => {
    const resolve = vi.fn().mockResolvedValue(resolved('ADMIN'));
    const guard = new AdminSessionGuard({ resolve } as unknown as SessionService);
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledWith(expect.any(Object), AUTH_AUDIENCES.ADMIN);
  });
});
