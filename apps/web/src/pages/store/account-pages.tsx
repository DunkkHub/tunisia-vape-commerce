import { useQuery } from '@tanstack/react-query';
import { Heart, Home, LogOut, PackageCheck, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';

import { storefrontClient } from '../../api/storefront-client';
import { useCustomerAuth } from '../../auth/customer-auth-context';
import { ProductCard } from '../../components/catalog/product-card';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { LocalDate, Price } from '../../components/ui/price';

const accountNav = [
  { to: '/account', key: 'account.profile', icon: UserRound, end: true },
  { to: '/account/addresses', key: 'account.addresses', icon: Home },
  { to: '/account/orders', key: 'account.orders', icon: PackageCheck },
  { to: '/account/wishlist', key: 'account.wishlist', icon: Heart },
] as const;

export function AccountLayout() {
  const { t } = useTranslation();
  return (
    <div className="account-layout container page-pad">
      <aside>
        <span className="eyebrow">{t('auth.customerEyebrow')}</span>
        <h1>{t('account.title')}</h1>
        <nav aria-label={t('account.title')}>
          {accountNav.map(({ to, key, icon: Icon, ...item }) => (
            <NavLink key={to} to={to} end={'end' in item ? item.end : false}>
              <Icon aria-hidden="true" size={18} />
              {t(key)}
            </NavLink>
          ))}
        </nav>
      </aside>
      <section className="account-content">
        <Outlet />
      </section>
    </div>
  );
}

export function ProfilePage() {
  const { t } = useTranslation();
  const { user, logout } = useCustomerAuth();
  const navigate = useNavigate();
  const signOut = async () => {
    await logout();
    void navigate('/', { replace: true });
  };
  return (
    <div>
      <header className="subpage-heading">
        <h2>{t('account.profileTitle')}</h2>
      </header>
      <dl className="profile-data">
        <div>
          <dt>{t('auth.fullName')}</dt>
          <dd>{user?.fullName}</dd>
        </div>
        <div>
          <dt>{t('auth.email')}</dt>
          <dd>{user?.email ?? t('common.notAvailable')}</dd>
        </div>
        <div>
          <dt>{t('auth.phone')}</dt>
          <dd>{user?.phone}</dd>
        </div>
      </dl>
      <Button type="button" variant="secondary" onClick={() => void signOut()}>
        <LogOut aria-hidden="true" size={17} />
        {t('auth.logout')}
      </Button>
    </div>
  );
}

export function AddressesPage() {
  const { t } = useTranslation();
  const addresses = useQuery({
    queryKey: ['customer', 'addresses'],
    queryFn: storefrontClient.addresses,
  });
  if (addresses.isPending) return <LoadingState label={t('common.loading')} />;
  if (addresses.isError) return <ErrorState onRetry={() => void addresses.refetch()} />;
  return (
    <div>
      <header className="subpage-heading">
        <h2>{t('account.addressesTitle')}</h2>
      </header>
      {addresses.data.length === 0 ? (
        <EmptyState title={t('account.noAddresses')} />
      ) : (
        <div className="address-grid">
          {addresses.data.map((address) => (
            <article key={address.id}>
              <span>{address.label}</span>
              <h3>{address.fullName}</h3>
              <p>
                {address.street}
                <br />
                {address.postalCode} {address.locality}, {address.delegation}
                <br />
                {address.governorate}
              </p>
              <a href={`tel:${address.phone}`}>{address.phone}</a>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function OrdersPage() {
  const { t } = useTranslation();
  const orders = useQuery({ queryKey: ['customer', 'orders'], queryFn: storefrontClient.orders });
  if (orders.isPending) return <LoadingState label={t('common.loading')} />;
  if (orders.isError) return <ErrorState onRetry={() => void orders.refetch()} />;
  return (
    <div>
      <header className="subpage-heading">
        <h2>{t('account.ordersTitle')}</h2>
      </header>
      {orders.data.items.length === 0 ? (
        <EmptyState title={t('account.noOrders')} />
      ) : (
        <div className="order-list">
          {orders.data.items.map((order) => (
            <article key={order.id}>
              <div>
                <span>{t('account.orderNumber')}</span>
                <h3>{order.orderNumber}</h3>
                <small>
                  {t('account.placedAt')} <LocalDate value={order.createdAt} />
                </small>
              </div>
              <span className="status-pill">{order.status}</span>
              <Price millimes={order.grandTotalMillimes} />
              <Button asChild variant="secondary">
                <Link to={`/account/orders/${order.orderNumber}`}>{t('account.track')}</Link>
              </Button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function OrderTrackingPage() {
  const { orderNumber = '' } = useParams();
  const { t } = useTranslation();
  const order = useQuery({
    queryKey: ['customer', 'order', orderNumber],
    queryFn: () => storefrontClient.order(orderNumber),
    retry: false,
  });
  if (order.isPending) return <LoadingState label={t('common.loading')} />;
  if (order.isError) return <ErrorState onRetry={() => void order.refetch()} />;
  return (
    <div>
      <Link className="back-link" to="/account/orders">
        {t('common.back')}
      </Link>
      <header className="subpage-heading">
        <h2>{order.data.orderNumber}</h2>
        <span className="status-pill">{order.data.status}</span>
      </header>
      <dl className="profile-data">
        <div>
          <dt>{t('account.placedAt')}</dt>
          <dd>
            <LocalDate value={order.data.createdAt} />
          </dd>
        </div>
        <div>
          <dt>{t('account.total')}</dt>
          <dd>
            <Price millimes={order.data.grandTotalMillimes} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function WishlistPage() {
  const { t } = useTranslation();
  const wishlist = useQuery({
    queryKey: ['customer', 'wishlist'],
    queryFn: storefrontClient.wishlist,
  });
  if (wishlist.isPending) return <LoadingState label={t('common.loading')} />;
  if (wishlist.isError) return <ErrorState onRetry={() => void wishlist.refetch()} />;
  return (
    <div>
      <header className="subpage-heading">
        <h2>{t('account.wishlistTitle')}</h2>
      </header>
      {wishlist.data.items.length === 0 ? (
        <EmptyState title={t('account.noWishlist')} />
      ) : (
        <div className="product-grid product-grid--account">
          {wishlist.data.items.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
