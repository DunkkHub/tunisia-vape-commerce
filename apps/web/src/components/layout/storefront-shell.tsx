import { useQuery } from '@tanstack/react-query';
import { Heart, Menu, Search, ShoppingBag, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router-dom';

import { storefrontClient } from '../../api/storefront-client';
import { useCustomerAuth } from '../../auth/customer-auth-context';
import { useStorefrontStatus } from '../compliance/storefront-status-context';
import { BrandMark } from '../brand/mark';
import { LanguageSwitch } from '../ui/language-switch';
import { RouteFocus } from './route-focus';

const primaryNav = [
  { to: '/', key: 'nav.home', end: true },
  { to: '/catalog', key: 'nav.catalog' },
  { to: '/delivery', key: 'nav.delivery' },
  { to: '/faq', key: 'nav.faq' },
] as const;

export function StorefrontShell() {
  const { t } = useTranslation();
  const { user } = useCustomerAuth();
  const status = useStorefrontStatus();
  const [menuOpen, setMenuOpen] = useState(false);
  const cartQuery = useQuery({
    queryKey: ['cart', 'summary'],
    queryFn: storefrontClient.cartSummary,
    staleTime: 10_000,
  });

  return (
    <div className="store-shell">
      <a href="#main-content" className="skip-link">
        {t('common.submit')}
      </a>
      <header className="store-header">
        <div className="legal-strip">
          <span>{t('home.eyebrow')}</span>
          <LanguageSwitch />
        </div>
        <div className="store-header__main container">
          <BrandMark storeName={status.storeName} />
          <nav className="desktop-nav" aria-label={t('nav.openMenu')}>
            {primaryNav.map((item) => (
              <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false}>
                {t(item.key)}
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <Link
              className="icon-link icon-link--desktop"
              to="/account/wishlist"
              aria-label={t('nav.wishlist')}
            >
              <Heart aria-hidden="true" />
            </Link>
            <Link className="icon-link" to="/cart" aria-label={t('nav.cart')}>
              <ShoppingBag aria-hidden="true" />
              {(cartQuery.data?.itemCount ?? 0) > 0 ? (
                <span>{cartQuery.data?.itemCount}</span>
              ) : null}
            </Link>
            <Link className="account-link" to={user ? '/account' : '/login'}>
              <UserRound aria-hidden="true" size={19} />
              <span>{t(user ? 'nav.account' : 'nav.login')}</span>
            </Link>
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
              <NavLink key={item.to} to={item.to} onClick={() => setMenuOpen(false)}>
                {t(item.key)}
              </NavLink>
            ))}
            <Link to="/account/wishlist" onClick={() => setMenuOpen(false)}>
              {t('nav.wishlist')}
            </Link>
          </nav>
        ) : null}
      </header>
      <RouteFocus />
      <main id="main-content" tabIndex={-1}>
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
