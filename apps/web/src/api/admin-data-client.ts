import { adminRequest } from './admin-client';
import { jsonBody } from './http';
import type {
  AdminMetricSet,
  AdminInventoryPage,
  AccountLifecyclePayload,
  AdminAccount,
  CreateAdminAccountPayload,
  ManagedCustomerAccount,
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
  administrators: (query: string) =>
    adminRequest<Pagination<AdminAccount>>(`/admin/access/admins?${query}`),
  createAdministrator: (payload: CreateAdminAccountPayload) =>
    adminRequest<AdminAccount>('/admin/access/admins', {
      method: 'POST',
      body: jsonBody(payload),
    }),
  administratorAction: (
    id: string,
    action: 'suspend' | 'reactivate' | 'anonymize',
    payload: AccountLifecyclePayload & { confirmation?: 'ANONYMIZE_ADMIN' },
  ) =>
    adminRequest<AdminAccount>(`/admin/access/admins/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: jsonBody(payload),
    }),
  customers: (query: string) =>
    adminRequest<Pagination<ManagedCustomerAccount>>(`/admin/customers?${query}`),
  customerAction: (
    id: string,
    action: 'suspend' | 'reactivate' | 'disable',
    payload: AccountLifecyclePayload & { confirmation?: 'DISABLE_CUSTOMER' },
  ) =>
    adminRequest<ManagedCustomerAccount>(`/admin/customers/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: jsonBody(payload),
    }),
};
