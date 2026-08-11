import { adminRequest } from './admin-client';
import { ApiError, jsonBody } from './http';
import type {
  AdminMetricSet,
  AdminInventoryPage,
  AdminInventoryVariantDetail,
  AdminInventoryLocation,
  AdminBatchReceiptResult,
  AdminInventoryAdjustment,
  AdminInventoryMovement,
  AdminInventoryTransferResult,
  AdminInventoryTransferRecord,
  AccountLifecyclePayload,
  AdminAccount,
  CreateAdminAccountPayload,
  ManagedCustomerAccount,
  AdminCustomerDetail,
  AdminCustomerExport,
  AdminProductCreatePayload,
  AdminProductImage,
  AdminProductRead,
  AdminProductVariantCreatePayload,
  AdminProductVariantRead,
  AdminProductVariantUpdatePayload,
  AdminProductUpdatePayload,
  AdminOrderDetail,
  AdminRecord,
  AdminBrandTaxonomy,
  AdminCategoryTaxonomy,
  AdminSettingRecord,
  StoreConfigurationExport,
  AdminDeliveryZoneConfig,
  AdminDeliveryZoneInput,
  AdminDeliveryRateConfig,
  AdminPickupConfig,
  AdminCashCollection,
  AdminCashCollectionDetail,
  AdminCashRemittance,
  AdminCashRemittanceDetail,
  AdminCourierAssignmentOption,
  AdminCourierAssignmentWarning,
  AdminCourierAvailabilityStatus,
  AdminCourierRecord,
  AdminCourierStatus,
  AdminCourierWhatsAppPreview,
  AdminCsvDownload,
  AdminDeliveryDetail,
  AdminDeliveryManifest,
  AdminDeliveryManifestStatus,
  AdminDeliveryManifestSummary,
  AdminDeliveryStatusImportResult,
  AdminCatalogImportBatch,
  AdminCatalogMediaImportResult,
  AdminCatalogImportPreviewPayload,
  GeographyOption,
  Pagination,
} from './types';

const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

type UploadProgress = (percentage: number) => void;

const adminCsrfToken = (): string | undefined => {
  if (typeof document === 'undefined') return undefined;
  for (const name of ['__Host-vape_admin_csrf', 'vape_admin_csrf']) {
    const value = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    if (value) return decodeURIComponent(value);
  }
  return undefined;
};

const parseXhrPayload = (responseText: string): unknown => {
  if (!responseText) return undefined;
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    return undefined;
  }
};

const unwrapXhrPayload = <T>(payload: unknown): T => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
};

/** XMLHttpRequest is intentionally limited to multipart uploads so the UI can report real bytes. */
const adminMultipartRequest = <T>(
  path: string,
  body: FormData,
  onProgress?: UploadProgress,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${apiBase}/api/v1${path}`, true);
    request.withCredentials = true;
    request.timeout = 120_000;
    request.setRequestHeader('Accept', 'application/json');
    request.setRequestHeader(
      'Accept-Language',
      document.documentElement.lang === 'ar' ? 'ar' : 'fr',
    );
    request.setRequestHeader('X-Client-Context', 'admin');
    const csrfToken = adminCsrfToken();
    if (csrfToken) request.setRequestHeader('X-CSRF-Token', csrfToken);

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress?.(Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100))));
    });
    request.addEventListener('load', () => {
      const payload = parseXhrPayload(request.responseText);
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve(unwrapXhrPayload<T>(payload));
        return;
      }
      reject(
        new ApiError(
          request.status,
          payload as
            | {
                code?: string;
                message?: string;
                requestId?: string;
                errors?: Record<string, string[]>;
              }
            | undefined,
        ),
      );
    });
    request.addEventListener('error', () => {
      reject(
        new ApiError(0, {
          code: 'NETWORK_ERROR',
          message: 'The product image upload could not reach the server.',
        }),
      );
    });
    request.addEventListener('abort', () => {
      reject(
        new ApiError(0, {
          code: 'REQUEST_ABORTED',
          message: 'The product image upload was cancelled.',
        }),
      );
    });
    request.addEventListener('timeout', () => {
      reject(
        new ApiError(0, {
          code: 'REQUEST_TIMEOUT',
          message: 'The product image upload timed out.',
        }),
      );
    });
    request.send(body);
  });

const csvFilename = (header: string | null, fallback: string): string => {
  const captured = /filename="?([^";]+)"?/i.exec(header ?? '')?.[1];
  const sanitized = captured?.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return sanitized || fallback;
};

async function adminCsvRequest(path: string, fallbackFilename: string): Promise<AdminCsvDownload> {
  const response = await fetch(`${apiBase}/api/v1${path}`, {
    method: 'GET',
    headers: {
      Accept: 'text/csv',
      'Accept-Language': document.documentElement.lang === 'ar' ? 'ar' : 'fr',
      'X-Client-Context': 'admin',
    },
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) {
    const payload = response.headers.get('content-type')?.includes('application/json')
      ? ((await response.json()) as {
          code?: string;
          message?: string;
          requestId?: string;
          errors?: Record<string, string[]>;
        })
      : undefined;
    throw new ApiError(response.status, payload);
  }
  const rowCountHeader = response.headers.get('X-Export-Row-Count');
  const rowCount = rowCountHeader === null ? Number.NaN : Number(rowCountHeader);
  return {
    content: await response.text(),
    filename: csvFilename(response.headers.get('Content-Disposition'), fallbackFilename),
    rowCount: Number.isSafeInteger(rowCount) && rowCount >= 0 ? rowCount : null,
  };
}

export const adminDataClient = {
  dashboard: () => adminRequest<AdminMetricSet>('/admin/dashboard'),
  inventory: (query: string) => adminRequest<AdminInventoryPage>(`/admin/inventory?${query}`),
  downloadInventory: (query: string) =>
    adminCsvRequest(`/admin/inventory/export.csv${query ? `?${query}` : ''}`, 'inventory.csv'),
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
  receiveInventoryBatch: (
    payload: {
      variantId: string;
      locationId: string;
      batchNumber: string;
      supplierId?: string;
      supplierReference?: string;
      manufacturedAt?: string;
      expiryDate: string;
      quantity: number;
      note?: string;
    },
    idempotencyKey: string,
  ) =>
    adminRequest<AdminBatchReceiptResult>('/admin/inventory/batches/receipts', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
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
    adminRequest<{
      adjustmentId: string;
      inventoryItemId: string;
      status: 'PENDING_APPROVAL';
      requiresApproval: true;
      proposedOnHandQuantity: number;
      currentOnHandQuantity: number;
      reservedQuantity: number;
      expectedVersion: number;
      expiresAt: string;
    }>(`/admin/inventory/items/${encodeURIComponent(itemId)}/adjustments`, {
      method: 'POST',
      body: jsonBody(payload),
    }),
  inventoryAdjustments: (status = 'PENDING_APPROVAL') =>
    adminRequest<Pagination<AdminInventoryAdjustment>>(
      `/admin/inventory/adjustments?page=1&limit=50&status=${encodeURIComponent(status)}`,
    ),
  decideInventoryAdjustment: (
    adjustmentId: string,
    decision: 'APPROVE' | 'REJECT',
    reason?: string,
  ) =>
    adminRequest<{
      adjustmentId: string;
      inventoryItemId: string;
      status: string;
      replayed: boolean;
    }>(`/admin/inventory/adjustments/${encodeURIComponent(adjustmentId)}/decision`, {
      method: 'POST',
      body: jsonBody({ decision, ...(reason ? { reason } : {}) }),
    }),
  inventoryMovements: (itemId: string) =>
    adminRequest<Pagination<AdminInventoryMovement>>(
      `/admin/inventory/items/${encodeURIComponent(itemId)}/movements?page=1&limit=50`,
    ),
  transferInventory: (
    itemId: string,
    payload: {
      destinationLocationId: string;
      quantity: number;
      expectedSourceVersion: number;
      note?: string;
    },
    idempotencyKey: string,
  ) =>
    adminRequest<AdminInventoryTransferResult>(
      `/admin/inventory/items/${encodeURIComponent(itemId)}/transfers`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: jsonBody(payload),
      },
    ),
  inventoryTransfers: () =>
    adminRequest<Pagination<AdminInventoryTransferRecord>>(
      '/admin/inventory/transfers?page=1&limit=50',
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
  brands: () =>
    adminRequest<Pagination<AdminBrandTaxonomy>>('/admin/brands?page=1&limit=50&sort=name_asc'),
  categories: () =>
    adminRequest<Pagination<AdminCategoryTaxonomy>>(
      '/admin/categories?page=1&limit=50&sort=name_asc',
    ),
  createBrand: (payload: {
    name: string;
    slug: string;
    descriptionFr?: string;
    descriptionAr?: string;
  }) =>
    adminRequest<AdminBrandTaxonomy>('/admin/brands', {
      method: 'POST',
      body: jsonBody(payload),
    }),
  publishBrand: (brand: AdminBrandTaxonomy) =>
    adminRequest<AdminBrandTaxonomy>(`/admin/brands/${encodeURIComponent(brand.id)}`, {
      method: 'PATCH',
      body: jsonBody({
        expectedUpdatedAt: brand.updatedAt,
        publicationStatus: 'PUBLISHED',
      }),
    }),
  createCategory: (payload: {
    nameFr: string;
    nameAr: string;
    slug: string;
    parentId?: string;
    descriptionFr?: string;
    descriptionAr?: string;
  }) =>
    adminRequest<AdminCategoryTaxonomy>('/admin/categories', {
      method: 'POST',
      body: jsonBody(payload),
    }),
  publishCategory: (category: AdminCategoryTaxonomy) =>
    adminRequest<AdminCategoryTaxonomy>(`/admin/categories/${encodeURIComponent(category.id)}`, {
      method: 'PATCH',
      body: jsonBody({
        expectedUpdatedAt: category.updatedAt,
        publicationStatus: 'PUBLISHED',
      }),
    }),
  settings: (query = 'page=1&limit=50') =>
    adminRequest<Pagination<AdminSettingRecord>>(`/admin/settings?${query}`),
  exportSettings: () =>
    adminRequest<StoreConfigurationExport>('/admin/settings/export', { method: 'POST' }),
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
  deliveryGeographyGovernorates: () =>
    adminRequest<GeographyOption[]>('/admin/delivery-config/geography/governorates'),
  deliveryGeographyDelegations: (governorateId: string) =>
    adminRequest<GeographyOption[]>(
      `/admin/delivery-config/geography/governorates/${encodeURIComponent(governorateId)}/delegations`,
    ),
  deliveryGeographyLocalities: (delegationId: string) =>
    adminRequest<GeographyOption[]>(
      `/admin/delivery-config/geography/delegations/${encodeURIComponent(delegationId)}/localities`,
    ),
  deliveryRates: () =>
    adminRequest<Pagination<AdminDeliveryRateConfig>>(
      '/admin/delivery-config/rates?page=1&limit=50',
    ),
  pickupLocations: () =>
    adminRequest<Pagination<AdminPickupConfig>>('/admin/delivery-config/pickups?page=1&limit=50'),
  createDeliveryZone: (payload: AdminDeliveryZoneInput) =>
    adminRequest<AdminDeliveryZoneConfig>('/admin/delivery-config/zones', {
      method: 'POST',
      body: jsonBody(payload),
    }),
  updateDeliveryZone: (zone: AdminDeliveryZoneConfig, payload: Partial<AdminDeliveryZoneInput>) =>
    adminRequest<AdminDeliveryZoneConfig>(
      `/admin/delivery-config/zones/${encodeURIComponent(zone.id)}`,
      {
        method: 'PATCH',
        body: jsonBody({ ...payload, expectedUpdatedAt: zone.updatedAt }),
      },
    ),
  linkDeliveryZoneGeography: (
    zone: AdminDeliveryZoneConfig,
    scope: 'GOVERNORATE' | 'DELEGATION' | 'LOCALITY',
    geographyId: string,
    active: boolean,
  ) =>
    adminRequest<AdminDeliveryZoneConfig>(
      `/admin/delivery-config/zones/${encodeURIComponent(zone.id)}/geography-links`,
      {
        method: 'PUT',
        body: jsonBody({
          expectedUpdatedAt: zone.updatedAt,
          confirmed: true,
          scope,
          geographyId,
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
  createDeliveryRate: (payload: {
    deliveryZoneId: string;
    name: string;
    feeMillimes: number;
    priority?: number;
    express?: boolean;
  }) =>
    adminRequest<AdminDeliveryRateConfig>('/admin/delivery-config/rates', {
      method: 'POST',
      body: jsonBody({ type: 'BASE', priority: 0, ...payload }),
    }),
  updateDeliveryRate: (rate: AdminDeliveryRateConfig, payload: { feeMillimes: number }) =>
    adminRequest<AdminDeliveryRateConfig>(
      `/admin/delivery-config/rates/${encodeURIComponent(rate.id)}`,
      {
        method: 'PATCH',
        body: jsonBody({ ...payload, expectedVersion: rate.version }),
      },
    ),
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
  downloadCashCollections: (query = '') =>
    adminCsvRequest(
      `/admin/cash/collections/export.csv${query ? `?${query}` : ''}`,
      'cod-collections.csv',
    ),
  cashCollection: (id: string) =>
    adminRequest<AdminCashCollectionDetail>(`/admin/cash/collections/${encodeURIComponent(id)}`),
  recordCashCollection: (
    collection: AdminCashCollectionDetail,
    collectedMillimes: number,
    idempotencyKey: string,
    reasonDetail?: string,
  ) =>
    adminRequest<AdminCashCollectionDetail>(
      `/admin/cash/collections/${encodeURIComponent(collection.id)}/record`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
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
  downloadCashRemittances: (query = '') =>
    adminCsvRequest(
      `/admin/cash/remittances/export.csv${query ? `?${query}` : ''}`,
      'cod-remittances.csv',
    ),
  cashRemittance: (id: string) =>
    adminRequest<AdminCashRemittanceDetail>(`/admin/cash/remittances/${encodeURIComponent(id)}`),
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
  resolveCashDiscrepancy: (
    discrepancyId: string,
    resolution: 'RESOLVED' | 'WRITTEN_OFF',
    reasonDetail: string,
    finalVerifiedMillimes?: number,
  ) =>
    adminRequest<AdminCashCollectionDetail | AdminCashRemittanceDetail>(
      `/admin/cash/discrepancies/${encodeURIComponent(discrepancyId)}/resolve`,
      {
        method: 'POST',
        body: jsonBody({
          resolution,
          reasonDetail,
          ...(resolution === 'RESOLVED' && finalVerifiedMillimes !== undefined
            ? { finalVerifiedMillimes }
            : {}),
          confirmation: 'RESOLVE_DISCREPANCY',
        }),
      },
    ),
  delivery: (id: string) =>
    adminRequest<AdminDeliveryDetail>(`/admin/deliveries/${encodeURIComponent(id)}`),
  couriers: (deliveryId?: string) =>
    adminRequest<AdminCourierAssignmentOption[]>(
      `/admin/deliveries/couriers${deliveryId ? `?deliveryId=${encodeURIComponent(deliveryId)}` : ''}`,
    ),
  courierRecords: (query = 'page=1&limit=50') =>
    adminRequest<Pagination<AdminCourierRecord>>(`/admin/deliveries/courier-records?${query}`),
  createCourierRecord: (payload: {
    code: string;
    name: string;
    companyName?: string;
    availabilityStatus?: AdminCourierAvailabilityStatus;
    contactName?: string;
    phoneE164?: string;
    whatsappPhoneE164?: string;
    email?: string;
    defaultFeeMillimes?: number;
    maximumActiveDeliveries?: number;
    whatsappTemplate?: string;
    coverageZones?: Array<{
      deliveryZoneId: string;
      active?: boolean;
      feeMillimes?: number;
    }>;
    notes?: string;
  }) =>
    adminRequest<AdminCourierRecord>('/admin/deliveries/courier-records', {
      method: 'POST',
      body: jsonBody({ ...payload, confirmation: 'CREATE_MANUAL_COURIER' }),
    }),
  updateCourierRecord: (
    courier: AdminCourierRecord,
    payload: {
      code?: string;
      name?: string;
      companyName?: string | null;
      status?: AdminCourierStatus;
      availabilityStatus?: AdminCourierAvailabilityStatus;
      contactName?: string | null;
      phoneE164?: string | null;
      whatsappPhoneE164?: string | null;
      email?: string | null;
      defaultFeeMillimes?: number | null;
      maximumActiveDeliveries?: number | null;
      whatsappTemplate?: string | null;
      coverageZones?: Array<{
        deliveryZoneId: string;
        active?: boolean;
        feeMillimes?: number;
      }>;
      notes?: string | null;
    },
  ) =>
    adminRequest<AdminCourierRecord>(
      `/admin/deliveries/courier-records/${encodeURIComponent(courier.id)}`,
      {
        method: 'PATCH',
        body: jsonBody({
          expectedUpdatedAt: courier.updatedAt,
          ...payload,
          confirmation: 'UPDATE_MANUAL_COURIER',
        }),
      },
    ),
  updateCourierStatus: (courier: AdminCourierRecord, status: AdminCourierStatus) =>
    adminDataClient.updateCourierRecord(courier, { status }),
  deliveryManifests: (query = 'page=1&limit=50') =>
    adminRequest<Pagination<AdminDeliveryManifestSummary>>(`/admin/deliveries/manifests?${query}`),
  deliveryManifest: (id: string) =>
    adminRequest<AdminDeliveryManifest>(`/admin/deliveries/manifests/${encodeURIComponent(id)}`),
  createDeliveryManifest: (payload: {
    courierId: string;
    manifestDate: string;
    deliveries: Array<{ deliveryId: string; expectedVersion: number }>;
  }) =>
    adminRequest<AdminDeliveryManifest>('/admin/deliveries/manifests', {
      method: 'POST',
      body: jsonBody({ ...payload, confirmation: 'CREATE_DELIVERY_MANIFEST' }),
    }),
  transitionDeliveryManifest: (
    manifest: Pick<AdminDeliveryManifest, 'id' | 'status'>,
    targetStatus: Exclude<AdminDeliveryManifestStatus, 'DRAFT'>,
    reason?: string,
  ) =>
    adminRequest<AdminDeliveryManifest>(
      `/admin/deliveries/manifests/${encodeURIComponent(manifest.id)}/transitions`,
      {
        method: 'POST',
        body: jsonBody({
          expectedStatus: manifest.status,
          targetStatus,
          ...(reason ? { reason } : {}),
          confirmation: 'TRANSITION_DELIVERY_MANIFEST',
        }),
      },
    ),
  downloadDeliveryManifest: (id: string) =>
    adminCsvRequest(
      `/admin/deliveries/manifests/${encodeURIComponent(id)}/export.csv`,
      'delivery-manifest.csv',
    ),
  downloadDeliveryStatuses: (query: string) =>
    adminCsvRequest(
      `/admin/deliveries/exports/status.csv${query ? `?${query}` : ''}`,
      'delivery-status.csv',
    ),
  importDeliveryStatuses: (payload: { importKey: string; dryRun: boolean; csv: string }) =>
    adminRequest<AdminDeliveryStatusImportResult>('/admin/deliveries/imports/status', {
      method: 'POST',
      body: jsonBody({
        ...payload,
        ...(payload.dryRun ? {} : { confirmation: 'APPLY_DELIVERY_STATUS_IMPORT' }),
      }),
    }),
  assignDelivery: (
    delivery: AdminDeliveryDetail,
    courierId: string,
    acknowledgedWarnings: AdminCourierAssignmentWarning[] = [],
    trackingNumber?: string,
    note?: string,
  ) =>
    adminRequest<AdminDeliveryDetail>(
      `/admin/deliveries/${encodeURIComponent(delivery.id)}/assign`,
      {
        method: 'POST',
        body: jsonBody({
          expectedVersion: delivery.version,
          courierId,
          ...(acknowledgedWarnings.length > 0 ? { acknowledgedWarnings } : {}),
          ...(trackingNumber ? { trackingNumber } : {}),
          ...(note ? { note } : {}),
        }),
      },
    ),
  reassignDelivery: (
    delivery: AdminDeliveryDetail,
    courierId: string,
    reason: string,
    acknowledgedWarnings: AdminCourierAssignmentWarning[] = [],
    trackingNumber?: string,
    note?: string,
  ) =>
    adminRequest<AdminDeliveryDetail>(
      `/admin/deliveries/${encodeURIComponent(delivery.id)}/reassign`,
      {
        method: 'POST',
        body: jsonBody({
          expectedVersion: delivery.version,
          courierId,
          reason,
          ...(acknowledgedWarnings.length > 0 ? { acknowledgedWarnings } : {}),
          ...(trackingNumber ? { trackingNumber } : {}),
          ...(note ? { note } : {}),
        }),
      },
    ),
  unassignDelivery: (delivery: AdminDeliveryDetail, reason: string) =>
    adminRequest<AdminDeliveryDetail>(
      `/admin/deliveries/${encodeURIComponent(delivery.id)}/unassign`,
      {
        method: 'POST',
        body: jsonBody({
          expectedVersion: delivery.version,
          reason,
          confirmation: 'UNASSIGN_COURIER',
        }),
      },
    ),
  courierWhatsAppPreview: (deliveryId: string) =>
    adminRequest<AdminCourierWhatsAppPreview>(
      `/admin/deliveries/${encodeURIComponent(deliveryId)}/courier-whatsapp`,
    ),
  recordCourierWhatsAppContact: (delivery: AdminDeliveryDetail) =>
    adminRequest<AdminDeliveryDetail>(
      `/admin/deliveries/${encodeURIComponent(delivery.id)}/courier-contacted`,
      {
        method: 'POST',
        body: jsonBody({
          expectedVersion: delivery.version,
          confirmation: 'RECORD_COURIER_WHATSAPP_CONTACT',
        }),
      },
    ),
  updateDeliveryInternalNotes: (delivery: AdminDeliveryDetail, internalNotes: string | null) =>
    adminRequest<AdminDeliveryDetail>(
      `/admin/deliveries/${encodeURIComponent(delivery.id)}/internal-notes`,
      {
        method: 'PATCH',
        body: jsonBody({ expectedVersion: delivery.version, internalNotes }),
      },
    ),
  transitionDelivery: (delivery: AdminDeliveryDetail, targetStatus: string, explanation?: string) =>
    adminRequest<AdminDeliveryDetail>(
      `/admin/deliveries/${encodeURIComponent(delivery.id)}/transitions`,
      {
        method: 'POST',
        body: jsonBody({
          expectedVersion: delivery.version,
          targetStatus,
          ...(explanation ? { explanation } : {}),
        }),
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
  catalogImportHistory: (page = 1, pageSize = 20) =>
    adminRequest<Pagination<AdminCatalogImportBatch>>(
      `/admin/catalog/imports?page=${page}&pageSize=${pageSize}`,
    ),
  catalogImport: (id: string) =>
    adminRequest<AdminCatalogImportBatch>(`/admin/catalog/imports/${encodeURIComponent(id)}`),
  previewCatalogImport: (
    payload: AdminCatalogImportPreviewPayload,
    onProgress?: UploadProgress,
  ) => {
    const body = new FormData();
    body.set('file', payload.file);
    body.set('importKey', payload.importKey);
    body.set('format', payload.format);
    body.set('partialMode', String(payload.partialMode));
    body.set('overridePrice', String(payload.overridePrice));
    body.set('overrideStatus', String(payload.overrideStatus));
    body.set('overrideImages', String(payload.overrideImages));
    return adminMultipartRequest<AdminCatalogImportBatch>(
      '/admin/catalog/imports/preview',
      body,
      onProgress,
    );
  },
  previewOfficialWotofoCatalog: (importKey: string) =>
    adminRequest<AdminCatalogImportBatch>('/admin/catalog/imports/wotofo/preview', {
      method: 'POST',
      body: jsonBody({ importKey }),
    }),
  applyCatalogImport: (id: string) =>
    adminRequest<AdminCatalogImportBatch>(
      `/admin/catalog/imports/${encodeURIComponent(id)}/apply`,
      {
        method: 'POST',
        body: jsonBody({ confirmation: 'APPLY_CATALOG_IMPORT' }),
      },
    ),
  rollbackCatalogImport: (id: string) =>
    adminRequest<AdminCatalogImportBatch>(
      `/admin/catalog/imports/${encodeURIComponent(id)}/rollback`,
      {
        method: 'POST',
        body: jsonBody({ confirmation: 'ROLLBACK_CATALOG_IMPORT' }),
      },
    ),
  importCatalogMedia: (id: string) =>
    adminRequest<AdminCatalogMediaImportResult>(
      `/admin/catalog/imports/${encodeURIComponent(id)}/media/apply`,
      {
        method: 'POST',
        body: jsonBody({ confirmation: 'IMPORT_CATALOG_MEDIA' }),
      },
    ),
  downloadCatalogImportTemplate: () =>
    adminCsvRequest('/admin/catalog/imports/template.csv', 'catalog-import-v1.csv'),
  createProduct: (payload: AdminProductCreatePayload) =>
    adminRequest<AdminProductRead>('/admin/products', { method: 'POST', body: jsonBody(payload) }),
  updateProduct: (id: string, payload: AdminProductUpdatePayload) =>
    adminRequest<AdminProductRead>(`/admin/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: jsonBody(payload),
    }),
  confirmProductMediaReview: (id: string, version: number, reason: string) =>
    adminRequest<AdminProductRead>(
      `/admin/products/${encodeURIComponent(id)}/media-review/confirm`,
      {
        method: 'POST',
        body: jsonBody({
          version,
          reason,
          confirmation: 'CONFIRM_PRODUCT_MEDIA_REVIEW',
        }),
      },
    ),
  archiveProduct: (id: string, version: number) =>
    adminRequest<AdminProductRead>(`/admin/products/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      body: jsonBody({ version }),
    }),
  restoreProduct: (id: string, version: number) =>
    adminRequest<AdminProductRead>(`/admin/products/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      body: jsonBody({ version }),
    }),
  productVariants: (productId: string) =>
    adminRequest<{ items: AdminProductVariantRead[] }>(
      `/admin/products/${encodeURIComponent(productId)}/variants`,
    ),
  createProductVariant: (productId: string, payload: AdminProductVariantCreatePayload) =>
    adminRequest<AdminProductVariantRead>(
      `/admin/products/${encodeURIComponent(productId)}/variants`,
      { method: 'POST', body: jsonBody(payload) },
    ),
  updateProductVariant: (
    productId: string,
    variantId: string,
    payload: AdminProductVariantUpdatePayload,
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
  productImages: (productId: string, page = 1, pageSize = 50, reviewRequired = false) =>
    adminRequest<Pagination<AdminProductImage>>(
      `/admin/products/${encodeURIComponent(productId)}/images?page=${page}&pageSize=${pageSize}&reviewRequired=${reviewRequired}`,
    ),
  productImagesForOwner: (productId: string, variantId: string | null) =>
    adminRequest<Pagination<AdminProductImage>>(
      `/admin/products/${encodeURIComponent(productId)}/images?page=1&pageSize=20&${variantId ? `variantId=${encodeURIComponent(variantId)}` : 'productOnly=true'}`,
    ),
  uploadProductImage: (
    productId: string,
    payload: {
      file: File;
      expectedOwnerVersion: number;
      variantId?: string;
      altTextFr: string;
      altTextAr: string;
      isPrimary: boolean;
    },
    onProgress?: UploadProgress,
  ) => {
    const body = new FormData();
    body.set('file', payload.file);
    body.set('expectedOwnerVersion', String(payload.expectedOwnerVersion));
    if (payload.variantId) body.set('variantId', payload.variantId);
    body.set('altTextFr', payload.altTextFr);
    body.set('altTextAr', payload.altTextAr);
    body.set('isPrimary', String(payload.isPrimary));
    return adminMultipartRequest<AdminProductImage>(
      `/admin/products/${encodeURIComponent(productId)}/images`,
      body,
      onProgress,
    );
  },
  updateProductImage: (
    productId: string,
    image: AdminProductImage,
    payload: { altTextFr: string; altTextAr: string },
  ) =>
    adminRequest<AdminProductImage>(
      `/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.id)}`,
      {
        method: 'PATCH',
        body: jsonBody({ expectedOwnerVersion: image.ownerVersion, ...payload }),
      },
    ),
  replaceProductImage: (
    productId: string,
    image: AdminProductImage,
    file: File,
    onProgress?: UploadProgress,
  ) => {
    const body = new FormData();
    body.set('file', file);
    body.set('expectedOwnerVersion', String(image.ownerVersion));
    return adminMultipartRequest<AdminProductImage>(
      `/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.id)}/replace`,
      body,
      onProgress,
    );
  },
  setPrimaryProductImage: (productId: string, image: AdminProductImage) =>
    adminRequest<AdminProductImage>(
      `/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.id)}/primary`,
      { method: 'POST', body: jsonBody({ expectedOwnerVersion: image.ownerVersion }) },
    ),
  reviewProductImage: (
    productId: string,
    image: AdminProductImage,
    decision: 'APPROVE' | 'REJECT',
  ) =>
    adminRequest<AdminProductImage>(
      `/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.id)}/review`,
      {
        method: 'POST',
        body: jsonBody({
          expectedOwnerVersion: image.ownerVersion,
          decision,
          confirmation: 'REVIEW_IMPORTED_PRODUCT_IMAGE',
        }),
      },
    ),
  reorderProductImages: (productId: string, image: AdminProductImage, imageIds: string[]) =>
    adminRequest<{ items: AdminProductImage[]; ownerVersion: number }>(
      `/admin/products/${encodeURIComponent(productId)}/images/reorder`,
      {
        method: 'POST',
        body: jsonBody({
          expectedOwnerVersion: image.ownerVersion,
          ...(image.variantId ? { variantId: image.variantId } : {}),
          imageIds,
        }),
      },
    ),
  deleteProductImage: (productId: string, image: AdminProductImage) =>
    adminRequest<{ id: string; deleted: true; ownerVersion: number }>(
      `/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.id)}?expectedOwnerVersion=${image.ownerVersion}`,
      { method: 'DELETE' },
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
  customer: (id: string) =>
    adminRequest<AdminCustomerDetail>(`/admin/customers/${encodeURIComponent(id)}`),
  addCustomerNote: (id: string, body: string) =>
    adminRequest<{ id: string }>(`/admin/customers/${encodeURIComponent(id)}/notes`, {
      method: 'POST',
      body: jsonBody({ body }),
    }),
  triggerCustomerPasswordReset: (id: string) =>
    adminRequest<{ queued: boolean }>(`/admin/customers/${encodeURIComponent(id)}/password-reset`, {
      method: 'POST',
    }),
  revokeCustomerSessions: (id: string) =>
    adminRequest<{ revokedSessions: number }>(
      `/admin/customers/${encodeURIComponent(id)}/sessions/revoke`,
      { method: 'POST' },
    ),
  exportCustomer: (id: string) =>
    adminRequest<AdminCustomerExport>(`/admin/customers/${encodeURIComponent(id)}/export`),
  customerAction: (
    id: string,
    action: 'suspend' | 'reactivate' | 'disable' | 'anonymize',
    payload: AccountLifecyclePayload & {
      confirmation?: 'DISABLE_CUSTOMER' | 'ANONYMIZE_CUSTOMER';
    },
  ) =>
    adminRequest<ManagedCustomerAccount>(`/admin/customers/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: jsonBody(payload),
    }),
};
