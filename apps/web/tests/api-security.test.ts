import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adminAuthClient } from '../src/api/admin-client';
import { customerAuthClient } from '../src/api/customer-client';
import { storefrontClient } from '../src/api/storefront-client';
import { json } from './test-app';

describe('realm-aware browser request security', () => {
  beforeEach(() => {
    document.cookie = 'vape_customer_csrf=; Path=/; Max-Age=0';
    document.cookie = 'vape_admin_csrf=; Path=/; Max-Age=0';
    document.cookie = 'vape_customer_csrf=customer-csrf; Path=/';
    document.cookie = 'vape_admin_csrf=admin-csrf; Path=/';
    document.documentElement.lang = 'ar';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json({ state: 'TOTP_REQUIRED', challengeId: 'challenge' }))),
    );
  });

  it('uses the customer CSRF cookie for customer and storefront mutations', async () => {
    await customerAuthClient.login({ emailOrPhone: 'client@example.tn', password: 'password' });
    await storefrontClient.confirmAge(18);
    const calls = vi.mocked(fetch).mock.calls;
    for (const call of calls) {
      const headers = new Headers(call[1]?.headers);
      expect(headers.get('X-CSRF-Token')).toBe('customer-csrf');
      expect(headers.get('Accept-Language')).toBe('ar');
      expect(headers.get('X-Client-Context')).not.toBe('admin');
      expect(call[1]?.credentials).toBe('include');
    }
  });

  it('uses only the admin CSRF cookie for admin mutations', async () => {
    await adminAuthClient.password('ops@example.tn', 'password');
    const call = vi.mocked(fetch).mock.calls[0];
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get('X-CSRF-Token')).toBe('admin-csrf');
    expect(headers.get('X-Client-Context')).toBe('admin');
    expect(headers.get('Accept-Language')).toBe('ar');
  });
});
