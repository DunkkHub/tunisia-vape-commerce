import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { CsrfGuard } from '../../src/auth/guards/csrf.guard';
import {
  RecentAuthenticationGuard,
  RECENT_AUTHENTICATION_WINDOW_MS,
} from '../../src/auth/guards/recent-authentication.guard';
import { TrustedOriginGuard } from '../../src/auth/guards/trusted-origin.guard';
import { AUTH_AUDIENCES } from '../../src/common/auth/auth.constants';
import { CryptoService } from '../../src/common/security/crypto.service';
import type { Environment } from '../../src/config/environment';

const environment = {
  NODE_ENV: 'test',
  WEB_URL: 'http://localhost:5173',
  ADMIN_WEB_URL: 'http://admin.localhost:5173',
  FIELD_ENCRYPTION_KEY: 'a'.repeat(48),
  ADMIN_RECENT_AUTH_MINUTES: 10,
} as Environment;
const config = new ConfigService<Environment, true>(environment);

const executionContext = (request: object): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('authentication security guards', () => {
  it('accepts only the configured origin for each browser realm', () => {
    const guard = new TrustedOriginGuard(config);
    const request = (path: string, origin: string, fetchSite = 'same-site') => ({
      originalUrl: path,
      get: (name: string) =>
        name === 'origin' ? origin : name === 'sec-fetch-site' ? fetchSite : undefined,
    });
    expect(
      guard.canActivate(
        executionContext(request('/api/v1/auth/customer/login', 'http://localhost:5173')),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        executionContext(request('/api/v1/auth/admin/login', 'http://admin.localhost:5173')),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        executionContext(request('/api/v1/auth/customer/login', 'http://admin.localhost:5173')),
      ),
    ).toThrow();
    expect(() =>
      guard.canActivate(executionContext(request('/api/v1/admin/orders', 'http://localhost:5173'))),
    ).toThrow();
    expect(() =>
      guard.canActivate(
        executionContext(
          request('/api/v1/auth/admin/login', 'https://attacker.example', 'cross-site'),
        ),
      ),
    ).toThrow();
  });

  it('binds a CSRF token to the current customer session and realm cookie', () => {
    const crypto = new CryptoService(config);
    const token = 'customer-csrf-token';
    const guard = new CsrfGuard(crypto, config);
    const request = {
      auth: {
        audience: AUTH_AUDIENCES.CUSTOMER,
        csrfTokenHash: crypto.hashToken(token),
      },
      cookies: { vape_customer_csrf: token, vape_admin_csrf: 'admin-token' },
      get: (name: string): string | undefined => (name === 'x-csrf-token' ? token : undefined),
    };
    expect(guard.canActivate(executionContext(request))).toBe(true);
    request.get = () => 'admin-token';
    expect(() => guard.canActivate(executionContext(request))).toThrow();
  });

  it('requires a recent TOTP-backed admin session for sensitive actions', () => {
    const guard = new RecentAuthenticationGuard(config);
    const request = (age: number, audience: 'ADMIN' | 'CUSTOMER' = 'ADMIN') => ({
      auth: {
        audience,
        twoFactorVerified: audience === 'ADMIN',
        authenticatedAt: new Date(Date.now() - age),
      },
    });
    expect(guard.canActivate(executionContext(request(1_000)))).toBe(true);
    expect(() =>
      guard.canActivate(executionContext(request(RECENT_AUTHENTICATION_WINDOW_MS + 1))),
    ).toThrow();
    expect(() => guard.canActivate(executionContext(request(1_000, 'CUSTOMER')))).toThrow();
  });
});
