export const AUTH_AUDIENCES = {
  CUSTOMER: 'CUSTOMER',
  ADMIN: 'ADMIN',
} as const;

export type AuthAudience = (typeof AUTH_AUDIENCES)[keyof typeof AUTH_AUDIENCES];

export const cookieNames = (production: boolean) => ({
  customerSession: production ? '__Host-vape_customer_session' : 'vape_customer_session',
  customerCsrf: production ? '__Host-vape_customer_csrf' : 'vape_customer_csrf',
  adminPreAuth: production ? '__Host-vape_admin_pre_auth' : 'vape_admin_pre_auth',
  adminSession: production ? '__Host-vape_admin_session' : 'vape_admin_session',
  adminCsrf: production ? '__Host-vape_admin_csrf' : 'vape_admin_csrf',
});

export const sessionCookieOptions = (production: boolean, maxAge: number) => ({
  httpOnly: true,
  maxAge,
  path: '/',
  sameSite: 'lax' as const,
  secure: production,
});

export const csrfCookieOptions = (production: boolean, maxAge: number) => ({
  httpOnly: false,
  maxAge,
  path: '/',
  sameSite: 'lax' as const,
  secure: production,
});
