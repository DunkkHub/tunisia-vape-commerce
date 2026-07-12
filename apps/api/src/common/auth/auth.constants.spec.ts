import { describe, expect, it } from 'vitest';
import { cookieNames, sessionCookieOptions } from './auth.constants';

describe('authentication realm cookies', () => {
  it('never reuses a customer session cookie for administration', () => {
    const names = cookieNames(true);
    expect(names.customerSession).not.toBe(names.adminSession);
    expect(names.customerCsrf).not.toBe(names.adminCsrf);
    expect(names.adminPreAuth).not.toBe(names.adminSession);
  });

  it('enforces secure host cookies in production', () => {
    expect(cookieNames(true).adminSession).toMatch(/^__Host-/);
    expect(sessionCookieOptions(true, 1_000)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });
});
