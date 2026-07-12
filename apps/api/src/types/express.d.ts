import type { AuthContext } from '../common/auth/auth-context';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId: string;
    }
  }
}

export {};
