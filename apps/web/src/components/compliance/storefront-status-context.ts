import { createContext, useContext } from 'react';

import type { StorefrontStatus } from '../../api/types';

export const StorefrontStatusContext = createContext<StorefrontStatus | null>(null);
export const STOREFRONT_STATUS_QUERY_KEY = ['storefront', 'status'] as const;

export function useStorefrontStatus() {
  const status = useContext(StorefrontStatusContext);
  if (!status) throw new Error('useStorefrontStatus must be used inside ComplianceBoundary.');
  return status;
}
