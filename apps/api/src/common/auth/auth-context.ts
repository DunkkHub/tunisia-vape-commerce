import type { AuthAudience } from './auth.constants';

export interface AuthContext {
  sessionId: string;
  userId: string;
  audience: AuthAudience;
  permissions: string[];
  roleKeys: string[];
  twoFactorVerified: boolean;
  authenticatedAt: Date;
  expiresAt: Date;
  csrfTokenHash: string;
}
