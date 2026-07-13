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
  grandTotalMillimes: number;
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
  fullName: string;
  phone: string;
  email?: string | undefined;
  governorateId: string;
  delegationId: string;
  localityId: string;
  postalCode: string;
  street: string;
  building?: string | undefined;
  floor?: string | undefined;
  apartment?: string | undefined;
  landmark?: string | undefined;
  deliveryInstructions?: string | undefined;
  deliveryMethod: 'DELIVERY' | 'PICKUP';
  preferredDeliveryDate?: string | undefined;
  preferredDeliveryTimeWindowId?: string | undefined;
  adultConfirmation: true;
  termsAccepted: true;
  privacyAccepted: true;
}

export interface CheckoutResult {
  orderId: string;
  orderNumber: string;
  status: string;
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

export interface AdminMetricSet {
  ordersCreated: number;
  ordersDelivered: number;
  codExpectedMillimes: number;
  codRemittedMillimes: number;
  lowStockCount: number;
  deliveryFailureCount: number;
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
