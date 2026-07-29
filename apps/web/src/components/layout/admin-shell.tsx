import {
  Banknote,
  Boxes,
  ClipboardList,
  FileUp,
  Gauge,
  History,
  PackageSearch,
  Settings,
  Truck,
  UserCog,
  UsersRound,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';

import { useAdminAuth } from '../../auth/admin-auth-context';
import { BrandMark } from '../brand/mark';
import { Button } from '../ui/button';
import { LanguageSwitch } from '../ui/language-switch';
import { RouteFocus } from './route-focus';

const adminNavGroups = [
  {
    key: 'admin.navGroups.overview',
    items: [
      { to: '/admin', key: 'admin.dashboard', icon: Gauge, permission: 'reports.read', end: true },
    ],
  },
  {
    key: 'admin.navGroups.commerce',
    items: [
      { to: '/admin/orders', key: 'admin.orders', icon: ClipboardList, permission: 'orders.read' },
      {
        to: '/admin/customers',
        key: 'admin.customers',
        icon: UsersRound,
        permission: 'customers.read',
      },
      { to: '/admin/delivery', key: 'admin.delivery', icon: Truck, permission: 'deliveries.read' },
      { to: '/admin/cash', key: 'admin.cash', icon: Banknote, permission: 'cash.read' },
    ],
  },
  {
    key: 'admin.navGroups.products',
    items: [
      {
        to: '/admin/catalog',
        key: 'admin.catalog',
        icon: PackageSearch,
        permission: 'products.read',
        end: true,
      },
      {
        to: '/admin/catalog/imports',
        key: 'admin.catalogImportNav',
        icon: FileUp,
        permission: 'catalog.import',
      },
      { to: '/admin/inventory', key: 'admin.inventory', icon: Boxes, permission: 'inventory.read' },
    ],
  },
  {
    key: 'admin.navGroups.system',
    items: [
      {
        to: '/admin/admins',
        key: 'admin.administrators',
        icon: UserCog,
        permission: 'system.manage',
      },
      {
        to: '/admin/settings',
        key: 'admin.settings',
        icon: Settings,
        permission: 'settings.manage',
      },
      { to: '/admin/audit', key: 'admin.audit', icon: History, permission: 'audit.read' },
    ],
  },
] as const;

export function AdminShell() {
  const { t } = useTranslation();
  const { user, logout } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const visibleNavGroups = adminNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(({ permission }) => user?.permissions.includes(permission)),
    }))
    .filter((group) => group.items.length > 0);
  const activeItem = visibleNavGroups
    .flatMap((group) => group.items.map((item) => ({ group, item })))
    .filter(
      ({ item }) =>
        location.pathname === item.to ||
        (item.to !== '/admin' && location.pathname.startsWith(`${item.to}/`)),
    )
    .sort((left, right) => right.item.to.length - left.item.to.length)[0];

  useEffect(() => {
    if (!mobileOpen) return;
    mobileNavRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileOpen(false);
      menuButtonRef.current?.focus();
    };
    globalThis.addEventListener('keydown', closeOnEscape);
    return () => globalThis.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);

  const closeSession = async () => {
    await logout();
    void navigate('/admin/login', { replace: true });
  };

  const nav = (
    <nav className="admin-nav" aria-label={t('admin.navLabel')}>
      {visibleNavGroups.map((group) => (
        <div className="admin-nav__group" key={group.key}>
          <p className="admin-nav__group-label">{t(group.key)}</p>
          {group.items.map((item) => {
            const { to, key, icon: Icon } = item;
            return (
              <NavLink
                key={to}
                to={to}
                end={'end' in item ? item.end : false}
                onClick={() => setMobileOpen(false)}
              >
                <Icon aria-hidden="true" size={19} />
                <span>{t(key)}</span>
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <BrandMark admin />
        {nav}
        <div className="admin-sidebar__foot">
          <span>{t('admin.securityNotice')}</span>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <button
            ref={menuButtonRef}
            className="admin-menu-toggle"
            type="button"
            aria-expanded={mobileOpen}
            aria-controls="admin-mobile-navigation"
            onClick={() => setMobileOpen((open) => !open)}
          >
            <PackageSearch aria-hidden="true" size={20} /> {t('common.menu')}
          </button>
          {activeItem ? (
            <div className="admin-topbar__context">
              <span>{t(activeItem.group.key)}</span>
              <strong>{t(activeItem.item.key)}</strong>
            </div>
          ) : null}
          <LanguageSwitch tone="admin" />
          <span className="admin-identity">
            {t('admin.signedInAs', { name: user?.name ?? user?.email ?? '' })}
          </span>
          <Button type="button" variant="ghost" onClick={() => void closeSession()}>
            {t('admin.logout')}
          </Button>
        </header>
        {mobileOpen ? (
          <div ref={mobileNavRef} id="admin-mobile-navigation" className="admin-mobile-nav">
            {nav}
          </div>
        ) : null}
        <RouteFocus />
        <main id="main-content" tabIndex={-1} className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
