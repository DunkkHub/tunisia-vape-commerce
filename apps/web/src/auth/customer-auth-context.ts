import { createContext, useContext } from 'react';

import type { CustomerSessionResponse, CustomerUser } from '../api/types';

export const CUSTOMER_SESSION_QUERY_KEY = ['customer-auth', 'session'] as const;

export interface CustomerLoginValues {
  emailOrPhone: string;
  password: string;
}

export interface CustomerRegisterValues {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  adultConfirmed: boolean;
  termsAccepted: boolean;
}

export interface CustomerAuthValue {
  user: CustomerUser | null;
  session: CustomerSessionResponse | null;
  isLoading: boolean;
  login: (values: CustomerLoginValues) => Promise<CustomerSessionResponse>;
  register: (values: CustomerRegisterValues) => Promise<CustomerSessionResponse>;
  logout: () => Promise<void>;
}

export const CustomerAuthContext = createContext<CustomerAuthValue | null>(null);

export function useCustomerAuth() {
  const value = useContext(CustomerAuthContext);
  if (!value) throw new Error('useCustomerAuth must be used inside CustomerAuthProvider.');
  return value;
}
