import {
  Banknote,
  Boxes,
  ClipboardList,
  Gauge,
  History,
  PackageSearch,
  Settings,
  Truck,
  UserCog,
  UsersRound,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { useAdminAuth } from '../../auth/admin-auth-context';
import { BrandMark } from '../brand/mark';
import { Button } from '../ui/button';
import { LanguageSwitch } from '../ui/language-switch';
import { RouteFocus } from './route-focus';

const adminNav = [
  { to: '/admin', key: 'admin.dashboard', icon: Gauge, permission: 'reports.read', end: true },
  { to: '/admin/catalog', key: 'admin.catalog', icon: PackageSearch, permission: 'products.read' },
  { to: '/admin/orders', key: 'admin.orders', icon: ClipboardList, permission: 'orders.read' },
  { to: '/admin/inventory', key: 'admin.inventory', icon: Boxes, permission: 'inventory.read' },
  {
    to: '/admin/customers',
    key: 'admin.customers',
    icon: UsersRound,
    permission: 'customers.read',
  },
  { to: '/admin/admins', key: 'admin.administrators', icon: UserCog, permission: 'system.manage' },
  { to: '/admin/delivery', key: 'admin.delivery', icon: Truck, permission: 'deliveries.read' },
  { to: '/admin/cash', key: 'admin.cash', icon: Banknote, permission: 'cash.read' },
  { to: '/admin/settings', key: 'admin.settings', icon: Settings, permission: 'settings.manage' },
  { to: '/admin/audit', key: 'admin.audit', icon: History, permission: 'audit.read' },
] as const;

export function AdminShell() {
  const { t } = useTranslation();
  const { user, logout } = useAdminAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const visibleNav = adminNav.filter(({ permission }) => user?.permissions.includes(permission));

  const closeSession = async () => {
    await logout();
    void navigate('/admin/login', { replace: true });
  };

  const nav = (
    <nav className="admin-nav" aria-label={t('admin.navLabel')}>
      {visibleNav.map((item) => {
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
            className="admin-menu-toggle"
            type="button"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            <PackageSearch aria-hidden="true" size={20} /> {t('common.menu')}
          </button>
          <LanguageSwitch tone="admin" />
          <span className="admin-identity">
            {t('admin.signedInAs', { name: user?.name ?? user?.email ?? '' })}
          </span>
          <Button type="button" variant="ghost" onClick={() => void closeSession()}>
            {t('admin.logout')}
          </Button>
        </header>
        {mobileOpen ? <div className="admin-mobile-nav">{nav}</div> : null}
        <RouteFocus />
        <main id="main-content" tabIndex={-1} className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
