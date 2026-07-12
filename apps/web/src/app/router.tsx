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
  AdminInventoryPage,
  AdminLoginPage,
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
              { path: 'catalog/new', element: routeElement(<AdminProductEditorPage />) },
              { path: 'catalog/:id/edit', element: routeElement(<AdminProductEditorPage />) },
              { path: 'orders', element: routeElement(<AdminResourcePage resource="orders" />) },
              {
                path: 'inventory',
                element: routeElement(<AdminInventoryPage />),
              },
              {
                path: 'customers',
                element: routeElement(<AdminResourcePage resource="customers" />),
              },
              {
                path: 'delivery',
                element: routeElement(<AdminResourcePage resource="delivery" />),
              },
              { path: 'cash', element: routeElement(<AdminResourcePage resource="cash" />) },
              {
                path: 'settings',
                element: routeElement(<AdminResourcePage resource="settings" />),
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
      { path: 'cart', element: routeElement(<CartPage />) },
      { path: 'checkout', element: routeElement(<CheckoutPage />) },
      { path: 'order-confirmation/:orderNumber', element: routeElement(<OrderConfirmationPage />) },
      { path: 'login', element: routeElement(<CustomerLoginPage />) },
      { path: 'register', element: routeElement(<RegisterPage />) },
      { path: 'password-reset', element: routeElement(<PasswordResetPage />) },
      {
        element: <CustomerGuard />,
        children: [
          {
            path: 'account',
            element: routeElement(<AccountLayout />),
            children: [
              { index: true, element: routeElement(<ProfilePage />) },
              { path: 'addresses', element: routeElement(<AddressesPage />) },
              { path: 'orders', element: routeElement(<OrdersPage />) },
              { path: 'orders/:orderNumber', element: routeElement(<OrderTrackingPage />) },
              { path: 'wishlist', element: routeElement(<WishlistPage />) },
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
