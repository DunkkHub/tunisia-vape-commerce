import { adminRequest } from './admin-client';
import { jsonBody } from './http';
import type {
  AdminMetricSet,
  AdminInventoryPage,
  AdminProductCreatePayload,
  AdminProductRead,
  AdminProductUpdatePayload,
  AdminRecord,
  Pagination,
} from './types';

export const adminDataClient = {
  dashboard: () => adminRequest<AdminMetricSet>('/admin/dashboard'),
  inventory: (query: string) => adminRequest<AdminInventoryPage>(`/admin/inventory?${query}`),
  list: (endpoint: string, query: string) =>
    adminRequest<Pagination<AdminRecord>>(`/admin/${endpoint}?${query}`),
  product: (id: string) =>
    adminRequest<AdminProductRead>(`/admin/products/${encodeURIComponent(id)}`),
  createProduct: (payload: AdminProductCreatePayload) =>
    adminRequest<AdminProductRead>('/admin/products', { method: 'POST', body: jsonBody(payload) }),
  updateProduct: (id: string, payload: AdminProductUpdatePayload) =>
    adminRequest<AdminProductRead>(`/admin/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: jsonBody(payload),
    }),
};
