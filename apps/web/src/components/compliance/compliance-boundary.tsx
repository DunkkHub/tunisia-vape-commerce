import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Construction, RadioTower } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { storefrontClient } from '../../api/storefront-client';
import { StorefrontShell } from '../layout/storefront-shell';
import { Button } from '../ui/button';
import { ErrorState, LoadingState } from '../ui/feedback';
import { AgeGateDialog } from './age-gate-dialog';
import { STOREFRONT_STATUS_QUERY_KEY, StorefrontStatusContext } from './storefront-status-context';

export function ServiceModePage({ mode }: { mode: 'maintenance' | 'prelaunch' }) {
  const { t } = useTranslation();
  const maintenance = mode === 'maintenance';
  return (
    <main className={`service-mode service-mode--${mode}`} id="main-content" tabIndex={-1}>
      <div className="service-mode__art" aria-hidden="true">
        {maintenance ? <Construction size={42} /> : <RadioTower size={42} />}
        <span />
        <span />
        <span />
      </div>
      <div className="service-mode__content">
        <span className="eyebrow">
          {t(maintenance ? 'statusPages.maintenanceEyebrow' : 'statusPages.prelaunchEyebrow')}
        </span>
        <h1>{t(maintenance ? 'statusPages.maintenanceTitle' : 'statusPages.prelaunchTitle')}</h1>
        <p>{t(maintenance ? 'statusPages.maintenanceBody' : 'statusPages.prelaunchBody')}</p>
        <Button asChild variant="secondary">
          <Link to="/">{t('statusPages.returnLater')}</Link>
        </Button>
      </div>
      <small>
        {t('statusPages.serviceLabel')} ·{' '}
        {new Intl.DateTimeFormat(undefined, {
          timeZone: 'Africa/Tunis',
          timeStyle: 'short',
        }).format(new Date())}
      </small>
    </main>
  );
}

export function ComplianceBoundary() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: STOREFRONT_STATUS_QUERY_KEY,
    queryFn: storefrontClient.status,
    staleTime: 15_000,
  });
  const ageMutation = useMutation({
    mutationFn: (minimumAge: number) => storefrontClient.confirmAge(minimumAge),
    onSuccess: () => {
      queryClient.setQueryData(STOREFRONT_STATUS_QUERY_KEY, (current: typeof statusQuery.data) =>
        current ? { ...current, ageConfirmed: true, ageGateRequired: false } : current,
      );
    },
  });

  if (statusQuery.isPending) return <LoadingState label={t('common.loading')} />;
  if (statusQuery.isError || !statusQuery.data)
    return <ErrorState onRetry={() => void statusQuery.refetch()} />;

  const landingPreviewAllowed =
    import.meta.env.DEV &&
    import.meta.env.VITE_STOREFRONT_DESIGN_PREVIEW === 'true' &&
    pathname === '/' &&
    statusQuery.data.minimumAge >= 1;

  if (statusQuery.data.maintenanceMode) return <ServiceModePage mode="maintenance" />;
  if (statusQuery.data.prelaunchMode && !landingPreviewAllowed)
    return <ServiceModePage mode="prelaunch" />;

  const ageOpen = statusQuery.data.ageGateRequired && !statusQuery.data.ageConfirmed;
  if (ageOpen) {
    return (
      <StorefrontStatusContext.Provider value={statusQuery.data}>
        <div className="age-entry" aria-hidden="true">
          <p>{statusQuery.data.storeName}</p>
          <div>
            <span>{statusQuery.data.minimumAge}+</span>
            <i />
            <i />
            <i />
          </div>
        </div>
        <AgeGateDialog
          open
          minimumAge={statusQuery.data.minimumAge}
          pending={ageMutation.isPending}
          error={ageMutation.isError}
          onConfirm={() => ageMutation.mutate(statusQuery.data.minimumAge)}
        />
      </StorefrontStatusContext.Provider>
    );
  }

  return (
    <StorefrontStatusContext.Provider value={statusQuery.data}>
      <StorefrontShell />
    </StorefrontStatusContext.Provider>
  );
}
