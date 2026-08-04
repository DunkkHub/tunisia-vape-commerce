import { ApiError, httpRequest, jsonBody } from './http';
import type { CustomerSessionListResponse, CustomerSessionResponse } from './types';

interface CustomerLoginInput {
  emailOrPhone: string;
  password: string;
}

interface CustomerRegisterInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  adultConfirmed: boolean;
  termsAccepted: boolean;
  locale: 'fr' | 'ar';
}

export type GoogleOAuthIntent = 'LOGIN' | 'REGISTER';

export interface GoogleOAuthStartInput {
  intent: GoogleOAuthIntent;
  returnTo: string;
  locale: 'fr' | 'ar';
}

export interface GoogleOAuthStartResponse {
  authorizationUrl: string;
}

export interface GoogleOnboardingResponse {
  mode: 'CREATE' | 'LINK';
  email: string;
  fullName: string;
  locale: 'fr' | 'ar';
  expiresInSeconds: number;
}

export interface GoogleOAuthCompleteInput {
  fullName?: string;
  phone?: string;
  adultConfirmed?: boolean;
  termsAccepted?: boolean;
  locale?: 'fr' | 'ar';
  currentPassword?: string;
}

function customerRequest<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('X-Client-Context', 'customer');
  return httpRequest<T>(`/api/v1${path}`, { ...init, headers });
}

export const customerAuthClient = {
  async session(): Promise<CustomerSessionResponse | null> {
    try {
      return await customerRequest<CustomerSessionResponse>('/auth/customer/session');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  login(input: CustomerLoginInput) {
    return customerRequest<CustomerSessionResponse>('/auth/customer/login', {
      method: 'POST',
      body: jsonBody(input),
    });
  },
  register(input: CustomerRegisterInput) {
    return customerRequest<CustomerSessionResponse>('/auth/customer/register', {
      method: 'POST',
      body: jsonBody(input),
    });
  },
  startGoogle(input: GoogleOAuthStartInput) {
    return customerRequest<GoogleOAuthStartResponse>('/auth/customer/google/start', {
      method: 'POST',
      body: jsonBody(input),
    });
  },
  googleOnboarding() {
    return customerRequest<GoogleOnboardingResponse>('/auth/customer/google/onboarding');
  },
  completeGoogle(input: GoogleOAuthCompleteInput) {
    return customerRequest<CustomerSessionResponse>('/auth/customer/google/complete', {
      method: 'POST',
      body: jsonBody(input),
    });
  },
  logout() {
    return customerRequest<void>('/auth/customer/logout', { method: 'POST' });
  },
  requestPasswordReset(email: string) {
    return customerRequest<void>('/auth/customer/password-reset', {
      method: 'POST',
      body: jsonBody({ email }),
    });
  },
  confirmPasswordReset(token: string, newPassword: string) {
    return customerRequest<void>('/auth/customer/password-reset/confirm', {
      method: 'POST',
      body: jsonBody({ token, newPassword }),
    });
  },
  sessions() {
    return customerRequest<CustomerSessionListResponse>('/auth/customer/sessions');
  },
  revokeSession(sessionId: string) {
    return customerRequest<void>(`/auth/customer/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
  },
  revokeAllSessions() {
    return customerRequest<void>('/auth/customer/sessions/revoke-all', { method: 'POST' });
  },
};
