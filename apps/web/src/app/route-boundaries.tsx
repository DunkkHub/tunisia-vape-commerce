import { Outlet } from 'react-router-dom';

import { AdminAuthProvider } from '../auth/admin-auth-provider';
import { CustomerAuthProvider } from '../auth/customer-auth-provider';
import { ComplianceBoundary } from '../components/compliance/compliance-boundary';

export function StorefrontBoundary() {
  return (
    <CustomerAuthProvider>
      <ComplianceBoundary />
    </CustomerAuthProvider>
  );
}

export function AdminBoundary() {
  return (
    <AdminAuthProvider>
      <Outlet />
    </AdminAuthProvider>
  );
}
