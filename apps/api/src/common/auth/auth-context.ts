import type { AuthAudience } from './auth.constants';

export interface AuthContext {
  sessionId: string;
  userId: string;
  audience: AuthAudience;
  permissions: string[];
  twoFactorVerified: boolean;
  authenticatedAt: Date;
  expiresAt: Date;
  csrfTokenHash: string;
}
