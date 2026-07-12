import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { LoadingState } from '../components/ui/feedback';
import { useAdminAuth } from './admin-auth-context';
import { useCustomerAuth } from './customer-auth-context';

export function CustomerGuard() {
  const { user, isLoading } = useCustomerAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (isLoading) return <LoadingState label={t('account.protectedLoading')} />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function AdminGuard() {
  const { user, isLoading } = useAdminAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (isLoading) return <LoadingState label={t('admin.protectedLoading')} tone="admin" />;
  if (!user) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
