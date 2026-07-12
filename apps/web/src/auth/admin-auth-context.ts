import { createContext, useContext } from 'react';

import type { AdminChallengeResponse, AdminSessionResponse, AdminUser } from '../api/types';

export const ADMIN_SESSION_QUERY_KEY = ['admin-auth', 'session'] as const;

export interface AdminAuthValue {
  user: AdminUser | null;
  session: AdminSessionResponse | null;
  isLoading: boolean;
  beginLogin: (email: string, password: string) => Promise<AdminChallengeResponse>;
  verifyTotp: (challengeId: string, code: string) => Promise<AdminSessionResponse>;
  logout: () => Promise<void>;
}

export const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function useAdminAuth() {
  const value = useContext(AdminAuthContext);
  if (!value) throw new Error('useAdminAuth must be used inside AdminAuthProvider.');
  return value;
}
