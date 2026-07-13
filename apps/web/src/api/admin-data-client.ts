import { adminRequest } from './admin-client';
import { jsonBody } from './http';
import type {
  AdminMetricSet,
  AdminInventoryPage,
  AdminInventoryVariantDetail,
  AdminInventoryLocation,
  AccountLifecyclePayload,
  AdminAccount,
  CreateAdminAccountPayload,
  ManagedCustomerAccount,
  AdminProductCreatePayload,
  AdminProductRead,
  AdminProductVariantRead,
  AdminProductUpdatePayload,
  AdminOrderDetail,
  AdminRecord,
  AdminSettingRecord,
  AdminDeliveryZoneConfig,
  AdminDeliveryRateConfig,
  AdminPickupConfig,
  AdminCashCollection,
  AdminCashCollectionDetail,
  AdminCashRemittance,
  AdminCourierOption,
  AdminDeliveryDetail,
  Pagination,
} from './types';

export const adminDataClient = {
  dashboard: () => adminRequest<AdminMetricSet>('/admin/dashboard'),
  inventory: (query: string) => adminRequest<AdminInventoryPage>(`/admin/inventory?${query}`),
  inventoryVariant: (variantId: string) =>
    adminRequest<AdminInventoryVariantDetail>(
      `/admin/inventory/variants/${encodeURIComponent(variantId)}`,
    ),
  inventoryLocations: () => adminRequest<AdminInventoryLocation[]>('/admin/inventory/locations'),
  createInventoryLocation: (payload: { code: string; name: string; address?: string }) =>
    adminRequest<AdminInventoryLocation>('/admin/inventory/locations', {
      method: 'POST',
      body: jsonBody(payload),
    }),
  createInventoryItem: (payload: {
    variantId: string;
    locationId: string;
    initialQuantity: number;
    note?: string;
  }) =>
    adminRequest<{ id: string }>('/admin/inventory/items', {
      method: 'POST',
      body: jsonBody(payload),
    }),
  adjustInventory: (
    itemId: string,
    payload: {
      operation: 'ADD' | 'REMOVE' | 'SET';
      quantity?: number;
      targetOnHandQuantity?: number;
      reasonCode: 'PURCHASE_RECEIPT' | 'STOCK_COUNT_CORRECTION' | 'DAMAGE' | 'EXPIRY' | 'OTHER';
      note?: string;
      expectedVersion: number;
    },
  ) =>
    adminRequest<{ inventoryItemId: string }>(
      `/admin/inventory/items/${encodeURIComponent(itemId)}/adjustments`,
      { method: 'POST', body: jsonBody(payload) },
    ),
  updateLowStockThreshold: (
    variantId: string,
    payload: { lowStockThreshold: number; expectedVersion: number },
  ) =>
    adminRequest<{ variantId: string }>(
      `/admin/inventory/variants/${encodeURIComponent(variantId)}/low-stock-threshold`,
      { method: 'PATCH', body: jsonBody(payload) },
    ),
  list: (endpoint: string, query: string) =>
    adminRequest<Pagination<AdminRecord>>(`/admin/${endpoint}?${query}`),
  settings: (query = 'page=1&limit=50') =>
    adminRequest<Pagination<AdminSettingRecord>>(`/admin/settings?${query}`),
  updateSetting: (
    setting: Pick<AdminSettingRecord, 'scope' | 'key' | 'version'>,
    value: string | number | boolean,
    reason: string,
  ) =>
    adminRequest<AdminSettingRecord>(
      `/admin/settings/${setting.scope.toLocaleLowerCase('en-US')}/${encodeURIComponent(setting.key)}`,
      {
        method: 'PATCH',
        body: jsonBody({ value, expectedVersion: setting.version, reason, confirmed: true }),
      },
    ),
  deliveryZones: () =>
    adminRequest<Pagination<AdminDeliveryZoneConfig>>(
      '/admin/delivery-config/zones?page=1&limit=50',
    ),
  deliveryRates: () =>
    adminRequest<Pagination<AdminDeliveryRateConfig>>(
      '/admin/delivery-config/rates?page=1&limit=50',
    ),
  pickupLocations: () =>
    adminRequest<Pagination<AdminPickupConfig>>('/admin/delivery-config/pickups?page=1&limit=50'),
  createDeliveryZone: (payload: { code: string; nameFr: string; nameAr: string }) =>
    adminRequest<AdminDeliveryZoneConfig>('/admin/delivery-config/zones', {
      method: 'POST',
      body: jsonBody(payload),
    }),
  linkDeliveryZoneLocality: (zone: AdminDeliveryZoneConfig, localityId: string, active: boolean) =>
    adminRequest<AdminDeliveryZoneConfig>(
      `/admin/delivery-config/zones/${encodeURIComponent(zone.id)}/geography-links`,
      {
        method: 'PUT',
        body: jsonBody({
          expectedUpdatedAt: zone.updatedAt,
          confirmed: true,
          scope: 'LOCALITY',
          geographyId: localityId,
          active,
        }),
      },
    ),
  setDeliveryZoneActive: (zone: AdminDeliveryZoneConfig, active: boolean) =>
    adminRequest<AdminDeliveryZoneConfig>(
      `/admin/delivery-config/zones/${encodeURIComponent(zone.id)}/${active ? 'activate' : 'deactivate'}`,
      {
        method: 'POST',
        body: jsonBody({ expectedUpdatedAt: zone.updatedAt, confirmed: true }),
      },
    ),
  createDeliveryRate: (payload: { deliveryZoneId: string; name: string; feeMillimes: number }) =>
    adminRequest<AdminDeliveryRateConfig>('/admin/delivery-config/rates', {
      method: 'POST',
      body: jsonBody({ type: 'BASE', priority: 0, ...payload }),
    }),
  setDeliveryRateActive: (rate: AdminDeliveryRateConfig, active: boolean) =>
    adminRequest<AdminDeliveryRateConfig>(
      `/admin/delivery-config/rates/${encodeURIComponent(rate.id)}/${active ? 'activate' : 'deactivate'}`,
      {
        method: 'POST',
        body: jsonBody({ expectedVersion: rate.version, confirmed: true }),
      },
    ),
  createPickupLocation: (payload: {
    code: string;
    nameFr: string;
    nameAr: string;
    address: string;
  }) =>
    adminRequest<AdminPickupConfig>('/admin/delivery-config/pickups', {
      method: 'POST',
      body: jsonBody(payload),
    }),
  setPickupActive: (pickup: AdminPickupConfig, active: boolean) =>
    adminRequest<AdminPickupConfig>(
      `/admin/delivery-config/pickups/${encodeURIComponent(pickup.id)}/${active ? 'activate' : 'deactivate'}`,
      {
        method: 'POST',
        body: jsonBody({ expectedStateToken: pickup.stateToken, confirmed: true }),
      },
    ),
  cashCollections: () =>
    adminRequest<Pagination<AdminCashCollection>>('/admin/cash/collections?page=1&limit=50'),
  cashCollection: (id: string) =>
    adminRequest<AdminCashCollectionDetail>(`/admin/cash/collections/${encodeURIComponent(id)}`),
  recordCashCollection: (
    collection: AdminCashCollectionDetail,
    collectedMillimes: number,
    reasonDetail?: string,
  ) =>
    adminRequest<AdminCashCollectionDetail>(
      `/admin/cash/collections/${encodeURIComponent(collection.id)}/record`,
      {
        method: 'POST',
        body: jsonBody({
          collectedMillimes,
          expectedOrderVersion: collection.orderVersion,
          expectedDeliveryVersion: collection.delivery?.version,
          ...(reasonDetail ? { reasonCode: 'MANUAL_DIFFERENCE', reasonDetail } : {}),
          confirmation: 'RECORD_COLLECTION',
        }),
      },
    ),
  cashRemittances: () =>
    adminRequest<Pagination<AdminCashRemittance>>('/admin/cash/remittances?page=1&limit=50'),
  createCashRemittance: (payload: {
    courierId: string;
    remittanceNumber: string;
    declaredMillimes: number;
    collectionId: string;
    amountMillimes: number;
  }) =>
    adminRequest<AdminCashRemittance>('/admin/cash/remittances', {
      method: 'POST',
      body: jsonBody({
        courierId: payload.courierId,
        remittanceNumber: payload.remittanceNumber,
        declaredMillimes: payload.declaredMillimes,
        allocations: [
          { cashCollectionId: payload.collectionId, amountMillimes: payload.amountMillimes },
        ],
        confirmation: 'CREATE_REMITTANCE',
      }),
    }),
  submitCashRemittance: (id: string) =>
    adminRequest<AdminCashRemittance>(`/admin/cash/remittances/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      body: jsonBody({ confirmation: 'SUBMIT_REMITTANCE' }),
    }),
  reconcileCashRemittance: (id: string, verifiedMillimes: number, reasonDetail?: string) =>
    adminRequest<AdminCashRemittance>(
      `/admin/cash/remittances/${encodeURIComponent(id)}/reconcile`,
      {
        method: 'POST',
        body: jsonBody({
          verifiedMillimes,
          ...(reasonDetail ? { reasonCode: 'MANUAL_DIFFERENCE', reasonDetail } : {}),
          confirmation: 'RECONCILE_REMITTANCE',
        }),
      },
    ),
  delivery: (id: string) =>
    adminRequest<AdminDeliveryDetail>(`/admin/deliveries/${encodeURIComponent(id)}`),
  couriers: () => adminRequest<AdminCourierOption[]>('/admin/deliveries/couriers'),
  assignDelivery: (delivery: AdminDeliveryDetail, courierId: string) =>
    adminRequest<AdminDeliveryDetail>(
      `/admin/deliveries/${encodeURIComponent(delivery.id)}/assign`,
      {
        method: 'POST',
        body: jsonBody({ expectedVersion: delivery.version, courierId }),
      },
    ),
  transitionDelivery: (delivery: AdminDeliveryDetail, targetStatus: string) =>
    adminRequest<AdminDeliveryDetail>(
      `/admin/deliveries/${encodeURIComponent(delivery.id)}/transitions`,
      {
        method: 'POST',
        body: jsonBody({ expectedVersion: delivery.version, targetStatus }),
      },
    ),
  recordDeliveryAttempt: (delivery: AdminDeliveryDetail, outcome: string, explanation: string) =>
    adminRequest<AdminDeliveryDetail>(
      `/admin/deliveries/${encodeURIComponent(delivery.id)}/attempts`,
      {
        method: 'POST',
        body: jsonBody({
          expectedVersion: delivery.version,
          outcome,
          ...(explanation ? { explanation } : {}),
        }),
      },
    ),
  completeDelivery: (
    delivery: AdminDeliveryDetail,
    ageVerificationResult: 'NOT_REQUIRED' | 'PASSED',
  ) =>
    adminRequest<AdminDeliveryDetail>(
      `/admin/deliveries/${encodeURIComponent(delivery.id)}/complete`,
      {
        method: 'POST',
        body: jsonBody({
          expectedVersion: delivery.version,
          ageVerificationResult,
          confirmation: 'COMPLETE_DELIVERY',
        }),
      },
    ),
  product: (id: string) =>
    adminRequest<AdminProductRead>(`/admin/products/${encodeURIComponent(id)}`),
  createProduct: (payload: AdminProductCreatePayload) =>
    adminRequest<AdminProductRead>('/admin/products', { method: 'POST', body: jsonBody(payload) }),
  updateProduct: (id: string, payload: AdminProductUpdatePayload) =>
    adminRequest<AdminProductRead>(`/admin/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: jsonBody(payload),
    }),
  productVariants: (productId: string) =>
    adminRequest<{ items: AdminProductVariantRead[] }>(
      `/admin/products/${encodeURIComponent(productId)}/variants`,
    ),
  createProductVariant: (
    productId: string,
    payload: {
      nameFr: string;
      nameAr: string;
      sku: string;
      costMillimes: number;
      priceMillimes: number;
      promotionalPriceMillimes?: number | null;
      lowStockThreshold?: number;
    },
  ) =>
    adminRequest<AdminProductVariantRead>(
      `/admin/products/${encodeURIComponent(productId)}/variants`,
      { method: 'POST', body: jsonBody(payload) },
    ),
  updateProductVariant: (
    productId: string,
    variantId: string,
    payload: {
      version: number;
      priceMillimes?: number;
      promotionalPriceMillimes?: number | null;
      publicationStatus?: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED';
      lowStockThreshold?: number;
    },
  ) =>
    adminRequest<AdminProductVariantRead>(
      `/admin/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
      { method: 'PATCH', body: jsonBody(payload) },
    ),
  productVariantArchiveAction: (
    productId: string,
    variantId: string,
    action: 'archive' | 'restore',
    version: number,
  ) =>
    adminRequest<AdminProductVariantRead>(
      `/admin/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/${action}`,
      { method: 'POST', body: jsonBody({ version }) },
    ),
  order: (id: string) => adminRequest<AdminOrderDetail>(`/admin/orders/${encodeURIComponent(id)}`),
  confirmOrder: (id: string, expectedVersion: number) =>
    adminRequest<AdminOrderDetail>(`/admin/orders/${encodeURIComponent(id)}/confirm`, {
      method: 'POST',
      body: jsonBody({ expectedVersion, confirmed: true }),
    }),
  cancelOrder: (id: string, expectedVersion: number, reason: string) =>
    adminRequest<AdminOrderDetail>(`/admin/orders/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: jsonBody({ expectedVersion, confirmed: true, confirmation: 'CANCEL_ORDER', reason }),
    }),
  rejectOrder: (id: string, expectedVersion: number, reason: string) =>
    adminRequest<AdminOrderDetail>(`/admin/orders/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: jsonBody({ expectedVersion, confirmed: true, confirmation: 'REJECT_ORDER', reason }),
    }),
  prepareOrder: (id: string, expectedVersion: number) =>
    adminRequest<AdminOrderDetail>(`/admin/orders/${encodeURIComponent(id)}/prepare`, {
      method: 'POST',
      body: jsonBody({ expectedVersion }),
    }),
  readyOrderForPickup: (id: string, expectedVersion: number) =>
    adminRequest<AdminOrderDetail>(`/admin/orders/${encodeURIComponent(id)}/ready-for-pickup`, {
      method: 'POST',
      body: jsonBody({ expectedVersion }),
    }),
  recordOrderContactAttempt: (
    id: string,
    payload: {
      expectedVersion: number;
      method: 'PHONE' | 'SMS' | 'EMAIL';
      result: string;
      explanation?: string;
    },
  ) =>
    adminRequest<{ id: string }>(`/admin/orders/${encodeURIComponent(id)}/contact-attempts`, {
      method: 'POST',
      body: jsonBody(payload),
    }),
  addOrderNote: (
    id: string,
    payload: { visibility: 'INTERNAL' | 'CUSTOMER_VISIBLE'; body: string },
  ) =>
    adminRequest<{ id: string }>(`/admin/orders/${encodeURIComponent(id)}/notes`, {
      method: 'POST',
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
