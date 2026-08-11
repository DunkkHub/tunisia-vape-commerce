import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import type { Environment } from '../../config/environment';
import { TrustedOriginGuard } from './trusted-origin.guard';

const config = {
  get: (key: keyof Environment) =>
    key === 'ADMIN_WEB_URL' ? 'https://admin.example.tn' : 'https://store.example.tn',
} as ConfigService<Environment, true>;

const contextFor = (overrides: Partial<Request>): ExecutionContext => {
  const headers = new Map<string, string>();
  for (const [name, value] of Object.entries(overrides.headers ?? {})) {
    if (typeof value === 'string') headers.set(name.toLowerCase(), value);
  }
  const request = {
    method: 'POST',
    originalUrl: '/api/v1/auth/customer/login',
    url: '/api/v1/auth/customer/login',
    get: (name: string) => headers.get(name.toLowerCase()),
    ...overrides,
  } as Request;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe('TrustedOriginGuard Google callback boundary', () => {
  const guard = new TrustedOriginGuard(config);

  it('allows only the exact cross-site top-level Google callback navigation', () => {
    expect(
      guard.canActivate(
        contextFor({
          method: 'GET',
          originalUrl: '/api/v1/auth/customer/google/callback?code=secret&state=secret',
          headers: {
            'sec-fetch-site': 'cross-site',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-dest': 'document',
          },
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ['POST', '/api/v1/auth/customer/google/callback'],
    ['GET', '/api/v1/auth/customer/google/complete'],
    ['POST', '/api/v1/auth/admin/login'],
  ])('continues denying cross-site %s %s', (method, originalUrl) => {
    expect(() =>
      guard.canActivate(
        contextFor({
          method,
          originalUrl,
          headers: {
            'sec-fetch-site': 'cross-site',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-dest': 'document',
          },
        }),
      ),
    ).toThrowError();
  });

  it('denies an iframe callback even on the exact path', () => {
    expect(() =>
      guard.canActivate(
        contextFor({
          method: 'GET',
          originalUrl: '/api/v1/auth/customer/google/callback',
          headers: {
            'sec-fetch-site': 'cross-site',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-dest': 'iframe',
          },
        }),
      ),
    ).toThrowError();
  });
});
