import { ApiError, httpRequest, jsonBody } from './http';
import type { CustomerSessionResponse } from './types';

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
  logout() {
    return customerRequest<void>('/auth/customer/logout', { method: 'POST' });
  },
  requestPasswordReset(email: string) {
    return customerRequest<void>('/auth/customer/password-reset', {
      method: 'POST',
      body: jsonBody({ email }),
    });
  },
};
