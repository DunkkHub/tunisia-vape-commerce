import { useQuery } from '@tanstack/react-query';
import { Menu, RadioTower, Search, ShoppingBag, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation } from 'react-router-dom';

import { storefrontClient } from '../../api/storefront-client';
import { useCustomerAuth } from '../../auth/customer-auth-context';
import { useStorefrontStatus } from '../compliance/storefront-status-context';
import { BrandMark } from '../brand/mark';
import { LanguageSwitch } from '../ui/language-switch';
import { RouteFocus } from './route-focus';

const primaryNav = [
  { to: '/', key: 'nav.home', end: true },
  { to: '/catalog?productType=DISPOSABLE', key: 'nav.puffs' },
  { to: '/catalog', key: 'nav.flavors' },
  { to: '/catalog?sort=newest', key: 'nav.newArrivals' },
  { to: '/delivery', key: 'nav.delivery' },
  { to: '/contact', key: 'footer.contact' },
] as const;

export function StorefrontShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const { user } = useCustomerAuth();
  const status = useStorefrontStatus();
  const [menuOpen, setMenuOpen] = useState(false);
  const homeRoute = location.pathname === '/';
  const cartQuery = useQuery({
    queryKey: ['cart', 'summary'],
    queryFn: storefrontClient.cartSummary,
    staleTime: 10_000,
  });
  const currentPath = `${location.pathname}${location.search}`;
  const navItemIsCurrent = (to: string) =>
    to === '/'
      ? currentPath === '/'
      : currentPath === to || (to === '/catalog' && currentPath === '/catalog');

  return (
    <div
      className={`store-shell ${homeRoute ? 'store-shell--home' : ''} ${
        status.prelaunchMode ? 'store-shell--prelaunch' : ''
      }`}
    >
      <a href="#main-content" className="skip-link">
        {t('common.submit')}
      </a>
      <header className="store-header">
        {!homeRoute ? (
          <div className="legal-strip">
            <span>{t('home.eyebrow')}</span>
            <LanguageSwitch />
          </div>
        ) : null}
        <div className="store-header__main container">
          <BrandMark storeName={status.storeName} />
          <nav className="desktop-nav" aria-label={t('nav.openMenu')}>
            {primaryNav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={navItemIsCurrent(item.to) ? 'active' : undefined}
                aria-current={navItemIsCurrent(item.to) ? 'page' : undefined}
              >
                {t(item.key)}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <Link
              className="icon-link icon-link--desktop"
              to="/search"
              aria-label={t('nav.searchLabel')}
            >
              <Search aria-hidden="true" />
            </Link>
            <Link
              className="icon-link icon-link--desktop"
              to={user ? '/account' : '/login'}
              aria-label={t(user ? 'nav.account' : 'nav.login')}
            >
              <UserRound aria-hidden="true" />
            </Link>
            <Link className="icon-link" to="/cart" aria-label={t('nav.cart')}>
              <ShoppingBag aria-hidden="true" />
              <span>{cartQuery.data?.itemCount ?? 0}</span>
            </Link>
            {homeRoute ? (
              <div className="header-language">
                <LanguageSwitch />
              </div>
            ) : null}
            <button
              className="menu-toggle"
              type="button"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
              <span className="sr-only">{t('nav.openMenu')}</span>
            </button>
          </div>
        </div>
        <div className="store-search container">
          <form role="search" action="/search" method="get">
            <Search aria-hidden="true" size={19} />
            <label className="sr-only" htmlFor="global-search">
              {t('nav.searchLabel')}
            </label>
            <input
              id="global-search"
              name="q"
              type="search"
              placeholder={t('nav.searchPlaceholder')}
              autoComplete="off"
            />
            <button type="submit">{t('common.search')}</button>
          </form>
        </div>
        {menuOpen ? (
          <nav id="mobile-menu" className="mobile-nav" aria-label={t('nav.openMenu')}>
            {primaryNav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={navItemIsCurrent(item.to) ? 'active' : undefined}
                aria-current={navItemIsCurrent(item.to) ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {t(item.key)}
              </Link>
            ))}
            <Link to="/account/wishlist" onClick={() => setMenuOpen(false)}>
              {t('nav.wishlist')}
            </Link>
            <Link to={user ? '/account' : '/login'} onClick={() => setMenuOpen(false)}>
              {t(user ? 'nav.account' : 'nav.login')}
            </Link>
            {homeRoute ? <LanguageSwitch /> : null}
          </nav>
        ) : null}
      </header>
      <RouteFocus />
      <main id="main-content" tabIndex={-1}>
        {status.prelaunchMode ? (
          <aside className="prelaunch-notice" aria-labelledby="prelaunch-notice-title">
            <div className="container prelaunch-notice__inner">
              <RadioTower className="prelaunch-notice__icon" aria-hidden="true" />
              <p>
                <strong id="prelaunch-notice-title">{t('statusPages.prelaunchEyebrow')}</strong>
                <span aria-hidden="true"> · </span>
                <span>{t('statusPages.prelaunchPreviewBody')}</span>
              </p>
            </div>
          </aside>
        ) : null}
        <Outlet />
      </main>
      <footer className="store-footer">
        <div className="container store-footer__grid">
          <div>
            <BrandMark storeName={status.storeName} />
            <p>{t('footer.statement')}</p>
          </div>
          <div>
            <h2>{t('footer.shop')}</h2>
            <Link to="/catalog">{t('nav.catalog')}</Link>
            <Link to="/delivery">{t('nav.delivery')}</Link>
            <Link to="/contact">{t('footer.contact')}</Link>
          </div>
          <div>
            <h2>{t('footer.compliance')}</h2>
            <Link to="/legal/terms">{t('footer.terms')}</Link>
            <Link to="/legal/privacy">{t('footer.privacy')}</Link>
            <Link to="/legal/returns">{t('footer.returns')}</Link>
            <Link to="/legal/warnings">{t('footer.warnings')}</Link>
          </div>
        </div>
        <div className="container store-footer__bottom">
          <span>
            © {new Date().getFullYear()} {status.storeName || t('brand.fallback')} ·{' '}
            {t('footer.rights')}
          </span>
          <Link className="staff-access" to="/admin/login">
            {t('footer.staffAccess')}
          </Link>
        </div>
      </footer>
    </div>
  );
}
