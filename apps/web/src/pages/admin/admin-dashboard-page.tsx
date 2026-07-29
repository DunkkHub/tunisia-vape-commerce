import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Banknote,
  Box,
  CheckCircle2,
  ClipboardList,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { adminDataClient } from '../../api/admin-data-client';
import { Button } from '../../components/ui/button';
import { ErrorState, LoadingState } from '../../components/ui/feedback';
import { Price } from '../../components/ui/price';

export function AdminDashboardPage() {
  const { t } = useTranslation();
  const metrics = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: adminDataClient.dashboard,
    refetchInterval: 60_000,
  });
  const cards = metrics.data
    ? [
        {
          key: 'ordersCreated',
          label: t('admin.ordersCreated'),
          value: metrics.data.ordersCreated,
          icon: ClipboardList,
        },
        {
          key: 'ordersDelivered',
          label: t('admin.ordersDelivered'),
          value: metrics.data.ordersDelivered,
          icon: CheckCircle2,
        },
        {
          key: 'codExpected',
          label: t('admin.codExpected'),
          value: <Price millimes={metrics.data.codExpectedMillimes} />,
          icon: Banknote,
        },
        {
          key: 'codRemitted',
          label: t('admin.codRemitted'),
          value: <Price millimes={metrics.data.codRemittedMillimes} />,
          icon: Banknote,
        },
        {
          key: 'lowStock',
          label: t('admin.lowStock'),
          value: metrics.data.lowStockCount,
          icon: Box,
        },
        {
          key: 'deliveryFailures',
          label: t('admin.deliveryFailures'),
          value: metrics.data.deliveryFailureCount,
          icon: Truck,
        },
      ]
    : [];

  return (
    <div className="admin-page">
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">{t('admin.dashboard')}</span>
          <h1>{t('admin.dashboardTitle')}</h1>
          <p>{t('admin.dashboardSubtitle')}</p>
        </div>
        <Button
          type="button"
          variant="admin"
          onClick={() => void metrics.refetch()}
          disabled={metrics.isFetching}
        >
          <RefreshCw aria-hidden="true" size={17} />
          {t('admin.refresh')}
        </Button>
      </header>
      {metrics.isPending ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
      {metrics.isError ? <ErrorState onRetry={() => void metrics.refetch()} /> : null}
      {metrics.data ? (
        <div className="admin-metrics">
          {cards.map(({ key, label, value, icon: Icon }) => (
            <article key={key}>
              <span>
                <Icon aria-hidden="true" size={20} />
              </span>
              <p>{label}</p>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
      ) : null}
      {metrics.data && (metrics.data.lowStockCount > 0 || metrics.data.deliveryFailureCount > 0) ? (
        <div className="admin-attention-list" aria-label={t('admin.ui.attentionTitle')}>
          {metrics.data.lowStockCount > 0 ? (
            <section className="admin-attention">
              <AlertTriangle aria-hidden="true" />
              <div>
                <h2>{t('admin.lowStock')}</h2>
                <p>{t('admin.ui.attentionCount', { count: metrics.data.lowStockCount })}</p>
              </div>
            </section>
          ) : null}
          {metrics.data.deliveryFailureCount > 0 ? (
            <section className="admin-attention">
              <AlertTriangle aria-hidden="true" />
              <div>
                <h2>{t('admin.deliveryFailures')}</h2>
                <p>{t('admin.ui.attentionCount', { count: metrics.data.deliveryFailureCount })}</p>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
