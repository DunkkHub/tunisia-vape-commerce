import { useQuery } from '@tanstack/react-query';
import {
  Banknote,
  BadgeCheck,
  Cherry,
  ChevronRight,
  Grape,
  Headphones,
  Leaf,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Truck,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { storefrontClient } from '../../api/storefront-client';
import { ProductCard } from '../../components/catalog/product-card';
import { useStorefrontStatus } from '../../components/compliance/storefront-status-context';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';

interface SpotlightTile {
  label: string;
  detail: string;
  to: string;
  Icon: LucideIcon;
}

const spotlightIcons = [Leaf, Cherry, Grape, Zap] as const;

export function HomePage() {
  const { t, i18n } = useTranslation();
  const status = useStorefrontStatus();
  const displayBrand = status.storeName.trim() || t('brand.fallback');
  const homeQuery = useQuery({
    queryKey: ['storefront', 'home'],
    queryFn: storefrontClient.home,
    staleTime: 60_000,
  });
  const facetsQuery = useQuery({
    queryKey: ['catalog', 'facets'],
    queryFn: storefrontClient.catalogFacets,
    staleTime: 5 * 60_000,
  });

  const fallbackSpotlights: SpotlightTile[] = [
    {
      label: t('home.spotlightDisposable'),
      detail: t('home.spotlightDisposableBody'),
      to: '/catalog?productType=DISPOSABLE',
      Icon: Leaf,
    },
    {
      label: t('home.spotlightLiquid'),
      detail: t('home.spotlightLiquidBody'),
      to: '/catalog?productType=E_LIQUID',
      Icon: Cherry,
    },
    {
      label: t('home.spotlightPod'),
      detail: t('home.spotlightPodBody'),
      to: '/catalog?productType=POD',
      Icon: Grape,
    },
    {
      label: t('home.spotlightDevice'),
      detail: t('home.spotlightDeviceBody'),
      to: '/catalog?productType=DEVICE',
      Icon: Zap,
    },
  ];
  const flavorSpotlights: SpotlightTile[] =
    facetsQuery.data?.flavors.slice(0, 4).map((flavor, index) => ({
      label: i18n.resolvedLanguage === 'ar' ? flavor.nameAr : flavor.nameFr,
      detail: t('catalog.results', { count: flavor.productCount }),
      to: `/catalog?flavor=${encodeURIComponent(flavor.value)}`,
      Icon: spotlightIcons[index] ?? Sparkles,
    })) ?? [];
  const spotlights = flavorSpotlights.length > 0 ? flavorSpotlights : fallbackSpotlights;
  const featuredProducts = homeQuery.data?.featured.slice(0, 4) ?? [];

  return (
    <div className="neon-home">
      <section className="neon-hero" aria-labelledby="home-hero-title">
        <div className="neon-hero__aurora" aria-hidden="true" />
        <div className="container neon-hero__grid">
          <div className="neon-hero__content">
            <span className="neon-hero__adult">
              <ShieldCheck aria-hidden="true" size={16} />
              {t('home.eyebrow')}
            </span>
            <h1 id="home-hero-title" aria-label={t('home.title')}>
              <span>{t('home.titleLead')}</span>
              <strong>{t('home.titleAccent')}</strong>
            </h1>
            <p className="neon-hero__tagline">{t('home.tagline')}</p>
            <p className="neon-hero__description">{t('home.subtitle')}</p>
            <div className="neon-hero__actions">
              <Button asChild className="neon-cta">
                <Link to="/catalog">
                  <ShoppingBag aria-hidden="true" size={18} />
                  {t('home.browse')}
                </Link>
              </Button>
              <Button asChild variant="secondary" className="neon-cta neon-cta--secondary">
                <a href="#popular-products">
                  <Sparkles aria-hidden="true" size={18} />
                  {t('home.discover')}
                </a>
              </Button>
            </div>
          </div>

          <div className="jet-stage" aria-hidden="true">
            <div className="jet-stage__ring" />
            <div className="jet-stage__smoke jet-stage__smoke--one" />
            <div className="jet-stage__smoke jet-stage__smoke--two" />
            <div className="jet-stage__smoke jet-stage__smoke--three" />
            <div className="jet-device">
              <div className="jet-device__mouthpiece" />
              <div className="jet-device__cap" />
              <div className="jet-device__shine" />
              <strong>{displayBrand}</strong>
              <span className="jet-device__mark" />
              <div className="jet-device__base" />
            </div>
            <div className="jet-stage__ground" />
            <div className="jet-stage__city">
              <span />
              <span />
              <span />
              <i />
            </div>
          </div>

          <aside className="flavor-spotlights" aria-label={t('home.spotlightTitle')}>
            {spotlights.map(({ label, detail, to, Icon }, index) => (
              <Link
                key={`${label}-${to}`}
                to={to}
                className={`flavor-spotlight flavor-spotlight--${index + 1}`}
              >
                <span className="flavor-spotlight__art" aria-hidden="true">
                  <Icon />
                  <i />
                </span>
                <strong>{label}</strong>
                <small>{detail}</small>
                <ChevronRight aria-hidden="true" className="flavor-spotlight__arrow" />
              </Link>
            ))}
          </aside>
        </div>

        <div className="container neon-hero__trust" aria-label={t('footer.statement')}>
          <article>
            <Zap aria-hidden="true" />
            <div>
              <strong>{t('home.trustTwoTitle')}</strong>
              <span>{t('home.trustTwoBody')}</span>
            </div>
          </article>
          <article>
            <BadgeCheck aria-hidden="true" />
            <div>
              <strong>{t('home.trustOneTitle')}</strong>
              <span>{t('home.trustOneBody')}</span>
            </div>
          </article>
          <article>
            <Banknote aria-hidden="true" />
            <div>
              <strong>{t('home.trustThreeTitle')}</strong>
              <span>{t('home.trustThreeBody')}</span>
            </div>
          </article>
        </div>
        <div className="neon-wave" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </section>

      <section className="container brand-ribbon" aria-label={t('home.brandStoryLabel')}>
        <div className="brand-ribbon__mark" aria-hidden="true">
          <span />
        </div>
        <p>
          {t('home.brandStoryOne')} <strong>{t('home.brandStoryOneAccent')}</strong>
        </p>
        <p>{t('home.brandStoryTwo')}</p>
        <p>
          <strong>{displayBrand}.</strong> {t('home.brandStoryThree')}
        </p>
      </section>

      <section className="page-section container home-popular" id="popular-products">
        <div className="home-section-title">
          <span />
          <h2>
            {t('home.highlightsTitle')} <strong>{t('home.highlightsAccent')}</strong>
          </h2>
          <span />
        </div>
        <p className="home-section-intro">{t('home.highlightsSubtitle')}</p>
        {homeQuery.isPending ? <LoadingState label={t('common.loading')} /> : null}
        {homeQuery.isError ? <ErrorState onRetry={() => void homeQuery.refetch()} /> : null}
        {featuredProducts.length > 0 ? (
          <div className="product-grid home-product-grid">
            {featuredProducts.map((product) => (
              <ProductCard key={product.id} product={product} variant="featured" />
            ))}
          </div>
        ) : null}
        {homeQuery.data && featuredProducts.length === 0 ? (
          <div className="home-catalog-empty">
            <div className="home-catalog-empty__devices" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <EmptyState
              title={t('home.emptyFeatured')}
              body={t('home.emptyFeaturedBody')}
              action={
                <Button asChild variant="secondary">
                  <Link to="/catalog">{t('home.browse')}</Link>
                </Button>
              }
            />
          </div>
        ) : null}
      </section>

      <section className="container home-benefits" aria-label={t('home.benefitsLabel')}>
        <article>
          <Sparkles aria-hidden="true" />
          <div>
            <strong>{t('home.benefitOneTitle')}</strong>
            <span>{t('home.benefitOneBody')}</span>
          </div>
        </article>
        <article>
          <PackageCheck aria-hidden="true" />
          <div>
            <strong>{t('home.benefitTwoTitle')}</strong>
            <span>{t('home.benefitTwoBody')}</span>
          </div>
        </article>
        <article>
          <Truck aria-hidden="true" />
          <div>
            <strong>{t('home.benefitThreeTitle')}</strong>
            <span>{t('home.benefitThreeBody')}</span>
          </div>
        </article>
        <article>
          <Headphones aria-hidden="true" />
          <div>
            <strong>{t('home.benefitFourTitle')}</strong>
            <span>{t('home.benefitFourBody')}</span>
          </div>
        </article>
      </section>

      <section className="category-section home-categories">
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
              {homeQuery.data.categories.slice(0, 4).map((category, index) => (
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
    </div>
  );
}
