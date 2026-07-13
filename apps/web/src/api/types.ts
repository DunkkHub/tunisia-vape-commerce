export interface CustomerUser {
  id: string;
  email: string | null;
  phone: string;
  fullName: string;
  emailVerified: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  requiresRecentAuthentication?: boolean;
}

export interface CustomerSessionResponse {
  user: CustomerUser;
  expiresAt?: string;
}

export interface AdminSessionResponse {
  user: AdminUser;
  expiresAt?: string;
}

export interface AdminChallengeResponse {
  state: 'TOTP_REQUIRED' | 'ENROLLMENT_REQUIRED';
  challengeId: string;
  enrollmentUri?: string;
  manualEntryKey?: string;
}

export interface StorefrontStatus {
  storeName: string;
  maintenanceMode: boolean;
  prelaunchMode: boolean;
  checkoutEnabled: boolean;
  legalReviewCompleted: boolean;
  minimumAge: number;
  ageGateRequired: boolean;
  ageConfirmed: boolean;
}

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
  productCount?: number;
}

export interface BrandSummary {
  id: string;
  name: string;
  slug: string;
}

export type ProductType =
  'DEVICE' | 'E_LIQUID' | 'POD' | 'COIL' | 'DISPOSABLE' | 'ACCESSORY' | 'OTHER';

export interface CatalogFacets {
  brands: BrandSummary[];
  productTypes: ProductType[];
  flavors: Array<{ value: string; productCount: number }>;
  priceRange: {
    minimumMillimes: number | null;
    maximumMillimes: number | null;
  };
  truncated: { brands: boolean; flavors: boolean };
}

export interface ProductImage {
  id: string;
  url: string;
  altText: string | null;
  width?: number;
  height?: number;
}

export interface ProductVariant {
  id: string;
  name: string;
  sku: string;
  priceMillimes: number;
  promotionalPriceMillimes: number | null;
  availableQuantity: number;
  image?: ProductImage | null;
}

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  brandName: string | null;
  brandSlug: string | null;
  productType: ProductType;
  flavor: string | null;
  priceMillimes: number;
  promotionalPriceMillimes: number | null;
  availableQuantity: number;
  lowStock: boolean;
  ageRestricted: boolean;
  primaryImage: ProductImage | null;
}

export interface ProductDetail extends ProductSummary {
  description: string | null;
  sku: string;
  images: ProductImage[];
  variants: ProductVariant[];
  warningText: string | null;
  attributes: Array<{ name: string; value: string }>;
}

export interface Pagination<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CartItem {
  id: string;
  quantity: number;
  unitPriceMillimes: number;
  lineTotalMillimes: number;
  product: ProductSummary;
  variant: ProductVariant | null;
}

export interface Cart {
  id: string;
  items: CartItem[];
  itemCount: number;
  subtotalMillimes: number;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  deliveryStatus: string | null;
  grandTotalMillimes: number;
  currency: 'TND';
  cancellable: boolean;
  version: number;
  createdAt: string;
}

export interface AddressSummary {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  governorate: string;
  delegation: string;
  locality: string;
  postalCode: string;
  street: string;
}

export interface LegalDocument {
  slug: string;
  title: string;
  version: string;
  publishedAt: string;
  content: string;
}

export interface StoreContent {
  title: string;
  content: string;
}

export interface CheckoutPayload {
  items: Array<{ variantId: string; quantity: number }>;
  localityId?: string | undefined;
  pickupLocationId?: string | undefined;
  express?: boolean | undefined;
  customerName: string;
  phone: string;
  email?: string | undefined;
  address?: {
    street: string;
    building?: string | undefined;
    floor?: string | undefined;
    apartment?: string | undefined;
    landmark?: string | undefined;
    postalCode?: string | undefined;
    instructions?: string | undefined;
  };
  consent: {
    ageConfirmed: true;
    termsAccepted: true;
    privacyAccepted: true;
  };
}

export interface CheckoutResult {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  currency: 'TND';
  subtotalMillimes: number;
  discountTotalMillimes: number;
  deliveryTotalMillimes: number;
  taxTotalMillimes: number;
  grandTotalMillimes: number;
  expectedCodMillimes: number;
  deliveryMethodType: 'COURIER' | 'STORE_PICKUP';
  createdAt: string;
}

export interface CheckoutQuoteRequest {
  items: Array<{ variantId: string; quantity: number }>;
  localityId?: string | undefined;
  pickupLocationId?: string | undefined;
  express?: boolean | undefined;
}

export interface CheckoutQuote {
  currency: 'TND';
  subtotalMillimes: number;
  discountTotalMillimes: number;
  deliveryTotalMillimes: number;
  taxTotalMillimes: number;
  grandTotalMillimes: number;
  expectedCodMillimes: number;
  expiresAt: string;
  stockReserved: false;
  orderCreated: false;
}

export interface GeographyOption {
  id: string;
  name: string;
  postalCode?: string;
  supported?: boolean;
}

export interface DeliveryWindowOption {
  id: string;
  label: string;
}

export interface DeliveryMethodOption {
  id: string;
  type: 'COURIER' | 'STORE_PICKUP';
  label: string;
  address: string | null;
  minimumOrderMillimes: number | null;
  maximumCodMillimes: number | null;
}

export interface AdminMetricSet {
  ordersCreated: number;
  ordersDelivered: number;
  codExpectedMillimes: number;
  codRemittedMillimes: number;
  lowStockCount: number;
  deliveryFailureCount: number;
}

export interface AdminOrderDetail {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  status: string;
  paymentStatus: string;
  deliveryMethodType: 'COURIER' | 'STORE_PICKUP';
  currency: 'TND';
  subtotalMillimes: number;
  discountTotalMillimes: number;
  deliveryTotalMillimes: number;
  taxTotalMillimes: number;
  grandTotalMillimes: number;
  expectedCodMillimes: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    productName: string;
    variantName: string;
    sku: string;
    quantity: number;
    unitPriceMillimes: number;
    lineTotalMillimes: number;
  }>;
  addresses: Array<{
    id: string;
    fullName: string;
    phoneE164: string;
    governorateName: string;
    delegationName: string;
    localityName: string | null;
    postalCode: string | null;
    street: string;
  }>;
  history: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    reasonCode: string | null;
    note: string | null;
    createdAt: string;
  }>;
  notes: Array<{
    id: string;
    visibility: 'INTERNAL' | 'CUSTOMER_VISIBLE';
    body: string;
    createdAt: string;
  }>;
  delivery: { id: string; status: string; version: number } | null;
  cashCollections: Array<{
    id: string;
    status: string;
    expectedMillimes: number;
    collectedMillimes: number;
  }>;
}

export interface AdminStockTotals {
  onHandQuantity: number;
  reservedQuantity: number;
  remainingQuantity: number;
}

export interface AdminInventoryItem extends AdminStockTotals {
  id: string;
  productId: string;
  sku: string;
  name: string;
  productName: string;
  variantName: string;
  brand: BrandSummary | null;
  brandName: string | null;
  productType: ProductType;
  flavor: string | null;
  availableQuantity: number;
  lowStockThreshold: number;
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'INVARIANT_BREACH';
  publicationStatus: string;
  productPublicationStatus: string;
  updatedAt: string;
}

export interface AdminInventoryVariantDetail {
  id: string;
  productId: string;
  productNameFr: string;
  productNameAr: string;
  nameFr: string;
  nameAr: string;
  sku: string;
  lowStockThreshold: number;
  version: number;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  committedQuantity: number;
  commitmentPolicy: 'DEDUCT_ON_CONFIRMATION';
  asOf: string;
  items: Array<{
    id: string;
    lotKey: string;
    location: { id: string; code: string; name: string; active: boolean };
    batch: {
      id: string;
      batchNumber: string;
      expiryDate: string | null;
      archivedAt: string | null;
    } | null;
    onHandQuantity: number;
    reservedQuantity: number;
    availableQuantity: number;
    committedQuantity: number;
    version: number;
    updatedAt: string;
  }>;
}

export interface AdminInventoryLocation {
  id: string;
  code: string;
  name: string;
  address: string | null;
  active: boolean;
  fulfillsOrders: boolean;
  updatedAt: string;
}

export interface AdminInventoryPage extends Pagination<AdminInventoryItem> {
  asOf: string;
  availabilityDefinition: string;
  grouping: {
    scope: 'FILTERED_RESULT';
    byBrand: Array<AdminStockTotals & { brandId: string | null; brandName: string | null }>;
    byProductType: Array<AdminStockTotals & { productType: ProductType }>;
    byFlavor: Array<AdminStockTotals & { flavor: string | null }>;
    byBrandAndFlavor: Array<
      AdminStockTotals & {
        brandId: string | null;
        brandName: string | null;
        flavor: string | null;
      }
    >;
  };
}

export type AdminRecord = Record<string, unknown> & { id: string };

export interface AdminSettingRecord {
  id: string;
  sourceId: string;
  scope: 'STORE' | 'COMPLIANCE';
  key: string;
  valueType: 'BOOLEAN' | 'INTEGER' | 'STRING' | 'JSON';
  value: unknown;
  redacted: boolean;
  description: string | null;
  legallyReviewed: boolean | null;
  reviewedAt: string | null;
  version: number;
  updatedAt: string;
}

export interface AdminDeliveryZoneConfig {
  id: string;
  code: string;
  nameFr: string;
  nameAr: string;
  priority: number;
  active: boolean;
  supported: boolean;
  localityCount: number;
  activeRateCount: number;
  updatedAt: string;
}

export interface AdminDeliveryRateConfig {
  id: string;
  type: string;
  name: string;
  feeMillimes: number;
  priority: number;
  active: boolean;
  version: number;
}

export interface AdminPickupConfig {
  id: string;
  code: string;
  nameFr: string;
  nameAr: string;
  address: string;
  active: boolean;
  stateToken: string;
}

export interface AdminCashCollection {
  id: string;
  orderNumber: string;
  courierName: string | null;
  status: string;
  paymentStatus: string;
  expectedMillimes: number;
  collectedMillimes: number;
  collectedAt: string | null;
  createdAt: string;
}

export interface AdminCashCollectionDetail extends AdminCashCollection {
  orderId: string;
  orderStatus: string;
  orderVersion: number;
  deliveryId: string | null;
  delivery: { id?: string; version?: number } | null;
  courierId: string | null;
}

export interface AdminCashRemittance {
  id: string;
  remittanceNumber: string;
  courierName: string;
  status: string;
  declaredMillimes: number;
  verifiedMillimes: number | null;
  differenceMillimes: number | null;
  createdAt: string;
}

export interface AdminCourierOption {
  id: string;
  code: string;
  name: string;
}

export interface AdminDeliveryDetail {
  id: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  expectedCodMillimes: number;
  status: string;
  courier: AdminCourierOption | null;
  trackingNumber: string | null;
  courierFeeMillimes: number | null;
  ageVerificationResult: string;
  ageVerificationRequired: boolean;
  cashCollectedResult: boolean | null;
  version: number;
  attempts: Array<{ id: string; outcome: string; attemptedAt: string }>;
  events: Array<{ id: string; fromStatus: string | null; toStatus: string; occurredAt: string }>;
}

export type ManagedAccountStatus =
  'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED' | 'ANONYMIZED';

export interface AdminAccount {
  id: string;
  email: string | null;
  displayName: string;
  employeeCode: string | null;
  jobTitle: string | null;
  status: ManagedAccountStatus;
  roles: Array<{ key: string; name: string }>;
  twoFactorEnrolled: boolean;
  suspendedAt: string | null;
  suspensionReason: string | null;
  userVersion: number;
  profileVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedCustomerAccount {
  id: string;
  userId: string;
  fullName: string;
  normalizedPhone: string;
  email: string | null;
  status: ManagedAccountStatus;
  suspendedAt: string | null;
  suspensionReason: string | null;
  userVersion: number;
  profileVersion: number;
  createdAt: string;
}

export interface AccountLifecyclePayload {
  expectedUserVersion: number;
  expectedProfileVersion: number;
  reason: string;
  confirmed: true;
}

export interface CreateAdminAccountPayload {
  email: string;
  displayName: string;
  employeeCode?: string;
  jobTitle?: string;
  password: string;
  roleKeys: string[];
  confirmed: true;
}

export type AdminProductType = ProductType;
export type AdminProductPublicationStatus = 'DRAFT' | 'PUBLISHED' | 'SUSPENDED';

export interface AdminProductRead {
  id: string;
  categoryId: string;
  brandId: string | null;
  nameFr: string;
  nameAr: string;
  slug: string;
  sku: string | null;
  barcode: string | null;
  productType: AdminProductType;
  flavor: string | null;
  shortDescriptionFr?: string | null;
  shortDescriptionAr?: string | null;
  descriptionFr?: string | null;
  descriptionAr?: string | null;
  containsNicotine: boolean;
  baseCostMillimes: number | null;
  basePriceMillimes: number | null;
  promotionalPriceMillimes: number | null;
  taxRateBps: number | null;
  warningFr?: string | null;
  warningAr?: string | null;
  minimumAge: number | null;
  publicationStatus: AdminProductPublicationStatus;
  featured: boolean;
  version: number;
}

export interface AdminProductVariantRead {
  id: string;
  productId: string;
  nameFr: string;
  nameAr: string;
  sku: string;
  barcode: string | null;
  color: string | null;
  costMillimes: number;
  priceMillimes: number;
  promotionalPriceMillimes: number | null;
  taxRateBps: number;
  weightGrams: number;
  lowStockThreshold: number;
  publicationStatus: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'ARCHIVED';
  archivedAt: string | null;
  version: number;
}

export interface AdminProductCreatePayload {
  categoryId: string;
  brandId: string | null;
  nameFr: string;
  nameAr: string;
  slug: string;
  productType: AdminProductType;
  flavor: string | null;
  sku: string | null;
  shortDescriptionFr: string | null;
  shortDescriptionAr: string | null;
  containsNicotine: boolean;
  basePriceMillimes: number | null;
  warningFr: string | null;
  warningAr: string | null;
  minimumAge: number | null;
  featured: boolean;
}

export interface AdminProductUpdatePayload extends AdminProductCreatePayload {
  version: number;
  publicationStatus: AdminProductPublicationStatus;
}
