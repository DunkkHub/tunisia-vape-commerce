import { lazy } from 'react';

export const HomePage = lazy(async () => ({
  default: (await import('../pages/store/home-page')).HomePage,
}));
export const CatalogPage = lazy(async () => ({
  default: (await import('../pages/store/catalog-page')).CatalogPage,
}));
export const ProductPage = lazy(async () => ({
  default: (await import('../pages/store/product-page')).ProductPage,
}));
export const CartPage = lazy(async () => ({
  default: (await import('../pages/store/cart-page')).CartPage,
}));
export const CheckoutPage = lazy(async () => ({
  default: (await import('../pages/store/checkout-page')).CheckoutPage,
}));
export const CustomerLoginPage = lazy(async () => ({
  default: (await import('../pages/store/auth-pages')).CustomerLoginPage,
}));
export const RegisterPage = lazy(async () => ({
  default: (await import('../pages/store/auth-pages')).RegisterPage,
}));
export const PasswordResetPage = lazy(async () => ({
  default: (await import('../pages/store/auth-pages')).PasswordResetPage,
}));
export const AccountLayout = lazy(async () => ({
  default: (await import('../pages/store/account-pages')).AccountLayout,
}));
export const ProfilePage = lazy(async () => ({
  default: (await import('../pages/store/account-pages')).ProfilePage,
}));
export const AddressesPage = lazy(async () => ({
  default: (await import('../pages/store/account-pages')).AddressesPage,
}));
export const OrdersPage = lazy(async () => ({
  default: (await import('../pages/store/account-pages')).OrdersPage,
}));
export const OrderTrackingPage = lazy(async () => ({
  default: (await import('../pages/store/account-pages')).OrderTrackingPage,
}));
export const WishlistPage = lazy(async () => ({
  default: (await import('../pages/store/account-pages')).WishlistPage,
}));
export const SecurityPage = lazy(async () => ({
  default: (await import('../pages/store/account-pages')).SecurityPage,
}));
export const InfoPage = lazy(async () => ({
  default: (await import('../pages/store/content-pages')).InfoPage,
}));
export const LegalPage = lazy(async () => ({
  default: (await import('../pages/store/content-pages')).LegalPage,
}));
export const NotFoundPage = lazy(async () => ({
  default: (await import('../pages/store/content-pages')).NotFoundPage,
}));
export const OrderConfirmationPage = lazy(async () => ({
  default: (await import('../pages/store/content-pages')).OrderConfirmationPage,
}));
export const AdminLoginPage = lazy(async () => ({
  default: (await import('../pages/admin/admin-login-page')).AdminLoginPage,
}));
export const AdminDashboardPage = lazy(async () => ({
  default: (await import('../pages/admin/admin-dashboard-page')).AdminDashboardPage,
}));
export const AdminProductEditorPage = lazy(async () => ({
  default: (await import('../pages/admin/admin-product-editor-page')).AdminProductEditorPage,
}));
export const AdminInventoryPage = lazy(async () => ({
  default: (await import('../pages/admin/admin-inventory-page')).AdminInventoryPage,
}));
export const AdminInventoryDetailPage = lazy(async () => ({
  default: (await import('../pages/admin/admin-inventory-detail-page')).AdminInventoryDetailPage,
}));
export const AdminOrderDetailPage = lazy(async () => ({
  default: (await import('../pages/admin/admin-order-detail-page')).AdminOrderDetailPage,
}));
export const AdminSettingsPage = lazy(async () => ({
  default: (await import('../pages/admin/admin-settings-page')).AdminSettingsPage,
}));
export const AdminDeliveryPage = lazy(async () => ({
  default: (await import('../pages/admin/admin-delivery-page')).AdminDeliveryPage,
}));
export const AdminCashPage = lazy(async () => ({
  default: (await import('../pages/admin/admin-cash-page')).AdminCashPage,
}));
export const AdminAdministratorsPage = lazy(async () => ({
  default: (await import('../pages/admin/admin-access-pages')).AdminAdministratorsPage,
}));
export const AdminCustomersPage = lazy(async () => ({
  default: (await import('../pages/admin/admin-access-pages')).AdminCustomersPage,
}));
export const AdminResourcePage = lazy(async () => ({
  default: (await import('../pages/admin/admin-resource-page')).AdminResourcePage,
}));
export const AdminCatalogImportsPage = lazy(async () => ({
  default: (await import('../pages/admin/admin-catalog-imports-page')).AdminCatalogImportsPage,
}));
