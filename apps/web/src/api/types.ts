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

export interface CustomerSessionSummary {
  id: string;
  createdAt: string;
  authenticatedAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  twoFactorVerified: boolean;
  current: boolean;
}

export interface CustomerSessionListResponse {
  data: CustomerSessionSummary[];
}

export interface AdminSessionResponse {
  user: AdminUser;
  expiresAt?: string;
}

export type AdminChallengeResponse =
  | { state: 'TOTP_REQUIRED'; challengeId: string }
  | {
      state: 'ENROLLMENT_REQUIRED';
      challengeId: string;
      enrollmentUri: string;
      manualEntryKey: string;
    };

export interface StorefrontStatus {
  storeName: string;
  maintenanceMode: boolean;
  prelaunchMode: boolean;
  checkoutEnabled: boolean;
  googleLoginEnabled: boolean;
  minimumAge: number;
  ageGateEnabled: boolean;
  checkoutAgeConfirmationRequired: boolean;
  termsAcceptanceRequired: boolean;
  privacyAcceptanceRequired: boolean;
  consentRecordingEnabled: boolean;
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
  | 'DEVICE'
  | 'E_LIQUID'
  | 'POD'
  | 'PREFILLED_POD_KIT'
  | 'PREFILLED_REPLACEMENT_POD'
  | 'COIL'
  | 'DISPOSABLE'
  | 'ACCESSORY'
  | 'OTHER';

export interface FlavorSummary {
  id: string;
  slug: string;
  name: string;
}

export interface CatalogFacets {
  brands: BrandSummary[];
  productTypes: ProductType[];
  flavors: Array<{
    value: string;
    nameFr: string;
    nameAr: string;
    productCount: number;
  }>;
  puffCounts: Array<{ value: number; productCount: number }>;
  nicotineStrengthsMg: Array<{ value: number; productCount: number }>;
  priceRange: {
    minimumMillimes: number | null;
    maximumMillimes: number | null;
  };
  truncated: {
    brands: boolean;
    flavors: boolean;
    puffCounts: boolean;
    nicotineStrengths: boolean;
  };
}

export interface ProductImage {
  id: string;
  url: string;
  renditions?: ProductImageRenditions;
  altText: string | null;
  width?: number;
  height?: number;
}

export interface ProductImageRenditions {
  thumbnail: string;
  card: string;
  detail: string;
  highResolution: string;
}

export interface ProductVariant {
  id: string;
  name: string;
  sku: string;
  priceMillimes: number;
  promotionalPriceMillimes: number | null;
  availableQuantity: number;
  nicotineStrengthMg?: number | null;
  flavor?: FlavorSummary | null;
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
  puffCount?: number | null;
  nicotineStrengthMg?: number | null;
  nicotineStrengthsMg?: number[];
  selectableFlavorCount?: number;
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

export interface CustomerOrderItem {
  id: string;
  productName: string;
  variantName: string;
  sku: string;
  warningFr: string | null;
  warningAr: string | null;
  unitPriceMillimes: number;
  unitDiscountMillimes: number;
  unitTaxMillimes: number;
  quantity: number;
  lineSubtotalMillimes: number;
  lineDiscountMillimes: number;
  lineTaxMillimes: number;
  lineTotalMillimes: number;
}

export interface CustomerOrderAddress {
  id: string;
  type: string;
  fullName: string;
  phone: string;
  governorate: string;
  delegation: string;
  locality: string | null;
  postalCode: string | null;
  street: string;
  building: string | null;
  floor: string | null;
  apartment: string | null;
  landmark: string | null;
  instructions: string | null;
}

export interface CustomerOrderDelivery {
  id: string;
  status: string;
  trackingNumber: string | null;
  courierName: string | null;
  ageVerificationResult: string;
  customerVisibleNotes: string | null;
  assignedAt: string | null;
  handedToCourierAt: string | null;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
  attempts: Array<{
    id: string;
    attemptNumber: number;
    outcome: string;
    ageVerificationResult: string;
    attemptedAt: string;
    nextAttemptAt: string | null;
  }>;
  events: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    occurredAt: string;
  }>;
}

export interface CustomerOrderDetail extends OrderSummary {
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  deliveryMethodType: 'COURIER' | 'STORE_PICKUP';
  deliveryMethod: string;
  subtotalMillimes: number;
  discountTotalMillimes: number;
  deliveryTotalMillimes: number;
  taxTotalMillimes: number;
  expectedCodMillimes: number;
  items: CustomerOrderItem[];
  addresses: CustomerOrderAddress[];
  history: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    occurredAt: string;
  }>;
  customerVisibleNotes: Array<{ id: string; body: string; createdAt: string }>;
  delivery: CustomerOrderDelivery | null;
  consents: Array<{
    type: string;
    granted: boolean;
    documentTitle: string | null;
    documentVersion: number | null;
    contentHash: string | null;
    consentedAt: string;
  }>;
  discounts: Array<{
    id: string;
    name: string;
    code: string | null;
    amountMillimes: number;
  }>;
  codCollections: Array<{
    id: string;
    status: string;
    expectedMillimes: number;
    collectedMillimes: number;
    collectedAt: string | null;
  }>;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  updatedAt: string;
}

export type CustomerAddressType = 'HOME' | 'WORK' | 'OTHER';

export interface AddressSummary {
  id: string;
  type: CustomerAddressType;
  label: string;
  fullName: string;
  phone: string;
  governorateId: string;
  governorate: string;
  delegationId: string;
  delegation: string;
  localityId: string | null;
  locality: string;
  postalCode: string;
  street: string;
  building: string | null;
  floor: string | null;
  apartment: string | null;
  landmark: string | null;
  deliveryInstructions: string | null;
  isDefault: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerAddressPayload {
  type: CustomerAddressType;
  label?: string | null;
  fullName: string;
  phone: string;
  governorateId: string;
  delegationId: string;
  localityId?: string | null;
  postalCode?: string | null;
  street: string;
  building?: string | null;
  floor?: string | null;
  apartment?: string | null;
  landmark?: string | null;
  deliveryInstructions?: string | null;
  isDefault: boolean;
}

export interface UpdateCustomerAddressPayload extends CreateCustomerAddressPayload {
  expectedVersion: number;
}

export interface WishlistMutationResult {
  variantId: string;
  productId: string;
  saved: boolean;
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
    ageConfirmed: boolean;
    termsAccepted: boolean;
    privacyAccepted: boolean;
  };
}

export type StorefrontDeliveryPaymentMethod = 'CASH_ON_DELIVERY';

export interface StorefrontDeliveryMetadata {
  estimatedMinDays: number | null;
  estimatedMaxDays: number | null;
  estimatedMinMinutes: number | null;
  estimatedMaxMinutes: number | null;
  paymentMethod: StorefrontDeliveryPaymentMethod | null;
  phoneConfirmationRequired: boolean;
}

export interface CheckoutOrderFulfillment extends StorefrontDeliveryMetadata {
  type: 'COURIER' | 'STORE_PICKUP';
}

export type CheckoutQuoteFulfillment =
  | ({
      type: 'COURIER';
      express: boolean;
      deliveryZone: { id: string; code: string; nameFr: string; nameAr: string };
      selectedRateIds: string[];
      freeDeliveryApplied: boolean;
    } & StorefrontDeliveryMetadata)
  | {
      type: 'STORE_PICKUP';
      pickupLocation: {
        id: string;
        code: string;
        nameFr: string;
        nameAr: string;
        address: string;
      };
      selectedRateIds: string[];
    };

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
  fulfillment: CheckoutOrderFulfillment;
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
  fulfillment: CheckoutQuoteFulfillment;
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

export interface DeliveryMethodOption extends StorefrontDeliveryMetadata {
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

export interface AdminBatchReceiptResult {
  batch: {
    id: string;
    variantId: string;
    supplierId: string | null;
    batchNumber: string;
    supplierReference: string | null;
    manufacturedAt: string | null;
    expiryDate: string;
    receivedAt: string | null;
  };
  inventoryItemId: string;
  locationId: string;
  quantityReceived: number;
  onHandQuantity: number;
  version: number;
  movementId: string;
  replayed: boolean;
}

export interface AdminInventoryAdjustment {
  id: string;
  quantityDelta: number;
  reasonCode: string;
  note: string | null;
  status: 'PENDING_APPROVAL' | 'REJECTED' | 'APPLIED' | 'EXPIRED';
  requestedBy: string;
  approvedBy: string | null;
  decisionReason: string | null;
  expectedVersion: number;
  onHandBefore: number;
  proposedOnHandQuantity: number;
  requestedAt: string;
  expiresAt: string | null;
  decidedAt: string | null;
  appliedAt: string | null;
  stockMovementId: string | null;
  inventoryItem: {
    id: string;
    version: number;
    onHandQuantity: number;
    location: { id: string; code: string; name: string };
    batch: { id: string; batchNumber: string; expiryDate: string | null } | null;
    variant: { id: string; sku: string; nameFr: string; nameAr: string };
  };
}

export interface AdminInventoryMovement {
  id: string;
  type: string;
  quantityDelta: number;
  onHandAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  reasonCode: string | null;
  note: string | null;
  requestId: string | null;
  occurredAt: string;
}

export interface AdminInventoryTransferResult {
  transferId: string;
  sourceInventoryItemId: string;
  destinationInventoryItemId: string;
  quantity: number;
  sourceMovementId: string;
  destinationMovementId: string;
  sourceOnHandQuantity: number;
  destinationOnHandQuantity: number;
  occurredAt: string;
  replayed: boolean;
}

export interface AdminInventoryTransferRecord {
  id: string;
  quantity: number;
  requestedBy: string;
  note: string | null;
  occurredAt: string;
  sourceMovement: { id: string; quantityDelta: number; onHandAfter: number };
  destinationMovement: { id: string; quantityDelta: number; onHandAfter: number };
  sourceInventoryItem: {
    id: string;
    location: { id: string; code: string; name: string };
    variant: { id: string; sku: string; nameFr: string; nameAr: string };
    batch: { id: string; batchNumber: string; expiryDate: string | null } | null;
  };
  destinationInventoryItem: {
    id: string;
    location: { id: string; code: string; name: string };
  };
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

export type AdminTaxonomyStatus = 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'ARCHIVED';

export interface AdminBrandTaxonomy {
  id: string;
  name: string;
  slug: string;
  descriptionFr: string | null;
  descriptionAr: string | null;
  publicationStatus: AdminTaxonomyStatus;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCategoryTaxonomy {
  id: string;
  parentId: string | null;
  nameFr: string;
  nameAr: string;
  slug: string;
  descriptionFr: string | null;
  descriptionAr: string | null;
  sortOrder: number;
  publicationStatus: AdminTaxonomyStatus;
  productCount: number;
  childCount: number;
  createdAt: string;
  updatedAt: string;
}

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

export interface StoreConfigurationExport {
  format: 'tunisia-vape-store-configuration';
  schemaVersion: 1;
  store: Array<Pick<AdminSettingRecord, 'key' | 'valueType' | 'value'>>;
  compliance: Array<Pick<AdminSettingRecord, 'key' | 'valueType' | 'value'>>;
  excludedSecretCount: number;
  checksumSha256: string;
}

export type AdminDeliveryPaymentMethod = 'CASH_ON_DELIVERY';
export type AdminDeliveryAssignmentMode = 'MANUAL';
export type AdminDeliveryCommunicationChannel = 'WHATSAPP' | 'PHONE';

export interface AdminDeliveryZoneInput {
  code: string;
  nameFr: string;
  nameAr: string;
  priority?: number;
  estimatedMinDays?: number | null;
  estimatedMaxDays?: number | null;
  estimatedMinMinutes?: number | null;
  estimatedMaxMinutes?: number | null;
  paymentMethod?: AdminDeliveryPaymentMethod | null;
  assignmentMode?: AdminDeliveryAssignmentMode | null;
  driverCommunication?: AdminDeliveryCommunicationChannel | null;
  phoneConfirmationRequired?: boolean;
  manualReviewRequired?: boolean;
}

export interface AdminDeliveryZoneConfig {
  id: string;
  code: string;
  nameFr: string;
  nameAr: string;
  priority: number;
  active: boolean;
  supported: boolean;
  temporarilySuspended: boolean;
  phoneConfirmationRequired: boolean;
  manualReviewRequired: boolean;
  minOrderMillimes: number | null;
  maxCodMillimes: number | null;
  freeDeliveryThresholdMillimes: number | null;
  estimatedMinDays: number | null;
  estimatedMaxDays: number | null;
  estimatedMinMinutes: number | null;
  estimatedMaxMinutes: number | null;
  paymentMethod: AdminDeliveryPaymentMethod | null;
  assignmentMode: AdminDeliveryAssignmentMode | null;
  driverCommunication: AdminDeliveryCommunicationChannel | null;
  localityCount: number;
  activeRateCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminDeliveryRateConfig {
  id: string;
  type: string;
  name: string;
  feeMillimes: number;
  priority: number;
  deliveryZoneId: string | null;
  express: boolean;
  active: boolean;
  version: number;
  validFrom: string | null;
  validUntil: string | null;
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
  accountableMillimes: number | null;
  adjustmentMillimes: number | null;
  discrepancyStatus: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'WRITTEN_OFF' | null;
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
  collectedByUserId: string | null;
  method: string;
  note: string | null;
  allocations: Array<Record<string, unknown>>;
  discrepancies: AdminCashDiscrepancy[];
  historyTruncated: boolean;
  updatedAt: string;
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

export interface AdminCashDiscrepancy {
  id: string;
  cashCollectionId?: string | null;
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'WRITTEN_OFF';
  expectedMillimes: number;
  actualMillimes: number;
  differenceMillimes: number;
  reasonCode: string | null;
  reasonDetail: string | null;
  openedByUserId: string;
  resolvedByUserId: string | null;
  openedAt: string;
  resolvedAt: string | null;
}

export interface AdminCashRemittanceDetail extends Omit<AdminCashRemittance, 'courierName'> {
  courier: AdminCourierOption;
  submittedAt: string | null;
  remittedAt: string | null;
  receivedByUserId: string | null;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  note: string | null;
  discrepancies: AdminCashDiscrepancy[];
  historyTruncated: boolean;
  updatedAt: string;
}

export interface AdminCourierOption {
  id: string;
  code: string;
  name: string;
}

export type AdminCourierStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export type AdminCourierAvailabilityStatus = 'AVAILABLE' | 'OFF_DUTY';

export type AdminCourierAssignmentWarning =
  'COURIER_OUTSIDE_DELIVERY_ZONE' | 'COURIER_CAPACITY_EXCEEDED';

export interface AdminCourierAssignmentOption extends AdminCourierOption {
  availabilityStatus: AdminCourierAvailabilityStatus;
  activeDeliveryCount: number;
  maximumActiveDeliveries: number | null;
  assignable: boolean;
  requiresWarningAcknowledgement: boolean;
  unavailableReason: 'COURIER_OFF_DUTY' | null;
  warnings: AdminCourierAssignmentWarning[];
}

export interface AdminCourierCoverageZone {
  deliveryZoneId: string;
  code: string;
  nameFr: string;
  nameAr: string;
  active: boolean;
  zoneActive: boolean;
  zoneSupported: boolean;
  zoneTemporarilySuspended: boolean;
  feeMillimes: number | null;
  localityCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCourierRecord extends AdminCourierOption {
  companyName: string | null;
  status: AdminCourierStatus;
  availabilityStatus: AdminCourierAvailabilityStatus;
  contactName: string | null;
  phoneE164: string | null;
  whatsappPhoneE164: string | null;
  email: string | null;
  defaultFeeMillimes: number | null;
  maximumActiveDeliveries: number | null;
  whatsappTemplate: string;
  notes: string | null;
  integrations: Array<{ type: string; name: string; active: boolean }>;
  coverageMode: 'ZONES' | 'UNRESTRICTED';
  coverageZones: AdminCourierCoverageZone[];
  activeDeliveryCount: number;
  deliveryCount: number;
  manifestCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCourierWhatsAppPreview {
  courierId: string;
  courierName: string;
  phoneE164: string;
  renderedMessage: string;
  url: string;
  manualOnly: true;
}

export type AdminDeliveryManifestStatus =
  'DRAFT' | 'SEALED' | 'HANDED_OVER' | 'CLOSED' | 'CANCELLED';

export interface AdminDeliveryManifestSummary {
  id: string;
  manifestNumber: string;
  status: AdminDeliveryManifestStatus;
  manifestDate: string;
  courier: AdminCourierOption;
  itemCount: number;
  createdAt: string;
}

export interface AdminDeliveryManifestItem {
  sequence: number;
  addedAt: string;
  deliveryId: string;
  status: string;
  version: number;
  trackingNumber: string | null;
  ageVerificationRequired: boolean;
  orderNumber: string;
  recipientName: string;
  recipientPhone: string;
  expectedCodMillimes: number;
  address: {
    governorateName: string;
    delegationName: string;
    localityName: string | null;
    postalCode: string | null;
    street: string;
    building: string | null;
    landmark: string | null;
  } | null;
}

export interface AdminDeliveryManifest extends AdminDeliveryManifestSummary {
  items: AdminDeliveryManifestItem[];
  createdBy: string;
  sealedAt: string | null;
  handedOverAt: string | null;
  closedAt: string | null;
}

export interface AdminDeliveryStatusImportRow {
  row: number;
  deliveryId: string;
  currentStatus: string | null;
  targetStatus: string;
  valid: boolean;
  code: string | null;
  message: string | null;
}

export interface AdminDeliveryStatusImportResult {
  schemaVersion: 'DELIVERY_STATUS_V1';
  importKey: string;
  dryRun: boolean;
  valid: boolean;
  applied: boolean;
  rowCount: number;
  appliedCount: number;
  rows: AdminDeliveryStatusImportRow[];
  replayed: boolean;
}

export interface AdminCsvDownload {
  content: string;
  filename: string;
  rowCount: number | null;
}

export type AdminCatalogImportFormat = 'CSV' | 'JSON' | 'WOTOFO';
export type AdminCatalogImportSource = 'ADMIN_UPLOAD' | 'WOTOFO_OFFICIAL';
export type AdminCatalogImportStatus =
  | 'PREVIEW_VALID'
  | 'PREVIEW_INVALID'
  | 'APPLYING'
  | 'APPLIED'
  | 'APPLIED_WITH_WARNINGS'
  | 'FAILED'
  | 'ROLLED_BACK';
export type AdminCatalogImportRowStatus =
  'VALID' | 'INVALID' | 'CREATED' | 'UPDATED' | 'SKIPPED' | 'FAILED' | 'ROLLED_BACK';

export interface AdminCatalogImportIssue {
  code: string;
  message: string;
  field?: string;
}

export interface AdminCatalogImportRow {
  id: string;
  rowNumber: number;
  stableIdentity: string;
  payloadHash: string;
  status: AdminCatalogImportRowStatus;
  action: string;
  issues: AdminCatalogImportIssue[];
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  productId: string | null;
  variantId: string | null;
  productPostVersion: number | null;
  postVersion: number | null;
  createdAt: string;
}

export interface AdminCatalogImportBatch {
  id: string;
  importKey: string;
  dryRun: boolean;
  payloadHash: string;
  format: AdminCatalogImportFormat;
  source: AdminCatalogImportSource;
  schemaVersion: string;
  status: AdminCatalogImportStatus;
  partialMode: boolean;
  overridePrice: boolean;
  overrideStatus: boolean;
  overrideImages: boolean;
  rowCount: number;
  appliedCount: number;
  result: Record<string, unknown>;
  previewBatchId: string | null;
  createdByUserId: string;
  createdAt: string;
  completedAt: string | null;
  rolledBackAt: string | null;
  rows?: AdminCatalogImportRow[];
}

export interface AdminCatalogImportPreviewPayload {
  file: File;
  importKey: string;
  format: Exclude<AdminCatalogImportFormat, 'WOTOFO'>;
  partialMode: boolean;
  overridePrice: boolean;
  overrideStatus: boolean;
  overrideImages: boolean;
}

export interface AdminCatalogMediaImportReport {
  successful: Array<Record<string, unknown>>;
  missing: Array<Record<string, unknown>>;
  rejected: Array<Record<string, unknown>>;
  duplicates: Array<Record<string, unknown>>;
  productsRequiringManualReview: string[];
}

export interface AdminCatalogMediaImportResult {
  batch: AdminCatalogImportBatch;
  report: AdminCatalogMediaImportReport;
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
  assignedAt: string | null;
  handedToCourierAt: string | null;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
  internalNotes: string | null;
  customerVisibleNotes: string | null;
  ageVerificationResult: string;
  ageVerificationRequired: boolean;
  cashCollectedResult: boolean | null;
  version: number;
  attempts: Array<{
    id: string;
    outcome: string;
    attemptedAt: string;
    nextAttemptAt?: string | null;
    notes?: string | null;
  }>;
  events: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    occurredAt: string;
    source?: string;
    reasonCode?: string | null;
    note?: string | null;
  }>;
  historyTruncated?: boolean;
  createdAt?: string;
  updatedAt?: string;
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

export interface AdminCustomerDetail extends ManagedCustomerAccount {
  firstName: string;
  lastName: string;
  locale: string;
  marketingConsent: boolean;
  anonymizedAt: string | null;
  lastLoginAt: string | null;
  updatedAt: string;
  orderCount: number;
  addresses: Array<{
    id: string;
    label: string | null;
    fullName: string;
    phone: string;
    street: string;
    governorate: string;
    delegation: string;
    locality: string | null;
    postalCode: string | null;
    isDefault: boolean;
  }>;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    grandTotalMillimes: number;
    createdAt: string;
  }>;
  activeSessions: Array<{
    id: string;
    lastSeenAt: string;
    absoluteExpiresAt: string;
    ipAddress: string | null;
    userAgent: string | null;
  }>;
  notes: Array<{ id: string; body: string; authorId: string; createdAt: string }>;
  audit: Array<{
    id: string;
    action: string;
    outcome: string;
    actorUserId: string | null;
    occurredAt: string;
  }>;
}

export interface AdminCustomerExport {
  generatedAt: string;
  customer: Record<string, unknown>;
  addresses: unknown[];
  orders: unknown[];
  consents: unknown[];
  pagination: { ordersIncluded: number; totalOrders: number; truncated: boolean };
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
export type AdminProductPublicationStatus = 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'ARCHIVED';
export type AdminProductMutablePublicationStatus = Exclude<
  AdminProductPublicationStatus,
  'ARCHIVED'
>;

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
  requiresPricing: boolean;
  requiresStock: boolean;
  needsMediaReview: boolean;
  version: number;
}

export interface AdminProductImage {
  id: string;
  productId: string | null;
  variantId: string | null;
  url: string;
  renditions?: ProductImageRenditions;
  contentType: string;
  originalFilename: string | null;
  byteSize: number;
  checksumSha256: string;
  width: number | null;
  height: number | null;
  altTextFr: string;
  altTextAr: string;
  sortOrder: number;
  isPrimary: boolean;
  moderationStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'QUARANTINED';
  ownerVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductVariantRead {
  id: string;
  productId: string;
  nameFr: string;
  nameAr: string;
  sku: string;
  barcode: string | null;
  color: string | null;
  costMillimes: number | null;
  priceMillimes: number;
  promotionalPriceMillimes: number | null;
  taxRateBps: number;
  weightGrams: number;
  lowStockThreshold: number;
  publicationStatus: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'ARCHIVED';
  archivedAt: string | null;
  version: number;
}

export interface AdminProductVariantCreatePayload {
  nameFr: string;
  nameAr: string;
  sku: string;
  color?: string | null;
  costMillimes: number;
  priceMillimes: number;
  promotionalPriceMillimes?: number | null;
  lowStockThreshold?: number;
}

export interface AdminProductVariantUpdatePayload {
  version: number;
  nameFr?: string;
  nameAr?: string;
  sku?: string;
  color?: string | null;
  costMillimes?: number;
  priceMillimes?: number;
  promotionalPriceMillimes?: number | null;
  publicationStatus?: AdminProductMutablePublicationStatus;
  lowStockThreshold?: number;
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
  descriptionFr: string | null;
  descriptionAr: string | null;
  containsNicotine: boolean;
  basePriceMillimes: number | null;
  promotionalPriceMillimes: number | null;
  warningFr: string | null;
  warningAr: string | null;
  minimumAge: number | null;
  featured: boolean;
}

export interface AdminProductUpdatePayload extends AdminProductCreatePayload {
  version: number;
  publicationStatus: AdminProductMutablePublicationStatus;
  mediaReviewConfirmed?: boolean;
}
