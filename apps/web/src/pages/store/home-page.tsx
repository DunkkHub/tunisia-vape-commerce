import { useQuery } from '@tanstack/react-query';
import { Banknote, ChevronRight, MapPinned, Search, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { storefrontClient } from '../../api/storefront-client';
import { ProductCard } from '../../components/catalog/product-card';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';

export function HomePage() {
  const { t } = useTranslation();
  const homeQuery = useQuery({
    queryKey: ['storefront', 'home'],
    queryFn: storefrontClient.home,
    staleTime: 60_000,
  });

  return (
    <>
      <section className="hero">
        <div className="container hero__grid">
          <div className="hero__content">
            <span className="eyebrow">{t('home.eyebrow')}</span>
            <h1>{t('home.title')}</h1>
            <p>{t('home.subtitle')}</p>
            <div className="hero__actions">
              <Button asChild>
                <Link to="/catalog">
                  {t('home.browse')}
                  <ChevronRight aria-hidden="true" size={18} />
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/delivery">{t('home.deliveryCta')}</Link>
              </Button>
            </div>
          </div>
          <div className="hero__visual" aria-hidden="true">
            <div className="hero-orbit hero-orbit--one" />
            <div className="hero-orbit hero-orbit--two" />
            <div className="hero-object">
              <span />
              <span />
              <span />
            </div>
            <small>18+</small>
          </div>
        </div>
        <div className="container hero-search-card">
          <Search aria-hidden="true" size={23} />
          <div>
            <strong>{t('home.searchTitle')}</strong>
            <span>{t('nav.searchPlaceholder')}</span>
          </div>
          <form role="search" action="/search" method="get">
            <label className="sr-only" htmlFor="hero-search">
              {t('nav.searchLabel')}
            </label>
            <input
              id="hero-search"
              name="q"
              type="search"
              placeholder={t('nav.searchPlaceholder')}
            />
            <Button type="submit">{t('common.search')}</Button>
          </form>
        </div>
      </section>

      <section className="trust-band" aria-label={t('footer.statement')}>
        <div className="container trust-band__grid">
          <article>
            <ShieldCheck aria-hidden="true" />
            <div>
              <h2>{t('home.trustOneTitle')}</h2>
              <p>{t('home.trustOneBody')}</p>
            </div>
          </article>
          <article>
            <MapPinned aria-hidden="true" />
            <div>
              <h2>{t('home.trustTwoTitle')}</h2>
              <p>{t('home.trustTwoBody')}</p>
            </div>
          </article>
          <article>
            <Banknote aria-hidden="true" />
            <div>
              <h2>{t('home.trustThreeTitle')}</h2>
              <p>{t('home.trustThreeBody')}</p>
            </div>
          </article>
        </div>
      </section>

      <section className="page-section container">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t('catalog.eyebrow')}</span>
            <h2>{t('home.highlightsTitle')}</h2>
            <p>{t('home.highlightsSubtitle')}</p>
          </div>
          <Link to="/catalog">
            {t('home.browse')}
            <ChevronRight aria-hidden="true" size={17} />
          </Link>
        </div>
        {homeQuery.isPending ? <LoadingState label={t('common.loading')} /> : null}
        {homeQuery.isError ? <ErrorState onRetry={() => void homeQuery.refetch()} /> : null}
        {homeQuery.data && homeQuery.data.featured.length > 0 ? (
          <div className="product-grid">
            {homeQuery.data.featured.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : null}
        {homeQuery.data && homeQuery.data.featured.length === 0 ? (
          <EmptyState title={t('home.emptyFeatured')} />
        ) : null}
      </section>

      <section className="category-section">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{t('catalog.filters')}</span>
              <h2>{t('home.categoriesTitle')}</h2>
              <p>{t('home.categoriesSubtitle')}</p>
            </div>
          </div>
          {homeQuery.data && homeQuery.data.categories.length > 0 ? (
            <div className="category-grid">
              {homeQuery.data.categories.map((category, index) => (
                <Link
                  key={category.id}
                  to={`/catalog/category/${category.slug}`}
                  className="category-tile"
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <h3>{category.name}</h3>
                  {typeof category.productCount === 'number' ? (
                    <small>{t('catalog.results', { count: category.productCount })}</small>
                  ) : null}
                  <ChevronRight aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : null}
          {homeQuery.data && homeQuery.data.categories.length === 0 ? (
            <EmptyState title={t('home.emptyCategories')} />
          ) : null}
        </div>
      </section>
    </>
  );
}
