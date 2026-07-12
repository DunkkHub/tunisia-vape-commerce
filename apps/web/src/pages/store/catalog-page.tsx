import { useQuery } from '@tanstack/react-query';
import { Filter, Search, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { storefrontClient } from '../../api/storefront-client';
import { ProductCard } from '../../components/catalog/product-card';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { FormField, SelectField } from '../../components/ui/form-field';

const millimesToTnd = (value: string | null): string => {
  if (!value || !/^\d+$/.test(value)) return '';
  return String(Number(value) / 1_000);
};

const tndToMillimes = (value: FormDataEntryValue | null): number | null => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const amount = Number(value.replace(',', '.'));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 1_000) : null;
};

export function CatalogPage({
  mode = 'catalog',
}: {
  mode?: 'catalog' | 'search' | 'category' | 'brand';
}) {
  const { t } = useTranslation();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [priceError, setPriceError] = useState<string>();
  const queryString = useMemo(() => {
    const query = new URLSearchParams(searchParams);
    query.set('page', query.get('page') ?? '1');
    query.set('limit', '12');
    if (mode === 'category' && params.slug) query.set('category', params.slug);
    if (mode === 'brand' && params.slug) query.set('brand', params.slug);
    return query.toString();
  }, [mode, params.slug, searchParams]);
  const productsQuery = useQuery({
    queryKey: ['products', queryString],
    queryFn: () => storefrontClient.products(queryString),
    placeholderData: (previous) => previous,
  });
  const facetsQuery = useQuery({
    queryKey: ['catalog', 'facets'],
    queryFn: storefrontClient.catalogFacets,
    staleTime: 5 * 60_000,
  });

  const title =
    mode === 'category'
      ? t('catalog.categoryTitle', { name: params.slug ?? '' })
      : mode === 'brand'
        ? t('catalog.brandTitle', { name: params.slug ?? '' })
        : t('catalog.title');

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = new URLSearchParams(searchParams);
    const rawQuery = data.get('q');
    const rawSort = data.get('sort');
    const rawBrand = data.get('brand');
    const rawProductType = data.get('productType');
    const rawFlavor = data.get('flavor');
    const q = typeof rawQuery === 'string' ? rawQuery.trim() : '';
    const sort = typeof rawSort === 'string' ? rawSort : 'newest';
    const minimumMillimes = tndToMillimes(data.get('minimumPrice'));
    const maximumMillimes = tndToMillimes(data.get('maximumPrice'));
    if (minimumMillimes !== null && maximumMillimes !== null && maximumMillimes < minimumMillimes) {
      setPriceError(t('catalog.invalidPriceRange'));
      return;
    }
    setPriceError(undefined);
    if (q) next.set('q', q);
    else next.delete('q');
    for (const [key, rawValue] of [
      ['brand', rawBrand],
      ['productType', rawProductType],
      ['flavor', rawFlavor],
    ] as const) {
      const value = typeof rawValue === 'string' ? rawValue.trim() : '';
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (minimumMillimes !== null) next.set('minPriceMillimes', String(minimumMillimes));
    else next.delete('minPriceMillimes');
    if (maximumMillimes !== null) next.set('maxPriceMillimes', String(maximumMillimes));
    else next.delete('maxPriceMillimes');
    next.set('sort', sort);
    next.set('page', '1');
    setSearchParams(next);
  };

  const goToPage = (page: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(page));
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="catalog-page container page-pad">
      <header className="page-heading page-heading--split">
        <div>
          <span className="eyebrow">{t('catalog.eyebrow')}</span>
          <h1>{title}</h1>
          <p>{t('catalog.subtitle')}</p>
        </div>
        {productsQuery.data ? (
          <span className="result-count">
            {t('catalog.results', { count: productsQuery.data.total })}
          </span>
        ) : null}
      </header>
      <div className="catalog-layout">
        <aside className="catalog-filters">
          <div className="catalog-filters__title">
            <Filter aria-hidden="true" size={19} />
            <h2>{t('catalog.filters')}</h2>
          </div>
          <form onSubmit={applyFilters}>
            <FormField
              name="q"
              type="search"
              label={t('catalog.query')}
              defaultValue={searchParams.get('q') ?? ''}
              leading={<Search aria-hidden="true" size={17} />}
            />
            {mode !== 'brand' ? (
              <SelectField
                name="brand"
                label={t('catalog.brand')}
                defaultValue={searchParams.get('brand') ?? ''}
              >
                <option value="">{t('catalog.allBrands')}</option>
                {facetsQuery.data?.brands.map((brand) => (
                  <option key={brand.id} value={brand.slug}>
                    {brand.name}
                  </option>
                ))}
              </SelectField>
            ) : null}
            <SelectField
              name="productType"
              label={t('catalog.productType')}
              defaultValue={searchParams.get('productType') ?? ''}
            >
              <option value="">{t('catalog.allProductTypes')}</option>
              {facetsQuery.data?.productTypes.map((productType) => (
                <option key={productType} value={productType}>
                  {t(`admin.productTypes.${productType}`)}
                </option>
              ))}
            </SelectField>
            <SelectField
              name="flavor"
              label={t('catalog.flavor')}
              defaultValue={searchParams.get('flavor') ?? ''}
            >
              <option value="">{t('catalog.allFlavors')}</option>
              {facetsQuery.data?.flavors.map((flavor) => (
                <option key={flavor.value} value={flavor.value}>
                  {flavor.value} ({flavor.productCount})
                </option>
              ))}
            </SelectField>
            <FormField
              name="minimumPrice"
              type="number"
              min={0}
              step="0.001"
              inputMode="decimal"
              label={t('catalog.minimumPrice')}
              defaultValue={millimesToTnd(searchParams.get('minPriceMillimes'))}
            />
            <FormField
              name="maximumPrice"
              type="number"
              min={0}
              step="0.001"
              inputMode="decimal"
              label={t('catalog.maximumPrice')}
              defaultValue={millimesToTnd(searchParams.get('maxPriceMillimes'))}
              error={priceError}
            />
            <SelectField
              name="sort"
              label={t('catalog.sort')}
              defaultValue={searchParams.get('sort') ?? 'newest'}
            >
              <option value="newest">{t('catalog.sortNewest')}</option>
              <option value="price_asc">{t('catalog.sortPriceAsc')}</option>
              <option value="price_desc">{t('catalog.sortPriceDesc')}</option>
            </SelectField>
            <Button type="submit">{t('catalog.apply')}</Button>
            {searchParams.size > 0 ? (
              <Button asChild variant="ghost">
                <Link to={mode === 'search' ? '/search' : '/catalog'}>
                  <X aria-hidden="true" size={17} />
                  {t('catalog.clear')}
                </Link>
              </Button>
            ) : null}
          </form>
        </aside>
        <section className="catalog-results" aria-live="polite">
          {productsQuery.isPending ? <LoadingState label={t('common.loading')} /> : null}
          {productsQuery.isError ? (
            <ErrorState onRetry={() => void productsQuery.refetch()} />
          ) : null}
          {productsQuery.data && productsQuery.data.items.length > 0 ? (
            <div className="product-grid">
              {productsQuery.data.items.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : null}
          {productsQuery.data && productsQuery.data.items.length === 0 ? (
            <EmptyState title={t('catalog.noResultsTitle')} body={t('catalog.noResultsBody')} />
          ) : null}
          {productsQuery.data && productsQuery.data.totalPages > 1 ? (
            <nav
              className="pagination"
              aria-label={t('common.pageOf', {
                page: productsQuery.data.page,
                pages: productsQuery.data.totalPages,
              })}
            >
              <Button
                type="button"
                variant="secondary"
                disabled={productsQuery.data.page <= 1}
                onClick={() => goToPage(productsQuery.data.page - 1)}
              >
                {t('common.previous')}
              </Button>
              <span>
                {t('common.pageOf', {
                  page: productsQuery.data.page,
                  pages: productsQuery.data.totalPages,
                })}
              </span>
              <Button
                type="button"
                variant="secondary"
                disabled={productsQuery.data.page >= productsQuery.data.totalPages}
                onClick={() => goToPage(productsQuery.data.page + 1)}
              >
                {t('common.next')}
              </Button>
            </nav>
          ) : null}
        </section>
      </div>
    </div>
  );
}
