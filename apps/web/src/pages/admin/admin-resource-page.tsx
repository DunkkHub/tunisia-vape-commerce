import { useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { adminDataClient } from '../../api/admin-data-client';
import { ApiError } from '../../api/http';
import type { AdminRecord } from '../../api/types';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { LocalDate, Price } from '../../components/ui/price';

type Resource =
  'catalog' | 'orders' | 'inventory' | 'customers' | 'delivery' | 'cash' | 'settings' | 'audit';
interface Column {
  key: string;
  label: string;
  kind?: 'money' | 'date' | 'boolean' | 'productType' | 'json';
}
interface ResourceConfig {
  titleKey: string;
  endpoint: string;
  columns: Column[];
}

function config(t: (key: string) => string): Record<Resource, ResourceConfig> {
  return {
    catalog: {
      titleKey: 'admin.catalog',
      endpoint: 'products',
      columns: [
        { key: 'sku', label: t('admin.columns.sku') },
        { key: 'name', label: t('admin.columns.name') },
        { key: 'brandName', label: t('admin.columns.brand') },
        { key: 'productType', label: t('admin.columns.productType'), kind: 'productType' },
        { key: 'flavor', label: t('admin.columns.flavor') },
        { key: 'publicationStatus', label: t('admin.columns.status') },
        { key: 'availableQuantity', label: t('admin.columns.stock') },
        { key: 'sellingPriceMillimes', label: t('admin.columns.price'), kind: 'money' },
      ],
    },
    orders: {
      titleKey: 'admin.orders',
      endpoint: 'orders',
      columns: [
        { key: 'orderNumber', label: t('admin.columns.order') },
        { key: 'customerName', label: t('admin.columns.customer') },
        { key: 'status', label: t('admin.columns.status') },
        { key: 'grandTotalMillimes', label: t('admin.columns.total'), kind: 'money' },
        { key: 'createdAt', label: t('admin.columns.date'), kind: 'date' },
      ],
    },
    inventory: {
      titleKey: 'admin.inventory',
      endpoint: 'inventory',
      columns: [
        { key: 'sku', label: t('admin.columns.sku') },
        { key: 'name', label: t('admin.columns.name') },
        { key: 'availableQuantity', label: t('admin.columns.stock') },
        { key: 'status', label: t('admin.columns.status') },
      ],
    },
    customers: {
      titleKey: 'admin.customers',
      endpoint: 'customers',
      columns: [
        { key: 'fullName', label: t('admin.columns.name') },
        { key: 'normalizedPhone', label: t('admin.columns.phone') },
        { key: 'status', label: t('admin.columns.status') },
        { key: 'createdAt', label: t('admin.columns.date'), kind: 'date' },
      ],
    },
    delivery: {
      titleKey: 'admin.delivery',
      endpoint: 'deliveries',
      columns: [
        { key: 'trackingNumber', label: t('admin.columns.order') },
        { key: 'zoneName', label: t('admin.columns.zone') },
        { key: 'courierName', label: t('admin.columns.courier') },
        { key: 'status', label: t('admin.columns.status') },
      ],
    },
    cash: {
      titleKey: 'admin.cash',
      endpoint: 'cash/reconciliations',
      columns: [
        { key: 'courierName', label: t('admin.columns.courier') },
        { key: 'expectedMillimes', label: t('admin.columns.expected'), kind: 'money' },
        { key: 'remittedMillimes', label: t('admin.columns.remitted'), kind: 'money' },
        { key: 'status', label: t('admin.columns.status') },
      ],
    },
    settings: {
      titleKey: 'admin.settings',
      endpoint: 'settings',
      columns: [
        { key: 'key', label: t('admin.columns.name') },
        { key: 'value', label: t('common.details'), kind: 'json' },
        { key: 'updatedAt', label: t('admin.columns.date'), kind: 'date' },
      ],
    },
    audit: {
      titleKey: 'admin.audit',
      endpoint: 'audit',
      columns: [
        { key: 'actorName', label: t('admin.columns.actor') },
        { key: 'action', label: t('admin.columns.action') },
        { key: 'resourceType', label: t('admin.columns.resource') },
        { key: 'createdAt', label: t('admin.columns.timestamp'), kind: 'date' },
      ],
    },
  };
}

function Cell({ record, column }: { record: AdminRecord; column: Column }) {
  const { t } = useTranslation();
  const value = record[column.key];
  if (column.kind === 'money' && typeof value === 'number') return <Price millimes={value} />;
  if (column.kind === 'date' && typeof value === 'string') return <LocalDate value={value} />;
  if (column.kind === 'boolean' && typeof value === 'boolean') return <span>{String(value)}</span>;
  if (column.kind === 'productType' && typeof value === 'string') {
    return <span>{t(`admin.productTypes.${value}`)}</span>;
  }
  if (column.kind === 'json' && value !== undefined) {
    return <span>{typeof value === 'string' ? value : JSON.stringify(value)}</span>;
  }
  if (typeof value === 'string' || typeof value === 'number') return <span>{value}</span>;
  return <span>—</span>;
}

export function AdminResourcePage({ resource }: { resource: Resource }) {
  const { t } = useTranslation();
  const resourceConfig = config(t)[resource];
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), limit: '20' });
  if (query) params.set('q', query);
  const list = useQuery({
    queryKey: ['admin', resource, params.toString()],
    queryFn: () => adminDataClient.list(resourceConfig.endpoint, params.toString()),
    placeholderData: (previous) => previous,
  });
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rawValue = new FormData(event.currentTarget).get('q');
    setQuery(typeof rawValue === 'string' ? rawValue.trim() : '');
    setPage(1);
  };
  let body: ReactNode;
  if (list.isPending) body = <LoadingState label={t('common.loading')} tone="admin" />;
  else if (list.error instanceof ApiError && list.error.status === 403)
    body = <EmptyState title={t('admin.accessDenied')} />;
  else if (list.isError) body = <ErrorState onRetry={() => void list.refetch()} />;
  else if (list.data.items.length === 0) body = <EmptyState title={t('admin.emptyResource')} />;
  else
    body = (
      <>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                {resourceConfig.columns.map((column) => (
                  <th key={column.key} scope="col">
                    {column.label}
                  </th>
                ))}
                {resource === 'catalog' ? <th scope="col">{t('common.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((record) => (
                <tr key={record.id}>
                  {resourceConfig.columns.map((column) => (
                    <td key={column.key}>
                      <Cell record={record} column={column} />
                    </td>
                  ))}
                  {resource === 'catalog' ? (
                    <td>
                      <Link to={`/admin/catalog/${record.id}/edit`}>{t('common.edit')}</Link>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data.totalPages > 1 ? (
          <nav className="admin-pagination">
            <Button
              type="button"
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              {t('common.previous')}
            </Button>
            <span>{t('common.pageOf', { page: list.data.page, pages: list.data.totalPages })}</span>
            <Button
              type="button"
              variant="ghost"
              disabled={page >= list.data.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              {t('common.next')}
            </Button>
          </nav>
        ) : null}
      </>
    );

  return (
    <div className="admin-page">
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">{t('brand.adminShort')}</span>
          <h1>{t(resourceConfig.titleKey)}</h1>
          <p>{t('admin.resourceSubtitle')}</p>
        </div>
        <div className="admin-heading-actions">
          {resource === 'catalog' ? (
            <Button asChild variant="admin">
              <Link to="/admin/catalog/new">
                <Plus aria-hidden="true" size={17} />
                {t('admin.newProduct')}
              </Link>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            aria-label={t('admin.refresh')}
            onClick={() => void list.refetch()}
          >
            <RefreshCw aria-hidden="true" size={18} />
          </Button>
        </div>
      </header>
      <form className="admin-search" role="search" onSubmit={submitSearch}>
        <Search aria-hidden="true" size={18} />
        <label className="sr-only" htmlFor={`${resource}-search`}>
          {t('admin.filterPlaceholder')}
        </label>
        <input
          id={`${resource}-search`}
          name="q"
          defaultValue={query}
          placeholder={t('admin.filterPlaceholder')}
        />
        <Button type="submit" variant="ghost">
          {t('common.search')}
        </Button>
      </form>
      {body}
    </div>
  );
}
