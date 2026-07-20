import { httpRequest, jsonBody } from './http';
import type {
  AddressSummary,
  Cart,
  CatalogFacets,
  CategorySummary,
  CheckoutPayload,
  CheckoutQuote,
  CheckoutQuoteRequest,
  CheckoutResult,
  DeliveryMethodOption,
  DeliveryWindowOption,
  GeographyOption,
  LegalDocument,
  CreateCustomerAddressPayload,
  CustomerOrderDetail,
  OrderSummary,
  Pagination,
  ProductDetail,
  ProductSummary,
  StoreContent,
  StorefrontStatus,
  UpdateCustomerAddressPayload,
  WishlistMutationResult,
} from './types';

function storeRequest<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('X-Client-Context', 'storefront');
  return httpRequest<T>(`/api/v1${path}`, { ...init, headers });
}

export const storefrontClient = {
  status: () => storeRequest<StorefrontStatus>('/storefront/status'),
  confirmAge: (minimumAge: number) =>
    storeRequest<void>('/compliance/age-gate', {
      method: 'POST',
      body: jsonBody({ confirmed: true, minimumAge }),
    }),
  home: () =>
    storeRequest<{ featured: ProductSummary[]; categories: CategorySummary[] }>('/storefront/home'),
  products: (query: string) => storeRequest<Pagination<ProductSummary>>(`/products?${query}`),
  catalogFacets: () => storeRequest<CatalogFacets>('/catalog/facets'),
  product: (slug: string) => storeRequest<ProductDetail>(`/products/${encodeURIComponent(slug)}`),
  cart: () => storeRequest<Cart>('/cart'),
  cartSummary: () => storeRequest<{ itemCount: number }>('/cart/summary'),
  addToCart: (variantId: string, quantity: number) =>
    storeRequest<Cart>('/cart/items', {
      method: 'POST',
      body: jsonBody({ variantId, quantity }),
    }),
  updateCartItem: (itemId: string, quantity: number) =>
    storeRequest<Cart>(`/cart/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: jsonBody({ quantity }),
    }),
  removeCartItem: (itemId: string) =>
    storeRequest<Cart>(`/cart/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),
  checkout: (payload: CheckoutPayload, idempotencyKey: string) =>
    storeRequest<CheckoutResult>('/checkout/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: jsonBody(payload),
    }),
  checkoutQuote: (payload: CheckoutQuoteRequest) =>
    storeRequest<CheckoutQuote>('/checkout/quote', {
      method: 'POST',
      body: jsonBody(payload),
    }),
  governorates: () => storeRequest<GeographyOption[]>('/geography/governorates'),
  delegations: (governorateId: string) =>
    storeRequest<GeographyOption[]>(
      `/geography/governorates/${encodeURIComponent(governorateId)}/delegations`,
    ),
  localities: (delegationId: string) =>
    storeRequest<GeographyOption[]>(
      `/geography/delegations/${encodeURIComponent(delegationId)}/localities`,
    ),
  deliveryWindows: (localityId: string) =>
    storeRequest<DeliveryWindowOption[]>(
      `/delivery/windows?localityId=${encodeURIComponent(localityId)}`,
    ),
  deliveryMethods: (localityId?: string) =>
    storeRequest<DeliveryMethodOption[]>(
      `/delivery/methods${localityId ? `?localityId=${encodeURIComponent(localityId)}` : ''}`,
    ),
  orders: () => storeRequest<Pagination<OrderSummary>>('/orders'),
  order: (orderNumber: string) =>
    storeRequest<CustomerOrderDetail>(`/orders/${encodeURIComponent(orderNumber)}`),
  cancelOrder: (orderNumber: string, expectedVersion: number, reason: string) =>
    storeRequest<CustomerOrderDetail>(`/orders/${encodeURIComponent(orderNumber)}/cancel`, {
      method: 'POST',
      body: jsonBody({
        expectedVersion,
        confirmed: true,
        confirmation: 'CANCEL_ORDER',
        reason,
      }),
    }),
  addresses: () => storeRequest<AddressSummary[]>('/customers/me/addresses'),
  createAddress: (payload: CreateCustomerAddressPayload) =>
    storeRequest<AddressSummary>('/customers/me/addresses', {
      method: 'POST',
      body: jsonBody(payload),
    }),
  updateAddress: (addressId: string, payload: UpdateCustomerAddressPayload) =>
    storeRequest<AddressSummary>(`/customers/me/addresses/${encodeURIComponent(addressId)}`, {
      method: 'PATCH',
      body: jsonBody(payload),
    }),
  deleteAddress: (addressId: string, expectedVersion: number) =>
    storeRequest<{ id: string; deleted: true }>(
      `/customers/me/addresses/${encodeURIComponent(addressId)}?expectedVersion=${expectedVersion}`,
      { method: 'DELETE' },
    ),
  wishlist: () => storeRequest<Pagination<ProductSummary>>('/wishlist'),
  addWishlistItem: (variantId: string) =>
    storeRequest<WishlistMutationResult>('/wishlist/items', {
      method: 'POST',
      body: jsonBody({ variantId }),
    }),
  removeWishlistItem: (variantId: string) =>
    storeRequest<WishlistMutationResult>(`/wishlist/items/${encodeURIComponent(variantId)}`, {
      method: 'DELETE',
    }),
  legal: (slug: string) =>
    storeRequest<LegalDocument>(`/legal/documents/${encodeURIComponent(slug)}`),
  content: (slug: string) =>
    storeRequest<StoreContent>(`/storefront/content/${encodeURIComponent(slug)}`),
};
