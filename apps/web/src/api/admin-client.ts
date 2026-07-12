import { ApiError, httpRequest, jsonBody } from './http';
import type { AdminChallengeResponse, AdminSessionResponse } from './types';

function adminRequest<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('X-Client-Context', 'admin');
  return httpRequest<T>(`/api/v1${path}`, { ...init, headers });
}

export const adminAuthClient = {
  async session(): Promise<AdminSessionResponse | null> {
    try {
      return await adminRequest<AdminSessionResponse>('/auth/admin/session');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  password(email: string, password: string) {
    return adminRequest<AdminChallengeResponse>('/auth/admin/login', {
      method: 'POST',
      body: jsonBody({ email, password }),
    });
  },
  totp(challengeId: string, code: string) {
    return adminRequest<AdminSessionResponse>('/auth/admin/totp', {
      method: 'POST',
      body: jsonBody({ challengeId, code }),
    });
  },
  logout() {
    return adminRequest<void>('/auth/admin/logout', { method: 'POST' });
  },
};

export { adminRequest };
