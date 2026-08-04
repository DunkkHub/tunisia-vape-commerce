import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, RefreshCw, Search, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { adminDataClient } from '../../api/admin-data-client';
import type { AdminInventoryPage } from '../../api/types';
import { useAdminAuth } from '../../auth/admin-auth-context';
import { AdminDisclosure } from '../../components/admin/admin-workspace';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { FormField, SelectField } from '../../components/ui/form-field';
import { LocalDate } from '../../components/ui/price';
import { downloadText } from '../../utils/download-text';

interface SummaryItem {
  key: string;
  label: string;
  onHandQuantity: number;
  reservedQuantity: number;
  remainingQuantity: number;
}

function StockSummary({ title, items }: { title: string; items: SummaryItem[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <section className="admin-stock-summary" aria-label={title}>
      <div className="admin-stock-summary__grid" role="list">
        {items.map((item) => (
          <article key={item.key} role="listitem">
            <span>{item.label}</span>
            <strong>{item.remainingQuantity}</strong>
            <small>
              {t('admin.stockBreakdown', {
                onHand: item.onHandQuantity,
                reserved: item.reservedQuantity,
              })}
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}

function summaries(data: AdminInventoryPage, t: (key: string) => string) {
  return {
    brands: data.grouping.byBrand.map((group) => ({
      key: `brand-${group.brandId ?? 'none'}`,
      label: group.brandName ?? t('admin.unbranded'),
      ...group,
    })),
    productTypes: data.grouping.byProductType.map((group) => ({
      key: `type-${group.productType}`,
      label: t(`admin.productTypes.${group.productType}`),
      ...group,
    })),
    flavors: data.grouping.byBrandAndFlavor.map((group) => ({
      key: `brand-flavor-${group.brandId ?? 'none'}-${group.flavor ?? 'none'}`,
      label: `${group.brandName ?? t('admin.unbranded')} · ${group.flavor ?? t('admin.unspecifiedFlavor')}`,
      ...group,
    })),
  };
}

export function AdminInventoryPage() {
  const { t } = useTranslation();
  const { user } = useAdminAuth();
  const canExport = Boolean(
    user?.permissions.includes('inventory.read') && user.permissions.includes('reports.export'),
  );
  const [exportMessage, setExportMessage] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const queryString = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), limit: '20' });
    for (const key of ['q', 'brand', 'productType', 'flavor'] as const) {
      const value = searchParams.get(key)?.trim();
      if (value) query.set(key, value);
    }
    return query.toString();
  }, [page, searchParams]);
  const inventory = useQuery({
    queryKey: ['admin', 'inventory', queryString],
    queryFn: () => adminDataClient.inventory(queryString),
    placeholderData: (previous) => previous,
  });
  const exportInventory = useMutation({
    mutationFn: () => adminDataClient.downloadInventory(queryString),
    onSuccess: (result) => {
      downloadText(result.content, result.filename, 'text/csv;charset=utf-8');
      setExportMessage(
        result.rowCount === null
          ? t('admin.inventoryOps.exportReady')
          : t('admin.inventoryOps.exportReadyRows', { count: result.rowCount }),
      );
    },
  });

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const key of ['q', 'brand', 'productType', 'flavor'] as const) {
      const raw = form.get(key);
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (value) next.set(key, value);
    }
    next.set('page', '1');
    setSearchParams(next);
  };
  const goToPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(nextPage));
    setSearchParams(next);
  };
  const grouped = inventory.data ? summaries(inventory.data, t) : null;

  return (
    <div className="admin-page">
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">{t('brand.adminShort')}</span>
          <h1>{t('admin.inventory')}</h1>
          <p>{t('admin.inventorySubtitle')}</p>
        </div>
        <div className="admin-toolbar-actions">
          {canExport ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => exportInventory.mutate()}
              loading={exportInventory.isPending}
            >
              <Download aria-hidden="true" size={17} />
              {t('admin.inventoryOps.exportCsv')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="admin"
            onClick={() => void inventory.refetch()}
            disabled={inventory.isFetching}
          >
            <RefreshCw aria-hidden="true" size={17} />
            {t('admin.refresh')}
          </Button>
        </div>
      </header>

      {exportMessage ? (
        <p className="form-success" role="status">
          {exportMessage}
        </p>
      ) : null}

      <AdminDisclosure
        title={t('admin.ui.filtersTitle')}
        description={t('admin.ui.filtersHint')}
        defaultOpen
      >
        <form className="admin-inventory-filters" onSubmit={applyFilters}>
          <FormField
            name="q"
            type="search"
            label={t('admin.filterPlaceholder')}
            defaultValue={searchParams.get('q') ?? ''}
            leading={<Search aria-hidden="true" size={17} />}
          />
          <SelectField
            name="brand"
            label={t('catalog.brand')}
            defaultValue={searchParams.get('brand') ?? ''}
          >
            <option value="">{t('catalog.allBrands')}</option>
            {inventory.data?.grouping.byBrand.map((brand) => (
              <option key={brand.brandId ?? 'none'} value={brand.brandId ?? ''}>
                {brand.brandName ?? t('admin.unbranded')}
              </option>
            ))}
          </SelectField>
          <SelectField
            name="productType"
            label={t('catalog.productType')}
            defaultValue={searchParams.get('productType') ?? ''}
          >
            <option value="">{t('catalog.allProductTypes')}</option>
            {inventory.data?.grouping.byProductType.map((group) => (
              <option key={group.productType} value={group.productType}>
                {t(`admin.productTypes.${group.productType}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            name="flavor"
            label={t('catalog.flavor')}
            defaultValue={searchParams.get('flavor') ?? ''}
          >
            <option value="">{t('catalog.allFlavors')}</option>
            {inventory.data?.grouping.byFlavor.map((group) => (
              <option key={group.flavor ?? 'none'} value={group.flavor ?? ''}>
                {group.flavor ?? t('admin.unspecifiedFlavor')}
              </option>
            ))}
          </SelectField>
          <div className="admin-inventory-filters__actions">
            <Button type="submit" variant="admin">
              {t('catalog.apply')}
            </Button>
            {searchParams.size > 0 ? (
              <Button type="button" variant="ghost" onClick={() => setSearchParams({})}>
                <X aria-hidden="true" size={17} />
                {t('catalog.clear')}
              </Button>
            ) : null}
          </div>
        </form>
      </AdminDisclosure>

      {inventory.isPending ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
      {inventory.isError ? <ErrorState onRetry={() => void inventory.refetch()} /> : null}
      {exportInventory.isError ? <ErrorState compact /> : null}
      {inventory.data ? (
        <>
          <div className="admin-inventory-asof">
            <span>{t('admin.inventoryAsOf')}</span> <LocalDate value={inventory.data.asOf} />
          </div>
          {grouped ? (
            <div className="admin-stock-sections">
              <AdminDisclosure title={t('admin.stockByBrand')} defaultOpen>
                <StockSummary title={t('admin.stockByBrand')} items={grouped.brands} />
              </AdminDisclosure>
              <AdminDisclosure title={t('admin.stockByType')}>
                <StockSummary title={t('admin.stockByType')} items={grouped.productTypes} />
              </AdminDisclosure>
              <AdminDisclosure title={t('admin.stockByFlavor')}>
                <StockSummary title={t('admin.stockByFlavor')} items={grouped.flavors} />
              </AdminDisclosure>
            </div>
          ) : null}
          {inventory.data.items.length === 0 ? (
            <EmptyState title={t('admin.emptyResource')} />
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table admin-inventory-table">
                <thead>
                  <tr>
                    <th scope="col">{t('admin.columns.sku')}</th>
                    <th scope="col">{t('admin.columns.name')}</th>
                    <th scope="col">{t('admin.columns.brand')}</th>
                    <th scope="col">{t('admin.columns.productType')}</th>
                    <th scope="col">{t('admin.columns.flavor')}</th>
                    <th scope="col">{t('admin.columns.onHand')}</th>
                    <th scope="col">{t('admin.columns.reserved')}</th>
                    <th scope="col">{t('admin.columns.remaining')}</th>
                    <th scope="col">{t('admin.columns.status')}</th>
                    <th scope="col">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.sku}</td>
                      <td>{item.name}</td>
                      <td>{item.brandName ?? t('admin.unbranded')}</td>
                      <td>{t(`admin.productTypes.${item.productType}`)}</td>
                      <td>{item.flavor ?? t('admin.unspecifiedFlavor')}</td>
                      <td>{item.onHandQuantity}</td>
                      <td>{item.reservedQuantity}</td>
                      <td>{item.remainingQuantity}</td>
                      <td>
                        {t(`admin.inventoryOps.stockStatuses.${item.status}`, {
                          defaultValue: item.status,
                        })}
                      </td>
                      <td>
                        <Link to={`/admin/inventory/${item.id}`}>{t('common.details')}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {inventory.data.totalPages > 1 ? (
            <nav
              className="admin-pagination"
              aria-label={t('common.pageOf', { page, pages: inventory.data.totalPages })}
            >
              <Button
                type="button"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                {t('common.previous')}
              </Button>
              <span>{t('common.pageOf', { page, pages: inventory.data.totalPages })}</span>
              <Button
                type="button"
                variant="ghost"
                disabled={page >= inventory.data.totalPages}
                onClick={() => goToPage(page + 1)}
              >
                {t('common.next')}
              </Button>
            </nav>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
