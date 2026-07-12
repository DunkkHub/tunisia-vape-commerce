export type Locale = 'fr' | 'ar';

export type AuthAudience = 'customer' | 'admin';

export interface SafeUser {
  id: string;
  email: string | null;
  displayName: string;
  audience: AuthAudience;
  permissions: string[];
  twoFactorVerified: boolean;
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  errors?: Record<string, string[]>;
}

export interface MoneyAmount {
  currency: 'TND';
  millimes: number;
}
