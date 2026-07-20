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
  AdminProductVariantRead,
  AdminProductUpdatePayload,
  AdminOrderDetail,
  AdminRecord,
  AdminBrandTaxonomy,
  AdminCategoryTaxonomy,
  AdminSettingRecord,
  StoreConfigurationExport,
  AdminDeliveryZoneConfig,
  AdminDeliveryRateConfig,
  AdminPickupConfig,
  AdminCashCollection,
  AdminCashCollectionDetail,
  AdminCashRemittance,
  AdminCashRemittanceDetail,
  AdminCourierOption,
  AdminCourierRecord,
  AdminCourierStatus,
  AdminCsvDownload,
  AdminDeliveryDetail,
  AdminDeliveryManifest,
  AdminDeliveryManifestStatus,
  AdminDeliveryManifestSummary,
  AdminDeliveryStatusImportResult,
  Pagination,
} from './types';

const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

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
  const rowCount = Number(response.headers.get('X-Export-Row-Count'));
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
    adminRequest<AdminCashRemittanceDetail>(
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
  couriers: () => adminRequest<AdminCourierOption[]>('/admin/deliveries/couriers'),
  courierRecords: (query = 'page=1&limit=50') =>
    adminRequest<Pagination<AdminCourierRecord>>(`/admin/deliveries/courier-records?${query}`),
  createCourierRecord: (payload: {
    code: string;
    name: string;
    contactName?: string;
    phoneE164?: string;
    email?: string;
    notes?: string;
  }) =>
    adminRequest<AdminCourierRecord>('/admin/deliveries/courier-records', {
      method: 'POST',
      body: jsonBody({ ...payload, confirmation: 'CREATE_MANUAL_COURIER' }),
    }),
  updateCourierStatus: (courier: AdminCourierRecord, status: AdminCourierStatus) =>
    adminRequest<AdminCourierRecord>(
      `/admin/deliveries/courier-records/${encodeURIComponent(courier.id)}`,
      {
        method: 'PATCH',
        body: jsonBody({
          expectedUpdatedAt: courier.updatedAt,
          status,
          confirmation: 'UPDATE_MANUAL_COURIER',
        }),
      },
    ),
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
  assignDelivery: (delivery: AdminDeliveryDetail, courierId: string) =>
    adminRequest<AdminDeliveryDetail>(
      `/admin/deliveries/${encodeURIComponent(delivery.id)}/assign`,
      {
        method: 'POST',
        body: jsonBody({ expectedVersion: delivery.version, courierId }),
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
  createProduct: (payload: AdminProductCreatePayload) =>
    adminRequest<AdminProductRead>('/admin/products', { method: 'POST', body: jsonBody(payload) }),
  updateProduct: (id: string, payload: AdminProductUpdatePayload) =>
    adminRequest<AdminProductRead>(`/admin/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: jsonBody(payload),
    }),
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
  productImages: (productId: string) =>
    adminRequest<Pagination<AdminProductImage>>(
      `/admin/products/${encodeURIComponent(productId)}/images?page=1&pageSize=50`,
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
  ) => {
    const body = new FormData();
    body.set('file', payload.file);
    body.set('expectedOwnerVersion', String(payload.expectedOwnerVersion));
    if (payload.variantId) body.set('variantId', payload.variantId);
    body.set('altTextFr', payload.altTextFr);
    body.set('altTextAr', payload.altTextAr);
    body.set('isPrimary', String(payload.isPrimary));
    return adminRequest<AdminProductImage>(
      `/admin/products/${encodeURIComponent(productId)}/images`,
      { method: 'POST', body },
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
  replaceProductImage: (productId: string, image: AdminProductImage, file: File) => {
    const body = new FormData();
    body.set('file', file);
    body.set('expectedOwnerVersion', String(image.ownerVersion));
    return adminRequest<AdminProductImage>(
      `/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.id)}/replace`,
      { method: 'POST', body },
    );
  },
  setPrimaryProductImage: (productId: string, image: AdminProductImage) =>
    adminRequest<AdminProductImage>(
      `/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(image.id)}/primary`,
      { method: 'POST', body: jsonBody({ expectedOwnerVersion: image.ownerVersion }) },
    ),
  reorderProductImages: (productId: string, image: AdminProductImage, imageIds: string[]) =>
    adminRequest<{ imageIds: string[]; ownerVersion: number }>(
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
    adminRequest<{ deletedImageId: string; ownerVersion: number }>(
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
