import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search, ShieldCheck, UserPlus, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { adminDataClient } from '../../api/admin-data-client';
import { ApiError } from '../../api/http';
import type {
  AccountLifecyclePayload,
  AdminAccount,
  ManagedCustomerAccount,
  Pagination,
} from '../../api/types';
import { useAdminAuth } from '../../auth/admin-auth-context';
import { AdminDisclosure } from '../../components/admin/admin-workspace';
import { Button } from '../../components/ui/button';
import { CheckboxField, FormField } from '../../components/ui/form-field';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { LocalDate } from '../../components/ui/price';
import { AdminCustomerDetailDialog } from './admin-customer-detail-dialog';

type AdminAction = 'suspend' | 'reactivate' | 'anonymize';
type CustomerAction = 'suspend' | 'reactivate' | 'disable' | 'anonymize';
type LifecycleAction = AdminAction | CustomerAction;
type LifecycleTarget = AdminAccount | ManagedCustomerAccount;

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function useSearchPage() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), limit: '20' });
  if (query) params.set('q', query);
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('q');
    setQuery(typeof value === 'string' ? value.trim() : '');
    setPage(1);
  };
  return { query, page, setPage, params: params.toString(), submitSearch };
}

function SearchBar({
  id,
  value,
  onSubmit,
}: {
  id: string;
  value: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();
  return (
    <form className="admin-search" role="search" onSubmit={onSubmit}>
      <Search aria-hidden="true" size={18} />
      <label className="sr-only" htmlFor={id}>
        {t('admin.filterPlaceholder')}
      </label>
      <input id={id} name="q" defaultValue={value} placeholder={t('admin.filterPlaceholder')} />
      <Button type="submit" variant="ghost">
        {t('common.search')}
      </Button>
    </form>
  );
}

function PageControls<T>({
  page,
  setPage,
  data,
}: {
  page: number;
  setPage: (page: number) => void;
  data: Pagination<T>;
}) {
  const { t } = useTranslation();
  if (data.totalPages <= 1) return null;
  return (
    <nav className="admin-pagination" aria-label={t('common.pagination')}>
      <Button type="button" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
        {t('common.previous')}
      </Button>
      <span>{t('common.pageOf', { page: data.page, pages: data.totalPages })}</span>
      <Button
        type="button"
        variant="ghost"
        disabled={page >= data.totalPages}
        onClick={() => setPage(page + 1)}
      >
        {t('common.next')}
      </Button>
    </nav>
  );
}

function LifecycleDialog({
  action,
  target,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  action: LifecycleAction;
  target: LifecycleTarget;
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onConfirm: (payload: AccountLifecyclePayload) => Promise<void>;
}) {
  const { t } = useTranslation();
  const destructive = action === 'anonymize' || action === 'disable';
  const confirmation =
    action === 'anonymize'
      ? 'displayName' in target
        ? 'ANONYMIZE_ADMIN'
        : 'ANONYMIZE_CUSTOMER'
      : 'DISABLE_CUSTOMER';
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await onConfirm({
        expectedUserVersion: target.userVersion,
        expectedProfileVersion: target.profileVersion,
        reason: formString(form, 'reason').trim(),
        confirmed: true,
      });
    } catch {
      // The mutation exposes a safe error in the dialog and keeps it open for recovery.
    }
  };
  const targetName = 'displayName' in target ? target.displayName : target.fullName;

  return (
    <Dialog.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="admin-dialog__overlay" />
        <Dialog.Content className="admin-dialog" aria-describedby="account-action-description">
          <Dialog.Title>{t(`admin.access.actions.${action}`)}</Dialog.Title>
          <Dialog.Description id="account-action-description">
            {t('admin.access.confirmDescription', { name: targetName })}
          </Dialog.Description>
          <Dialog.Close asChild>
            <button className="admin-dialog__close" type="button" aria-label={t('common.close')}>
              <X aria-hidden="true" size={18} />
            </button>
          </Dialog.Close>
          <form onSubmit={(event) => void submit(event)}>
            <FormField
              name="reason"
              label={t('admin.access.reason')}
              minLength={4}
              maxLength={500}
              required
              autoComplete="off"
            />
            {destructive ? (
              <FormField
                name="confirmation"
                label={t('admin.access.typeConfirmation', { value: confirmation })}
                pattern={confirmation}
                required
                autoComplete="off"
              />
            ) : null}
            {error ? (
              <p className="admin-action-error" role="alert">
                {error instanceof ApiError && error.code === 'RECENT_AUTHENTICATION_REQUIRED'
                  ? t('admin.access.recentAuthenticationRequired')
                  : error.message}
              </p>
            ) : null}
            <div className="admin-dialog__actions">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost">
                  {t('common.cancel')}
                </Button>
              </Dialog.Close>
              <Button
                type="submit"
                variant={destructive || action === 'suspend' ? 'danger' : 'admin'}
                loading={pending}
              >
                {t(`admin.access.actions.${action}`)}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function StateBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className={`account-state account-state--${status.toLowerCase()}`}>
      {t(`admin.access.statuses.${status}`)}
    </span>
  );
}

function QueryBody({
  pending,
  error,
  empty,
  children,
  retry,
}: {
  pending: boolean;
  error: Error | null;
  empty: boolean;
  children: ReactNode;
  retry: () => void;
}) {
  const { t } = useTranslation();
  if (pending) return <LoadingState label={t('common.loading')} tone="admin" />;
  if (error instanceof ApiError && error.status === 403)
    return <EmptyState title={t('admin.accessDenied')} />;
  if (error) return <ErrorState onRetry={retry} />;
  if (empty) return <EmptyState title={t('admin.emptyResource')} />;
  return children;
}

export function AdminAdministratorsPage() {
  const { t } = useTranslation();
  const { user } = useAdminAuth();
  const queryClient = useQueryClient();
  const search = useSearchPage();
  const [action, setAction] = useState<{ action: AdminAction; target: AdminAccount } | null>(null);
  const [createError, setCreateError] = useState<Error | null>(null);
  const [created, setCreated] = useState(false);
  const list = useQuery({
    queryKey: ['admin', 'administrators', search.params],
    queryFn: () => adminDataClient.administrators(search.params),
    enabled: Boolean(user?.permissions.includes('system.manage')),
    placeholderData: (previous) => previous,
  });
  const create = useMutation({ mutationFn: adminDataClient.createAdministrator });
  const lifecycle = useMutation({
    mutationFn: ({
      target,
      action,
      payload,
    }: {
      target: AdminAccount;
      action: AdminAction;
      payload: AccountLifecyclePayload & { confirmation?: 'ANONYMIZE_ADMIN' };
    }) => adminDataClient.administratorAction(target.id, action, payload),
  });

  if (!user?.permissions.includes('system.manage')) {
    return <EmptyState title={t('admin.accessDenied')} />;
  }

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError(null);
    setCreated(false);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const employeeCode = formString(data, 'employeeCode').trim();
      const jobTitle = formString(data, 'jobTitle').trim();
      await create.mutateAsync({
        email: formString(data, 'email').trim(),
        displayName: formString(data, 'displayName').trim(),
        ...(employeeCode ? { employeeCode } : {}),
        ...(jobTitle ? { jobTitle } : {}),
        password: formString(data, 'password'),
        roleKeys: ['administrator'],
        confirmed: true,
      });
      form.reset();
      setCreated(true);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'administrators'] });
    } catch (error) {
      setCreateError(error instanceof Error ? error : new Error(t('common.errorTitle')));
    }
  };

  const confirmAction = async (payload: AccountLifecyclePayload) => {
    if (!action) return;
    await lifecycle.mutateAsync({
      target: action.target,
      action: action.action,
      payload:
        action.action === 'anonymize' ? { ...payload, confirmation: 'ANONYMIZE_ADMIN' } : payload,
    });
    setAction(null);
    await queryClient.invalidateQueries({ queryKey: ['admin', 'administrators'] });
  };

  return (
    <div className="admin-page admin-access-page">
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">{t('brand.adminShort')}</span>
          <h1>{t('admin.administrators')}</h1>
          <p>{t('admin.access.administratorSubtitle')}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('admin.refresh')}
          onClick={() => void list.refetch()}
        >
          <RefreshCw aria-hidden="true" size={18} />
        </Button>
      </header>

      <AdminDisclosure
        title={t('admin.access.createAdministrator')}
        description={t('admin.ui.createAdministratorHint')}
      >
        <section className="admin-access-create" aria-label={t('admin.access.createAdministrator')}>
          <div>
            <UserPlus aria-hidden="true" />
            <div>
              <span className="admin-access-create__title">
                {t('admin.access.createAdministrator')}
              </span>
              <p>{t('admin.access.createAdministratorHint')}</p>
            </div>
          </div>
          <form onSubmit={(event) => void submitCreate(event)}>
            <div className="admin-form-grid">
              <FormField
                name="displayName"
                label={t('admin.access.displayName')}
                minLength={2}
                maxLength={200}
                required
              />
              <FormField
                name="email"
                type="email"
                label={t('auth.email')}
                maxLength={254}
                autoComplete="off"
                required
              />
              <FormField
                name="employeeCode"
                label={t('admin.access.employeeCode')}
                maxLength={50}
              />
              <FormField name="jobTitle" label={t('admin.access.jobTitle')} maxLength={120} />
              <FormField
                name="password"
                type="password"
                className="field--wide"
                label={t('auth.password')}
                minLength={14}
                maxLength={128}
                autoComplete="new-password"
                hint={t('admin.access.passwordHint')}
                required
              />
            </div>
            <CheckboxField name="confirmed" required label={t('admin.access.createConfirmation')} />
            {createError ? (
              <p className="admin-action-error" role="alert">
                {createError.message}
              </p>
            ) : null}
            {created ? (
              <p className="admin-action-success" role="status">
                {t('admin.access.createdSuccess')}
              </p>
            ) : null}
            <Button type="submit" variant="admin" loading={create.isPending}>
              <ShieldCheck aria-hidden="true" size={18} />
              {t('admin.access.createAdministrator')}
            </Button>
          </form>
        </section>
      </AdminDisclosure>

      <section className="admin-list-workspace" aria-labelledby="administrators-list-title">
        <div className="admin-list-workspace__heading">
          <h2 id="administrators-list-title">{t('admin.ui.listAdministrators')}</h2>
          <p>{t('admin.ui.listAdministratorsHint')}</p>
        </div>
        <SearchBar id="administrators-search" value={search.query} onSubmit={search.submitSearch} />
      </section>
      <QueryBody
        pending={list.isPending}
        error={list.error}
        empty={!list.data?.items.length}
        retry={() => void list.refetch()}
      >
        <div className="admin-table-wrap">
          <table className="admin-table admin-account-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.columns.name')}</th>
                <th scope="col">{t('auth.email')}</th>
                <th scope="col">{t('admin.access.roles')}</th>
                <th scope="col">2FA</th>
                <th scope="col">{t('admin.columns.status')}</th>
                <th scope="col">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((account) => (
                <tr key={account.id}>
                  <td>
                    <strong>{account.displayName}</strong>
                    {account.jobTitle ? <small>{account.jobTitle}</small> : null}
                  </td>
                  <td>{account.email ?? '—'}</td>
                  <td>{account.roles.map((role) => role.name).join(', ') || '—'}</td>
                  <td>{account.twoFactorEnrolled ? t('common.yes') : t('common.no')}</td>
                  <td>
                    <StateBadge status={account.status} />
                  </td>
                  <td>
                    <div className="admin-row-actions">
                      {account.id === user.id ? (
                        <span>{t('admin.access.currentAccount')}</span>
                      ) : null}
                      {account.status === 'ACTIVE' && account.id !== user.id ? (
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => setAction({ action: 'suspend', target: account })}
                        >
                          {t('admin.access.actions.suspend')}
                        </Button>
                      ) : null}
                      {account.status === 'SUSPENDED' ? (
                        <>
                          <Button
                            type="button"
                            variant="admin"
                            onClick={() => setAction({ action: 'reactivate', target: account })}
                          >
                            {t('admin.access.actions.reactivate')}
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => setAction({ action: 'anonymize', target: account })}
                          >
                            {t('admin.access.actions.anonymize')}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data ? (
          <PageControls page={search.page} setPage={search.setPage} data={list.data} />
        ) : null}
      </QueryBody>
      {action ? (
        <LifecycleDialog
          key={`${action.action}-${action.target.id}`}
          action={action.action}
          target={action.target}
          pending={lifecycle.isPending}
          error={lifecycle.error}
          onClose={() => setAction(null)}
          onConfirm={confirmAction}
        />
      ) : null}
    </div>
  );
}

export function AdminCustomersPage() {
  const { t } = useTranslation();
  const { user } = useAdminAuth();
  const queryClient = useQueryClient();
  const search = useSearchPage();
  const [action, setAction] = useState<{
    action: CustomerAction;
    target: ManagedCustomerAccount;
  } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['admin', 'customers', search.params],
    queryFn: () => adminDataClient.customers(search.params),
    placeholderData: (previous) => previous,
  });
  const lifecycle = useMutation({
    mutationFn: ({
      target,
      action,
      payload,
    }: {
      target: ManagedCustomerAccount;
      action: CustomerAction;
      payload: AccountLifecyclePayload & {
        confirmation?: 'DISABLE_CUSTOMER' | 'ANONYMIZE_CUSTOMER';
      };
    }) => adminDataClient.customerAction(target.id, action, payload),
  });
  const canManage = Boolean(user?.permissions.includes('system.manage'));
  const canUpdate = Boolean(user?.permissions.includes('customers.update'));
  const canExport = Boolean(user?.permissions.includes('customers.export'));
  const confirmAction = async (payload: AccountLifecyclePayload) => {
    if (!action) return;
    await lifecycle.mutateAsync({
      target: action.target,
      action: action.action,
      payload:
        action.action === 'disable'
          ? { ...payload, confirmation: 'DISABLE_CUSTOMER' }
          : action.action === 'anonymize'
            ? { ...payload, confirmation: 'ANONYMIZE_CUSTOMER' }
            : payload,
    });
    setAction(null);
    await queryClient.invalidateQueries({ queryKey: ['admin', 'customers'] });
  };

  return (
    <div className="admin-page admin-access-page">
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">{t('brand.adminShort')}</span>
          <h1>{t('admin.customers')}</h1>
          <p>{t('admin.access.customerSubtitle')}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('admin.refresh')}
          onClick={() => void list.refetch()}
        >
          <RefreshCw aria-hidden="true" size={18} />
        </Button>
      </header>
      <section className="admin-list-workspace" aria-labelledby="customers-list-tools">
        <div className="admin-list-workspace__heading">
          <h2 id="customers-list-tools">{t('admin.ui.filtersTitle')}</h2>
          <p>{t('admin.ui.filtersHint')}</p>
        </div>
        <SearchBar id="customers-search" value={search.query} onSubmit={search.submitSearch} />
      </section>
      <QueryBody
        pending={list.isPending}
        error={list.error}
        empty={!list.data?.items.length}
        retry={() => void list.refetch()}
      >
        <div className="admin-table-wrap">
          <table className="admin-table admin-account-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.columns.name')}</th>
                <th scope="col">{t('admin.columns.phone')}</th>
                <th scope="col">{t('auth.email')}</th>
                <th scope="col">{t('admin.columns.status')}</th>
                <th scope="col">{t('admin.columns.date')}</th>
                <th scope="col">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((account) => (
                <tr key={account.id}>
                  <td>
                    <strong>{account.fullName}</strong>
                  </td>
                  <td>{account.normalizedPhone}</td>
                  <td>{account.email ?? '—'}</td>
                  <td>
                    <StateBadge status={account.status} />
                  </td>
                  <td>
                    <LocalDate value={account.createdAt} />
                  </td>
                  <td>
                    <div className="admin-row-actions">
                      <Button type="button" variant="ghost" onClick={() => setDetailId(account.id)}>
                        {t('admin.access.viewCustomer')}
                      </Button>
                      {!canManage ? <span>{t('admin.access.superOnly')}</span> : null}
                      {canManage && account.status === 'ACTIVE' ? (
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => setAction({ action: 'suspend', target: account })}
                        >
                          {t('admin.access.actions.suspend')}
                        </Button>
                      ) : null}
                      {canManage && account.status === 'SUSPENDED' ? (
                        <>
                          <Button
                            type="button"
                            variant="admin"
                            onClick={() => setAction({ action: 'reactivate', target: account })}
                          >
                            {t('admin.access.actions.reactivate')}
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => setAction({ action: 'disable', target: account })}
                          >
                            {t('admin.access.actions.disable')}
                          </Button>
                        </>
                      ) : null}
                      {canManage && account.status === 'DISABLED' ? (
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => setAction({ action: 'anonymize', target: account })}
                        >
                          {t('admin.access.actions.anonymize')}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data ? (
          <PageControls page={search.page} setPage={search.setPage} data={list.data} />
        ) : null}
      </QueryBody>
      {action ? (
        <LifecycleDialog
          key={`${action.action}-${action.target.id}`}
          action={action.action}
          target={action.target}
          pending={lifecycle.isPending}
          error={lifecycle.error}
          onClose={() => setAction(null)}
          onConfirm={confirmAction}
        />
      ) : null}
      {detailId ? (
        <AdminCustomerDetailDialog
          customerId={detailId}
          canUpdate={canUpdate}
          canExport={canExport}
          onClose={() => setDetailId(null)}
        />
      ) : null}
    </div>
  );
}
