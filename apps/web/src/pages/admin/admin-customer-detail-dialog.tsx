import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, KeyRound, LogOut, NotebookPen, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { adminDataClient } from '../../api/admin-data-client';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { LocalDate, Price } from '../../components/ui/price';

export function AdminCustomerDetailDialog({
  customerId,
  canUpdate,
  canExport,
  onClose,
}: {
  customerId: string;
  canUpdate: boolean;
  canExport: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['admin', 'customer', customerId],
    queryFn: () => adminDataClient.customer(customerId),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'customer', customerId] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'customers'] }),
    ]);
  };
  const note = useMutation({
    mutationFn: (body: string) => adminDataClient.addCustomerNote(customerId, body),
    onSuccess: async () => {
      setMessage(t('admin.access.noteAdded'));
      await refresh();
    },
  });
  const reset = useMutation({
    mutationFn: () => adminDataClient.triggerCustomerPasswordReset(customerId),
    onSuccess: () => setMessage(t('admin.access.passwordResetQueued')),
  });
  const revoke = useMutation({
    mutationFn: () => adminDataClient.revokeCustomerSessions(customerId),
    onSuccess: async ({ revokedSessions }) => {
      setMessage(t('admin.access.sessionsRevoked', { count: revokedSessions }));
      await refresh();
    },
  });
  const exportData = useMutation({
    mutationFn: () => adminDataClient.exportCustomer(customerId),
    onSuccess: (payload) => {
      const objectUrl = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `customer-${customerId}.json`;
      link.click();
      URL.revokeObjectURL(objectUrl);
      setMessage(t('admin.access.exportCreated'));
    },
  });
  const submitNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    const form = event.currentTarget;
    const value = new FormData(form).get('body');
    if (typeof value !== 'string' || value.trim().length < 2) return;
    try {
      await note.mutateAsync(value.trim());
      form.reset();
    } catch {
      // React Query exposes the safe API error beside the form.
    }
  };
  const mutationError = note.error ?? reset.error ?? revoke.error ?? exportData.error;

  return (
    <Dialog.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="admin-dialog__overlay" />
        <Dialog.Content className="admin-dialog admin-customer-detail">
          <Dialog.Title>{t('admin.access.customerDetail')}</Dialog.Title>
          <Dialog.Description>{t('admin.access.customerDetailDescription')}</Dialog.Description>
          <Dialog.Close asChild>
            <button className="admin-dialog__close" type="button" aria-label={t('common.close')}>
              <X aria-hidden="true" size={18} />
            </button>
          </Dialog.Close>

          {detail.isPending ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
          {detail.error ? <ErrorState onRetry={() => void detail.refetch()} /> : null}
          {detail.data ? (
            <div className="admin-customer-detail__content">
              <section aria-labelledby="customer-identity-title">
                <h2 id="customer-identity-title">{detail.data.fullName}</h2>
                <dl className="admin-customer-facts">
                  <div>
                    <dt>{t('auth.email')}</dt>
                    <dd>{detail.data.email ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{t('admin.columns.phone')}</dt>
                    <dd>{detail.data.normalizedPhone}</dd>
                  </div>
                  <div>
                    <dt>{t('admin.columns.status')}</dt>
                    <dd>{t(`admin.access.statuses.${detail.data.status}`)}</dd>
                  </div>
                  <div>
                    <dt>{t('admin.access.lastLogin')}</dt>
                    <dd>
                      {detail.data.lastLoginAt ? (
                        <LocalDate value={detail.data.lastLoginAt} />
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              <div className="admin-customer-operations" aria-label={t('common.actions')}>
                {canUpdate ? (
                  <>
                    <Button
                      type="button"
                      variant="admin"
                      loading={reset.isPending}
                      onClick={() => {
                        if (window.confirm(t('admin.access.confirmPasswordReset'))) {
                          reset.mutate();
                        }
                      }}
                    >
                      <KeyRound aria-hidden="true" size={16} />
                      {t('admin.access.sendPasswordReset')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      loading={revoke.isPending}
                      onClick={() => {
                        if (window.confirm(t('admin.access.confirmSessionRevocation'))) {
                          revoke.mutate();
                        }
                      }}
                    >
                      <LogOut aria-hidden="true" size={16} />
                      {t('admin.access.revokeSessions')}
                    </Button>
                  </>
                ) : null}
                {canExport ? (
                  <Button
                    type="button"
                    variant="ghost"
                    loading={exportData.isPending}
                    onClick={() => exportData.mutate()}
                  >
                    <Download aria-hidden="true" size={16} />
                    {t('admin.access.exportCustomer')}
                  </Button>
                ) : null}
              </div>
              {message ? (
                <p className="admin-action-success" role="status">
                  {message}
                </p>
              ) : null}
              {mutationError ? (
                <p className="admin-action-error" role="alert">
                  {mutationError.message}
                </p>
              ) : null}

              <section aria-labelledby="customer-addresses-title">
                <h3 id="customer-addresses-title">{t('admin.access.savedAddresses')}</h3>
                {detail.data.addresses.length ? (
                  <ul className="admin-customer-list">
                    {detail.data.addresses.map((address) => (
                      <li key={address.id}>
                        <strong>{address.label ?? address.fullName}</strong>
                        <span>
                          {address.street}, {address.delegation}, {address.governorate}
                          {address.postalCode ? ` ${address.postalCode}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title={t('admin.access.noAddresses')} />
                )}
              </section>

              <section aria-labelledby="customer-orders-title">
                <h3 id="customer-orders-title">
                  {t('admin.access.orderHistory', { count: detail.data.orderCount })}
                </h3>
                {detail.data.recentOrders.length ? (
                  <ul className="admin-customer-list">
                    {detail.data.recentOrders.map((order) => (
                      <li key={order.id}>
                        <strong>{order.orderNumber}</strong>
                        <span>
                          {t(`admin.deliveryOps.statuses.${order.status}`, {
                            defaultValue: order.status,
                          })}{' '}
                          · <Price millimes={order.grandTotalMillimes} /> ·{' '}
                          <LocalDate value={order.createdAt} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title={t('admin.access.noOrders')} />
                )}
              </section>

              <section aria-labelledby="customer-sessions-title">
                <h3 id="customer-sessions-title">{t('admin.access.activeSessions')}</h3>
                {detail.data.activeSessions.length ? (
                  <ul className="admin-customer-list">
                    {detail.data.activeSessions.map((session) => (
                      <li key={session.id}>
                        <strong>{session.ipAddress ?? t('admin.access.unknownAddress')}</strong>
                        <span>
                          {session.userAgent ?? '—'} · <LocalDate value={session.lastSeenAt} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title={t('admin.access.noActiveSessions')} />
                )}
              </section>

              <section aria-labelledby="customer-notes-title">
                <h3 id="customer-notes-title">{t('admin.access.internalNotes')}</h3>
                {canUpdate ? (
                  <form
                    className="admin-customer-note-form"
                    onSubmit={(event) => void submitNote(event)}
                  >
                    <label htmlFor="customer-note">{t('admin.access.newNote')}</label>
                    <textarea
                      id="customer-note"
                      name="body"
                      minLength={2}
                      maxLength={2000}
                      required
                    />
                    <Button type="submit" variant="admin" loading={note.isPending}>
                      <NotebookPen aria-hidden="true" size={16} />
                      {t('admin.access.addNote')}
                    </Button>
                  </form>
                ) : null}
                {detail.data.notes.length ? (
                  <ul className="admin-customer-list">
                    {detail.data.notes.map((entry) => (
                      <li key={entry.id}>
                        <span>{entry.body}</span>
                        <small>
                          <LocalDate value={entry.createdAt} />
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title={t('admin.access.noNotes')} />
                )}
              </section>

              <section aria-labelledby="customer-audit-title">
                <h3 id="customer-audit-title">{t('admin.access.recentAudit')}</h3>
                {detail.data.audit.length ? (
                  <ul className="admin-customer-list">
                    {detail.data.audit.map((entry) => (
                      <li key={entry.id}>
                        <strong>{entry.action}</strong>
                        <span>
                          {entry.outcome} · <LocalDate value={entry.occurredAt} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title={t('admin.access.noAudit')} />
                )}
              </section>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
