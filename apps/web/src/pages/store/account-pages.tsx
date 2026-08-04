import { zodResolver } from '@hookform/resolvers/zod';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CircleDollarSign,
  FileText,
  Heart,
  Home,
  LogOut,
  MapPin,
  MonitorSmartphone,
  PackageCheck,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router';
import { z } from 'zod';

import { customerAuthClient } from '../../api/customer-client';
import { ApiError } from '../../api/http';
import { storefrontClient } from '../../api/storefront-client';
import type {
  AddressSummary,
  CreateCustomerAddressPayload,
  CustomerSessionSummary,
  ProductSummary,
} from '../../api/types';
import { CUSTOMER_SESSION_QUERY_KEY, useCustomerAuth } from '../../auth/customer-auth-context';
import { ProductCard } from '../../components/catalog/product-card';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { CheckboxField, FormField, SelectField } from '../../components/ui/form-field';
import { LocalDate, Price } from '../../components/ui/price';

const accountNav = [
  { to: '/account', key: 'account.profile', icon: UserRound, end: true },
  { to: '/account/addresses', key: 'account.addresses', icon: Home },
  { to: '/account/orders', key: 'account.orders', icon: PackageCheck },
  { to: '/account/wishlist', key: 'account.wishlist', icon: Heart },
  { to: '/account/security', key: 'account.security', icon: ShieldCheck },
] as const;

const CUSTOMER_SESSIONS_QUERY_KEY = ['customer', 'sessions'] as const;

type SessionAction = { kind: 'one'; session: CustomerSessionSummary } | { kind: 'all' };

function SessionDateTime({ value }: { value: string }) {
  const { i18n, t } = useTranslation();
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return <>{t('common.notAvailable')}</>;
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(i18n.resolvedLanguage === 'ar' ? 'ar-TN' : 'fr-TN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Africa/Tunis',
      }).format(date)}
    </time>
  );
}

const CUSTOMER_ADDRESSES_QUERY_KEY = ['customer', 'addresses'] as const;
const CUSTOMER_WISHLIST_QUERY_KEY = ['customer', 'wishlist'] as const;

function optionalAddressText(maxLength: number) {
  return z.string().trim().max(maxLength).optional();
}

function customerAddressSchema(t: (key: string) => string) {
  return z.object({
    type: z.enum(['HOME', 'WORK', 'OTHER']),
    label: optionalAddressText(100),
    fullName: z.string().trim().min(2, t('validation.required')).max(200),
    phone: z
      .string()
      .trim()
      .regex(/^\+216[24579]\d{7}$/, t('validation.phone')),
    governorateId: z.string().min(1, t('validation.required')),
    delegationId: z.string().min(1, t('validation.required')),
    localityId: z.string().optional(),
    postalCode: z.union([z.literal(''), z.string().regex(/^\d{4}$/, t('validation.postalCode'))]),
    street: z.string().trim().min(3, t('validation.required')).max(255),
    building: optionalAddressText(100),
    floor: optionalAddressText(30),
    apartment: optionalAddressText(30),
    landmark: optionalAddressText(255),
    deliveryInstructions: optionalAddressText(1_000),
    isDefault: z.boolean(),
  });
}

function addressFormDefaults(address: AddressSummary | null) {
  return {
    type: address?.type ?? ('HOME' as const),
    label: address?.label ?? '',
    fullName: address?.fullName ?? '',
    phone: address?.phone ?? '+216',
    governorateId: address?.governorateId ?? '',
    delegationId: address?.delegationId ?? '',
    localityId: address?.localityId ?? '',
    postalCode: address?.postalCode ?? '',
    street: address?.street ?? '',
    building: address?.building ?? '',
    floor: address?.floor ?? '',
    apartment: address?.apartment ?? '',
    landmark: address?.landmark ?? '',
    deliveryInstructions: address?.deliveryInstructions ?? '',
    isDefault: address?.isDefault ?? false,
  };
}

function AddressFormDialog({
  open,
  address,
  onOpenChange,
}: {
  open: boolean;
  address: AddressSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const schema = customerAddressSchema(t);
  type FormValues = z.input<typeof schema>;
  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
    setValue,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: addressFormDefaults(address),
  });
  const governorateId = useWatch({ control, name: 'governorateId' }) ?? '';
  const delegationId = useWatch({ control, name: 'delegationId' }) ?? '';
  const governorates = useQuery({
    queryKey: ['geography', 'governorates'],
    queryFn: storefrontClient.governorates,
    enabled: open,
  });
  const delegations = useQuery({
    queryKey: ['geography', 'delegations', governorateId],
    queryFn: () => storefrontClient.delegations(governorateId),
    enabled: open && Boolean(governorateId),
  });
  const localities = useQuery({
    queryKey: ['geography', 'localities', delegationId],
    queryFn: () => storefrontClient.localities(delegationId),
    enabled: open && Boolean(delegationId),
  });
  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const parsed = schema.parse(values);
      const payload: CreateCustomerAddressPayload = {
        type: parsed.type,
        label: parsed.label || null,
        fullName: parsed.fullName,
        phone: parsed.phone,
        governorateId: parsed.governorateId,
        delegationId: parsed.delegationId,
        localityId: parsed.localityId || null,
        postalCode: parsed.postalCode || null,
        street: parsed.street,
        building: parsed.building || null,
        floor: parsed.floor || null,
        apartment: parsed.apartment || null,
        landmark: parsed.landmark || null,
        deliveryInstructions: parsed.deliveryInstructions || null,
        isDefault: parsed.isDefault,
      };
      return address
        ? storefrontClient.updateAddress(address.id, {
            ...payload,
            expectedVersion: address.version,
          })
        : storefrontClient.createAddress(payload);
    },
    onSuccess: async (savedAddress) => {
      queryClient.setQueryData<AddressSummary[]>(CUSTOMER_ADDRESSES_QUERY_KEY, (current) => {
        if (!current) return [savedAddress];
        const exists = current.some((item) => item.id === savedAddress.id);
        return exists
          ? current.map((item) => (item.id === savedAddress.id ? savedAddress : item))
          : [savedAddress, ...current];
      });
      await queryClient.invalidateQueries({ queryKey: CUSTOMER_ADDRESSES_QUERY_KEY });
      onOpenChange(false);
    },
  });

  const submit = handleSubmit((values) => save.mutate(values));
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!save.isPending) onOpenChange(nextOpen);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="account-dialog__overlay" />
        <Dialog.Content
          className="account-dialog account-dialog--address"
          aria-describedby="address-form-description"
        >
          <Dialog.Title>
            {t(address ? 'account.editAddressTitle' : 'account.addAddressTitle')}
          </Dialog.Title>
          <Dialog.Description id="address-form-description">
            {t('account.addressFormDescription')}
          </Dialog.Description>
          <Dialog.Close asChild>
            <button
              className="account-dialog__close"
              type="button"
              aria-label={t('common.close')}
              disabled={save.isPending}
            >
              <X aria-hidden="true" size={20} />
            </button>
          </Dialog.Close>
          <form className="address-form" onSubmit={(event) => void submit(event)} noValidate>
            <div className="field-grid">
              <SelectField
                label={`${t('account.addressType')} *`}
                error={errors.type?.message}
                required
                {...register('type')}
              >
                {(['HOME', 'WORK', 'OTHER'] as const).map((type) => (
                  <option key={type} value={type}>
                    {t(`account.addressTypes.${type}`)}
                  </option>
                ))}
              </SelectField>
              <FormField
                label={t('account.addressLabel')}
                maxLength={100}
                error={errors.label?.message}
                {...register('label')}
              />
              <FormField
                label={`${t('checkout.fullName')} *`}
                autoComplete="name"
                maxLength={200}
                required
                error={errors.fullName?.message}
                {...register('fullName')}
              />
              <FormField
                label={`${t('checkout.phone')} *`}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+21620123456"
                required
                error={errors.phone?.message}
                {...register('phone')}
              />
              <SelectField
                label={`${t('checkout.governorate')} *`}
                error={errors.governorateId?.message}
                required
                {...register('governorateId', {
                  onChange: () => {
                    setValue('delegationId', '');
                    setValue('localityId', '');
                  },
                })}
              >
                <option value="">—</option>
                {address &&
                !governorates.data?.some((item) => item.id === address.governorateId) ? (
                  <option value={address.governorateId}>{address.governorate}</option>
                ) : null}
                {governorates.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={`${t('checkout.delegation')} *`}
                disabled={!governorateId}
                error={errors.delegationId?.message}
                required
                {...register('delegationId', {
                  onChange: () => setValue('localityId', ''),
                })}
              >
                <option value="">—</option>
                {address && !delegations.data?.some((item) => item.id === address.delegationId) ? (
                  <option value={address.delegationId}>{address.delegation}</option>
                ) : null}
                {delegations.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={t('checkout.locality')}
                disabled={!delegationId}
                error={errors.localityId?.message}
                {...register('localityId')}
              >
                <option value="">—</option>
                {address?.localityId &&
                !localities.data?.some((item) => item.id === address.localityId) ? (
                  <option value={address.localityId}>{address.locality}</option>
                ) : null}
                {localities.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </SelectField>
              <FormField
                label={t('checkout.postalCode')}
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={4}
                error={errors.postalCode?.message}
                {...register('postalCode')}
              />
              <FormField
                className="field--wide"
                label={`${t('checkout.street')} *`}
                autoComplete="street-address"
                maxLength={255}
                required
                error={errors.street?.message}
                {...register('street')}
              />
              <FormField label={t('checkout.building')} maxLength={100} {...register('building')} />
              <FormField label={t('checkout.floor')} maxLength={30} {...register('floor')} />
              <FormField
                label={t('checkout.apartment')}
                maxLength={30}
                {...register('apartment')}
              />
              <FormField label={t('checkout.landmark')} maxLength={255} {...register('landmark')} />
              <div className="field field--wide">
                <label htmlFor="saved-address-instructions">{t('checkout.instructions')}</label>
                <textarea
                  id="saved-address-instructions"
                  rows={3}
                  maxLength={1_000}
                  aria-invalid={Boolean(errors.deliveryInstructions)}
                  aria-describedby={
                    errors.deliveryInstructions ? 'saved-address-instructions-error' : undefined
                  }
                  {...register('deliveryInstructions')}
                />
                {errors.deliveryInstructions ? (
                  <p className="field__error" id="saved-address-instructions-error" role="alert">
                    {errors.deliveryInstructions.message}
                  </p>
                ) : null}
              </div>
            </div>
            <CheckboxField label={t('account.defaultAddress')} {...register('isDefault')} />
            {save.isError ? (
              <p className="form-banner form-banner--error" role="alert">
                {t('account.addressSaveError')}
              </p>
            ) : null}
            <div className="account-dialog__actions">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" disabled={save.isPending}>
                  {t('common.cancel')}
                </Button>
              </Dialog.Close>
              <Button type="submit" loading={save.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

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
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<{ open: boolean; address: AddressSummary | null }>({
    open: false,
    address: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<AddressSummary | null>(null);
  const addresses = useQuery({
    queryKey: CUSTOMER_ADDRESSES_QUERY_KEY,
    queryFn: storefrontClient.addresses,
  });
  const remove = useMutation({
    mutationFn: (address: AddressSummary) =>
      storefrontClient.deleteAddress(address.id, address.version),
    onSuccess: async ({ id }) => {
      queryClient.setQueryData<AddressSummary[]>(CUSTOMER_ADDRESSES_QUERY_KEY, (current) =>
        current?.filter((address) => address.id !== id),
      );
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: CUSTOMER_ADDRESSES_QUERY_KEY });
    },
  });
  if (addresses.isPending) return <LoadingState label={t('common.loading')} />;
  if (addresses.isError) return <ErrorState onRetry={() => void addresses.refetch()} />;
  return (
    <div>
      <header className="subpage-heading">
        <h2>{t('account.addressesTitle')}</h2>
        <Button type="button" onClick={() => setEditor({ open: true, address: null })}>
          <Plus aria-hidden="true" size={18} />
          {t('account.addAddress')}
        </Button>
      </header>
      {addresses.data.length === 0 ? (
        <EmptyState title={t('account.noAddresses')} body={t('account.noAddressesBody')} />
      ) : (
        <div className="address-grid">
          {addresses.data.map((address) => (
            <article key={address.id}>
              <div className="address-card__badges">
                <span>{address.label}</span>
                {address.isDefault ? <strong>{t('account.defaultAddressBadge')}</strong> : null}
              </div>
              <h3>{address.fullName}</h3>
              <address>
                {address.street}
                {address.building ? `, ${address.building}` : ''}
                <br />
                {[address.postalCode, address.locality, address.delegation]
                  .filter(Boolean)
                  .join(' · ')}
                <br />
                {address.governorate}
              </address>
              <a className="address-card__phone" href={`tel:${address.phone}`}>
                {address.phone}
              </a>
              <div className="address-card__actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditor({ open: true, address })}
                >
                  <Pencil aria-hidden="true" size={16} />
                  {t('common.edit')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    remove.reset();
                    setDeleteTarget(address);
                  }}
                >
                  <Trash2 aria-hidden="true" size={16} />
                  {t('common.delete')}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {editor.open ? (
        <AddressFormDialog
          key={editor.address?.id ?? 'new-address'}
          open={editor.open}
          address={editor.address}
          onOpenChange={(open) => setEditor({ open, address: open ? editor.address : null })}
        />
      ) : null}
      <Dialog.Root
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) {
            setDeleteTarget(null);
            remove.reset();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="account-dialog__overlay" />
          <Dialog.Content className="account-dialog" aria-describedby="delete-address-description">
            <Dialog.Title>{t('account.deleteAddressTitle')}</Dialog.Title>
            <Dialog.Description id="delete-address-description">
              {t('account.deleteAddressDescription', { label: deleteTarget?.label ?? '' })}
            </Dialog.Description>
            <Dialog.Close asChild>
              <button
                className="account-dialog__close"
                type="button"
                aria-label={t('common.close')}
                disabled={remove.isPending}
              >
                <X aria-hidden="true" size={20} />
              </button>
            </Dialog.Close>
            {remove.isError ? (
              <p className="form-banner form-banner--error" role="alert">
                {t('account.addressDeleteError')}
              </p>
            ) : null}
            <div className="account-dialog__actions">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" disabled={remove.isPending}>
                  {t('common.cancel')}
                </Button>
              </Dialog.Close>
              <Button
                type="button"
                variant="danger"
                loading={remove.isPending}
                onClick={() => (deleteTarget ? remove.mutate(deleteTarget) : undefined)}
              >
                {t('common.delete')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
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
              <StatusLabel status={order.status} />
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

function readableEnum(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function StatusLabel({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className="status-pill">
      {t(`admin.deliveryOps.statuses.${status}`, { defaultValue: readableEnum(status) })}
    </span>
  );
}

export function OrderTrackingPage() {
  const { orderNumber = '' } = useParams();
  const { i18n, t } = useTranslation();
  const queryClient = useQueryClient();
  const order = useQuery({
    queryKey: ['customer', 'order', orderNumber],
    queryFn: () => storefrontClient.order(orderNumber),
    retry: false,
  });
  const cancel = useMutation({
    mutationFn: (reason: string) =>
      storefrontClient.cancelOrder(orderNumber, order.data!.version, reason),
    onSuccess: (data) => {
      queryClient.setQueryData(['customer', 'order', orderNumber], data);
      void queryClient.invalidateQueries({ queryKey: ['customer', 'orders'] });
    },
  });
  if (order.isPending) return <LoadingState label={t('common.loading')} />;
  if (order.isError) return <ErrorState onRetry={() => void order.refetch()} />;
  return (
    <div>
      <Link className="back-link" to="/account/orders">
        {t('common.back')}
      </Link>
      <header className="subpage-heading">
        <div>
          <span className="eyebrow">{t('account.orderDetailEyebrow')}</span>
          <h2>{order.data.orderNumber}</h2>
        </div>
        <StatusLabel status={order.data.status} />
      </header>
      <dl className="order-overview">
        <div>
          <CalendarClock aria-hidden="true" size={19} />
          <dt>{t('account.placedAt')}</dt>
          <dd>
            <SessionDateTime value={order.data.createdAt} />
          </dd>
        </div>
        <div>
          <CircleDollarSign aria-hidden="true" size={19} />
          <dt>{t('account.total')}</dt>
          <dd>
            <Price millimes={order.data.grandTotalMillimes} />
          </dd>
        </div>
        <div>
          <FileText aria-hidden="true" size={19} />
          <dt>{t('account.paymentStatus')}</dt>
          <dd>
            {t(`account.paymentStatuses.${order.data.paymentStatus}`, {
              defaultValue: readableEnum(order.data.paymentStatus),
            })}
          </dd>
        </div>
        <div>
          <Truck aria-hidden="true" size={19} />
          <dt>{t('account.deliveryMethod')}</dt>
          <dd>{order.data.deliveryMethod}</dd>
        </div>
      </dl>

      <section className="order-detail-section" aria-labelledby="order-items-title">
        <div className="order-detail-section__heading">
          <h3 id="order-items-title">{t('account.orderItems')}</h3>
          <span>{t('account.itemCount', { count: order.data.items.length })}</span>
        </div>
        <div className="customer-order-items">
          {order.data.items.map((item) => (
            <article key={item.id}>
              <div>
                <h4>{item.productName}</h4>
                <p>
                  {item.variantName} · <bdi dir="ltr">{item.sku}</bdi>
                </p>
              </div>
              <dl>
                <div>
                  <dt>{t('account.quantity')}</dt>
                  <dd>{item.quantity}</dd>
                </div>
                <div>
                  <dt>{t('account.unitPrice')}</dt>
                  <dd>
                    <Price millimes={item.unitPriceMillimes} />
                  </dd>
                </div>
                <div>
                  <dt>{t('account.lineTotal')}</dt>
                  <dd>
                    <Price millimes={item.lineTotalMillimes} />
                  </dd>
                </div>
              </dl>
              {(item.warningFr || item.warningAr) && (
                <p className="customer-order-items__warning">
                  {t('account.productWarning')}{' '}
                  {i18n.resolvedLanguage === 'ar'
                    ? (item.warningAr ?? item.warningFr)
                    : (item.warningFr ?? item.warningAr)}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>

      <div className="order-detail-columns">
        <section className="order-detail-section" aria-labelledby="order-address-title">
          <div className="order-detail-section__heading">
            <h3 id="order-address-title">{t('account.immutableAddress')}</h3>
            <MapPin aria-hidden="true" size={19} />
          </div>
          {order.data.addresses.map((address) => (
            <address className="order-snapshot-address" key={address.id}>
              <strong>{address.fullName}</strong>
              <span>{address.street}</span>
              {address.building ? <span>{address.building}</span> : null}
              <span>
                {[address.postalCode, address.locality, address.delegation, address.governorate]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <a href={`tel:${address.phone}`}>
                <bdi dir="ltr">{address.phone}</bdi>
              </a>
              {address.instructions ? <small>{address.instructions}</small> : null}
            </address>
          ))}
        </section>

        <section className="order-detail-section" aria-labelledby="order-totals-title">
          <div className="order-detail-section__heading">
            <h3 id="order-totals-title">{t('account.totals')}</h3>
            <CircleDollarSign aria-hidden="true" size={19} />
          </div>
          <dl className="order-totals">
            <div>
              <dt>{t('account.subtotal')}</dt>
              <dd>
                <Price millimes={order.data.subtotalMillimes} />
              </dd>
            </div>
            <div>
              <dt>{t('account.discount')}</dt>
              <dd>
                <Price millimes={order.data.discountTotalMillimes} />
              </dd>
            </div>
            <div>
              <dt>{t('account.deliveryFee')}</dt>
              <dd>
                <Price millimes={order.data.deliveryTotalMillimes} />
              </dd>
            </div>
            <div>
              <dt>{t('account.tax')}</dt>
              <dd>
                <Price millimes={order.data.taxTotalMillimes} />
              </dd>
            </div>
            <div className="order-totals__grand">
              <dt>{t('account.cashDue')}</dt>
              <dd>
                <Price millimes={order.data.expectedCodMillimes} />
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {order.data.delivery ? (
        <section className="order-detail-section" aria-labelledby="delivery-tracking-title">
          <div className="order-detail-section__heading">
            <div>
              <h3 id="delivery-tracking-title">{t('account.deliveryTracking')}</h3>
              <StatusLabel status={order.data.delivery.status} />
            </div>
            <Truck aria-hidden="true" size={20} />
          </div>
          <dl className="delivery-facts">
            <div>
              <dt>{t('account.courier')}</dt>
              <dd>{order.data.delivery.courierName ?? t('common.notAvailable')}</dd>
            </div>
            <div>
              <dt>{t('account.trackingNumber')}</dt>
              <dd>
                {order.data.delivery.trackingNumber ? (
                  <bdi dir="ltr">{order.data.delivery.trackingNumber}</bdi>
                ) : (
                  t('common.notAvailable')
                )}
              </dd>
            </div>
            <div>
              <dt>{t('account.nextAttempt')}</dt>
              <dd>
                {order.data.delivery.nextAttemptAt ? (
                  <SessionDateTime value={order.data.delivery.nextAttemptAt} />
                ) : (
                  t('common.notAvailable')
                )}
              </dd>
            </div>
          </dl>
          {order.data.delivery.customerVisibleNotes ? (
            <p className="delivery-customer-note">{order.data.delivery.customerVisibleNotes}</p>
          ) : null}
          {order.data.delivery.events.length > 0 ? (
            <ol className="order-timeline" aria-label={t('account.deliveryHistory')}>
              {order.data.delivery.events.map((event) => (
                <li key={event.id}>
                  <span aria-hidden="true" />
                  <div>
                    <strong>
                      {t(`admin.deliveryOps.statuses.${event.toStatus}`, {
                        defaultValue: readableEnum(event.toStatus),
                      })}
                    </strong>
                    <SessionDateTime value={event.occurredAt} />
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
          {order.data.delivery.attempts.length > 0 ? (
            <div className="delivery-attempts">
              <h4>{t('account.deliveryAttempts')}</h4>
              {order.data.delivery.attempts.map((attempt) => (
                <article key={attempt.id}>
                  <strong>{t('account.attemptNumber', { number: attempt.attemptNumber })}</strong>
                  <span>
                    {t(`account.deliveryOutcomes.${attempt.outcome}`, {
                      defaultValue: readableEnum(attempt.outcome),
                    })}
                  </span>
                  <SessionDateTime value={attempt.attemptedAt} />
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="order-detail-section" aria-labelledby="order-history-title">
        <div className="order-detail-section__heading">
          <h3 id="order-history-title">{t('account.orderHistory')}</h3>
          <CalendarClock aria-hidden="true" size={19} />
        </div>
        <ol className="order-timeline">
          {order.data.history.map((event) => (
            <li key={event.id}>
              <span aria-hidden="true" />
              <div>
                <strong>
                  {t(`admin.deliveryOps.statuses.${event.toStatus}`, {
                    defaultValue: readableEnum(event.toStatus),
                  })}
                </strong>
                <SessionDateTime value={event.occurredAt} />
              </div>
            </li>
          ))}
        </ol>
      </section>

      {order.data.customerVisibleNotes.length > 0 ? (
        <section className="order-detail-section" aria-labelledby="order-notes-title">
          <h3 id="order-notes-title">{t('account.customerNotes')}</h3>
          <div className="customer-visible-notes">
            {order.data.customerVisibleNotes.map((note) => (
              <article key={note.id}>
                <p>{note.body}</p>
                <SessionDateTime value={note.createdAt} />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {order.data.cancellable ? (
        <form
          className="order-cancellation"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('reason');
            const reason = typeof value === 'string' ? value.trim() : '';
            if (reason.length >= 4) cancel.mutate(reason);
          }}
        >
          <FormField
            name="reason"
            label={t('account.cancelReason')}
            minLength={4}
            maxLength={500}
            required
          />
          <Button type="submit" variant="danger" loading={cancel.isPending}>
            {t('account.cancelOrder')}
          </Button>
        </form>
      ) : null}
      {cancel.isError ? <ErrorState compact /> : null}
    </div>
  );
}

export function SecurityPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [action, setAction] = useState<SessionAction | null>(null);
  const [revoked, setRevoked] = useState(false);
  const sessions = useQuery({
    queryKey: CUSTOMER_SESSIONS_QUERY_KEY,
    queryFn: () => customerAuthClient.sessions(),
  });
  const revoke = useMutation({
    mutationFn: async (target: SessionAction) => {
      if (target.kind === 'all') return customerAuthClient.revokeAllSessions();
      return customerAuthClient.revokeSession(target.session.id);
    },
    onMutate: () => {
      setRevoked(false);
    },
    onSuccess: async (_result, target) => {
      setAction(null);
      if (target.kind === 'all' || target.session.current) {
        await queryClient.cancelQueries({ queryKey: CUSTOMER_SESSION_QUERY_KEY });
        queryClient.setQueryData(CUSTOMER_SESSION_QUERY_KEY, null);
        queryClient.removeQueries({ queryKey: ['customer'] });
        void queryClient.invalidateQueries({ queryKey: ['cart'] });
        void navigate('/login', { replace: true });
        return;
      }
      setRevoked(true);
      await queryClient.invalidateQueries({ queryKey: CUSTOMER_SESSIONS_QUERY_KEY });
    },
  });
  const chooseAction = (target: SessionAction) => {
    revoke.reset();
    setAction(target);
  };

  if (sessions.isPending) return <LoadingState label={t('account.sessionsLoading')} />;
  if (sessions.isError) return <ErrorState onRetry={() => void sessions.refetch()} />;

  const sessionList = sessions.data.data;
  const dialogTitle =
    action?.kind === 'all' ? t('account.revokeAllTitle') : t('account.revokeOneTitle');
  const dialogDescription =
    action?.kind === 'all' ? t('account.revokeAllDescription') : t('account.revokeOneDescription');

  return (
    <div className="account-security">
      <header className="subpage-heading account-security__heading">
        <div>
          <h2>{t('account.securityTitle')}</h2>
          <p>{t('account.securityBody')}</p>
        </div>
        {sessionList.length > 0 ? (
          <Button type="button" variant="danger" onClick={() => chooseAction({ kind: 'all' })}>
            <LogOut aria-hidden="true" size={17} />
            {t('account.revokeAllSessions')}
          </Button>
        ) : null}
      </header>

      {revoked ? (
        <p className="form-banner form-banner--success" role="status">
          {t('account.revokedSuccess')}
        </p>
      ) : null}

      {sessionList.length === 0 ? (
        <EmptyState title={t('account.noSessions')} body={t('account.noSessionsBody')} />
      ) : (
        <div className="session-list">
          {sessionList.map((session) => (
            <article className="session-card" key={session.id}>
              <header className="session-card__header">
                <span className="session-card__icon" aria-hidden="true">
                  <MonitorSmartphone size={20} />
                </span>
                <div>
                  <h3>{t(session.current ? 'account.currentSession' : 'account.otherSession')}</h3>
                  {session.current ? (
                    <span className="session-card__current">{t('account.sessionCurrent')}</span>
                  ) : null}
                </div>
              </header>
              <dl className="session-card__meta">
                <div>
                  <dt>{t('account.sessionDevice')}</dt>
                  <dd>
                    {session.userAgent ? (
                      <bdi dir="ltr">{session.userAgent}</bdi>
                    ) : (
                      t('account.sessionUnknown')
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t('account.sessionIp')}</dt>
                  <dd>
                    {session.ipAddress ? (
                      <bdi dir="ltr">{session.ipAddress}</bdi>
                    ) : (
                      t('account.sessionUnknown')
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t('account.sessionLastSeen')}</dt>
                  <dd>
                    <SessionDateTime value={session.lastSeenAt} />
                  </dd>
                </div>
                <div>
                  <dt>{t('account.sessionCreated')}</dt>
                  <dd>
                    <SessionDateTime value={session.createdAt} />
                  </dd>
                </div>
                <div>
                  <dt>{t('account.sessionExpires')}</dt>
                  <dd>
                    <SessionDateTime value={session.absoluteExpiresAt} />
                  </dd>
                </div>
              </dl>
              <Button
                type="button"
                variant="danger"
                onClick={() => chooseAction({ kind: 'one', session })}
              >
                {session.current ? t('account.revokeCurrentSession') : t('account.revokeSession')}
              </Button>
            </article>
          ))}
        </div>
      )}

      <Dialog.Root
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) {
            setAction(null);
            revoke.reset();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="account-dialog__overlay" />
          <Dialog.Content className="account-dialog" aria-describedby="session-action-description">
            <Dialog.Title>{dialogTitle}</Dialog.Title>
            <Dialog.Description id="session-action-description">
              {dialogDescription}
            </Dialog.Description>
            <Dialog.Close asChild>
              <button
                className="account-dialog__close"
                type="button"
                aria-label={t('common.close')}
                disabled={revoke.isPending}
              >
                <X aria-hidden="true" size={20} />
              </button>
            </Dialog.Close>
            {revoke.isError ? (
              <p className="form-banner form-banner--error" role="alert">
                {t('account.sessionActionError')}
              </p>
            ) : null}
            <div className="account-dialog__actions">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" disabled={revoke.isPending}>
                  {t('common.cancel')}
                </Button>
              </Dialog.Close>
              <Button
                type="button"
                variant="danger"
                loading={revoke.isPending}
                onClick={() => (action ? revoke.mutate(action) : undefined)}
              >
                {action?.kind === 'all'
                  ? t('account.revokeAllSessions')
                  : t('account.confirmRevokeSession')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function WishlistProductItem({ product }: { product: ProductSummary }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: async () => {
      const detail = await storefrontClient.product(product.slug);
      for (const variant of detail.variants) {
        try {
          return await storefrontClient.removeWishlistItem(variant.id);
        } catch (error) {
          if (error instanceof ApiError && error.code === 'WISHLIST_ITEM_NOT_FOUND') continue;
          throw error;
        }
      }
      return { variantId: '', productId: product.id, saved: false as const };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CUSTOMER_WISHLIST_QUERY_KEY });
    },
  });
  return (
    <div className="wishlist-card-wrap">
      <ProductCard product={product} />
      <Button
        type="button"
        variant="secondary"
        loading={remove.isPending}
        onClick={() => remove.mutate()}
      >
        <Heart aria-hidden="true" size={17} fill="currentColor" />
        {t('account.removeWishlist')}
      </Button>
      {remove.isError ? (
        <p className="form-banner form-banner--error" role="alert">
          {t('account.wishlistActionError')}
        </p>
      ) : null}
    </div>
  );
}

export function WishlistPage() {
  const { t } = useTranslation();
  const wishlist = useQuery({
    queryKey: CUSTOMER_WISHLIST_QUERY_KEY,
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
            <WishlistProductItem key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
