import { httpRequest, jsonBody } from './http';
import type {
  AddressSummary,
  Cart,
  CatalogFacets,
  CategorySummary,
  CheckoutPayload,
  CheckoutResult,
  DeliveryWindowOption,
  GeographyOption,
  LegalDocument,
  OrderSummary,
  Pagination,
  ProductDetail,
  ProductSummary,
  StoreContent,
  StorefrontStatus,
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
  orders: () => storeRequest<Pagination<OrderSummary>>('/customers/me/orders'),
  order: (orderNumber: string) =>
    storeRequest<OrderSummary>(`/customers/me/orders/${encodeURIComponent(orderNumber)}`),
  addresses: () => storeRequest<AddressSummary[]>('/customers/me/addresses'),
  wishlist: () => storeRequest<Pagination<ProductSummary>>('/wishlist'),
  legal: (slug: string) =>
    storeRequest<LegalDocument>(`/legal/documents/${encodeURIComponent(slug)}`),
  content: (slug: string) =>
    storeRequest<StoreContent>(`/storefront/content/${encodeURIComponent(slug)}`),
};
