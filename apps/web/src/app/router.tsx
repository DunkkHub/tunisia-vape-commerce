import {
  createBrowserRouter,
  createMemoryRouter,
  Navigate,
  type RouteObject,
} from 'react-router-dom';
import type { ReactNode } from 'react';

import { AdminGuard, CustomerGuard } from '../auth/guards';
import { ServiceModePage } from '../components/compliance/compliance-boundary';
import { AdminShell } from '../components/layout/admin-shell';
import { AdminBoundary, StorefrontBoundary } from './route-boundaries';
import { RouteSuspense } from './route-suspense';
import {
  AccountLayout,
  AddressesPage,
  AdminDashboardPage,
  AdminDeliveryPage,
  AdminCashPage,
  AdminAdministratorsPage,
  AdminCustomersPage,
  AdminCatalogImportsPage,
  AdminInventoryPage,
  AdminInventoryDetailPage,
  AdminLoginPage,
  AdminOrderDetailPage,
  AdminSettingsPage,
  AdminProductEditorPage,
  AdminResourcePage,
  CartPage,
  CatalogPage,
  CheckoutPage,
  CustomerLoginPage,
  HomePage,
  InfoPage,
  LegalPage,
  NotFoundPage,
  OrderConfirmationPage,
  OrdersPage,
  OrderTrackingPage,
  PasswordResetPage,
  ProductPage,
  ProfilePage,
  RegisterPage,
  SecurityPage,
  WishlistPage,
} from './lazy-pages';

const routeElement = (element: ReactNode) => <RouteSuspense>{element}</RouteSuspense>;

export const appRoutes: RouteObject[] = [
  { path: '/maintenance', element: <ServiceModePage mode="maintenance" /> },
  { path: '/prelaunch', element: <ServiceModePage mode="prelaunch" /> },
  {
    path: '/admin',
    element: <AdminBoundary />,
    children: [
      { path: 'login', element: routeElement(<AdminLoginPage />) },
      {
        element: <AdminGuard />,
        children: [
          {
            element: <AdminShell />,
            children: [
              { index: true, element: routeElement(<AdminDashboardPage />) },
              { path: 'dashboard', element: <Navigate to="/admin" replace /> },
              { path: 'catalog', element: routeElement(<AdminResourcePage resource="catalog" />) },
              {
                path: 'catalog/imports',
                element: routeElement(<AdminCatalogImportsPage />),
              },
              { path: 'catalog/new', element: routeElement(<AdminProductEditorPage />) },
              { path: 'catalog/:id/edit', element: routeElement(<AdminProductEditorPage />) },
              { path: 'orders', element: routeElement(<AdminResourcePage resource="orders" />) },
              { path: 'orders/:id', element: routeElement(<AdminOrderDetailPage />) },
              {
                path: 'inventory',
                element: routeElement(<AdminInventoryPage />),
              },
              {
                path: 'inventory/:variantId',
                element: routeElement(<AdminInventoryDetailPage />),
              },
              {
                path: 'customers',
                element: routeElement(<AdminCustomersPage />),
              },
              { path: 'admins', element: routeElement(<AdminAdministratorsPage />) },
              {
                path: 'delivery',
                element: routeElement(<AdminDeliveryPage />),
              },
              { path: 'cash', element: routeElement(<AdminCashPage />) },
              {
                path: 'settings',
                element: routeElement(<AdminSettingsPage />),
              },
              { path: 'audit', element: routeElement(<AdminResourcePage resource="audit" />) },
            ],
          },
        ],
      },
    ],
  },
  {
    path: '/',
    element: <StorefrontBoundary />,
    children: [
      { index: true, element: routeElement(<HomePage />) },
      { path: 'catalog', element: routeElement(<CatalogPage />) },
      { path: 'catalog/category/:slug', element: routeElement(<CatalogPage mode="category" />) },
      { path: 'brands/:slug', element: routeElement(<CatalogPage mode="brand" />) },
      { path: 'search', element: routeElement(<CatalogPage mode="search" />) },
      { path: 'products/:slug', element: routeElement(<ProductPage />) },
      { path: 'login', element: routeElement(<CustomerLoginPage />) },
      { path: 'register', element: routeElement(<RegisterPage />) },
      { path: 'password-reset', element: routeElement(<PasswordResetPage />) },
      { path: 'password-reset/confirm', element: routeElement(<PasswordResetPage />) },
      {
        element: <CustomerGuard />,
        children: [
          { path: 'cart', element: routeElement(<CartPage />) },
          { path: 'checkout', element: routeElement(<CheckoutPage />) },
          {
            path: 'order-confirmation/:orderNumber',
            element: routeElement(<OrderConfirmationPage />),
          },
          {
            path: 'account',
            element: routeElement(<AccountLayout />),
            children: [
              { index: true, element: routeElement(<ProfilePage />) },
              { path: 'addresses', element: routeElement(<AddressesPage />) },
              { path: 'orders', element: routeElement(<OrdersPage />) },
              { path: 'orders/:orderNumber', element: routeElement(<OrderTrackingPage />) },
              { path: 'wishlist', element: routeElement(<WishlistPage />) },
              { path: 'security', element: routeElement(<SecurityPage />) },
            ],
          },
        ],
      },
      { path: 'faq', element: routeElement(<InfoPage slug="faq" />) },
      { path: 'delivery', element: routeElement(<InfoPage slug="delivery" />) },
      { path: 'contact', element: routeElement(<InfoPage slug="contact" />) },
      { path: 'legal/:slug', element: routeElement(<LegalPage />) },
      { path: '*', element: routeElement(<NotFoundPage />) },
    ],
  },
];

export function createAppRouter(initialEntries?: string[]) {
  return initialEntries
    ? createMemoryRouter(appRoutes, { initialEntries })
    : createBrowserRouter(appRoutes);
}
