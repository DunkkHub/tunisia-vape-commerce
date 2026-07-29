import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  History,
  MessageSquareText,
  XCircle,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { adminDataClient } from '../../api/admin-data-client';
import {
  AdminWorkspaceNav,
  AdminWorkspacePanel,
  type AdminWorkspaceItem,
} from '../../components/admin/admin-workspace';
import { Button } from '../../components/ui/button';
import { ErrorState, LoadingState } from '../../components/ui/feedback';
import { FormField, SelectField } from '../../components/ui/form-field';
import { LocalDate, Price } from '../../components/ui/price';

type OrderWorkspace = 'process' | 'communication' | 'history';

export function AdminOrderDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [cancelReason, setCancelReason] = useState('');
  const [workspace, setWorkspace] = useState<OrderWorkspace>('process');
  const order = useQuery({
    queryKey: ['admin', 'order', id],
    queryFn: () => adminDataClient.order(id),
    enabled: Boolean(id),
  });
  const refreshOrder = (data?: Awaited<ReturnType<typeof adminDataClient.order>>) => {
    if (data) queryClient.setQueryData(['admin', 'order', id], data);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
  };
  const confirm = useMutation({
    mutationFn: () => adminDataClient.confirmOrder(id, order.data!.version),
    onSuccess: refreshOrder,
  });
  const cancel = useMutation({
    mutationFn: () => adminDataClient.cancelOrder(id, order.data!.version, cancelReason),
    onSuccess: (data) => {
      setCancelReason('');
      refreshOrder(data);
    },
  });
  const progress = useMutation({
    mutationFn: (operation: 'reject' | 'prepare' | 'ready') => {
      const current = order.data!;
      if (operation === 'reject') {
        return adminDataClient.rejectOrder(id, current.version, cancelReason);
      }
      if (operation === 'prepare') return adminDataClient.prepareOrder(id, current.version);
      return adminDataClient.readyOrderForPickup(id, current.version);
    },
    onSuccess: refreshOrder,
  });
  const note = useMutation({
    mutationFn: (payload: { visibility: 'INTERNAL' | 'CUSTOMER_VISIBLE'; body: string }) =>
      adminDataClient.addOrderNote(id, payload),
    onSuccess: () => void order.refetch(),
  });
  const submitNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawBody = form.get('body');
    const rawVisibility = form.get('visibility');
    const body = typeof rawBody === 'string' ? rawBody.trim() : '';
    const visibility = (typeof rawVisibility === 'string' ? rawVisibility : 'INTERNAL') as
      'INTERNAL' | 'CUSTOMER_VISIBLE';
    if (!body) return;
    note.mutate({ visibility, body });
    event.currentTarget.reset();
  };

  if (order.isPending) return <LoadingState label={t('common.loading')} tone="admin" />;
  if (order.isError) return <ErrorState onRetry={() => void order.refetch()} />;

  const data = order.data;
  const busy = confirm.isPending || cancel.isPending || progress.isPending;
  const workspaceItems: AdminWorkspaceItem<OrderWorkspace>[] = [
    {
      id: 'process',
      label: t('admin.ui.orderProcess'),
      description: t('admin.ui.orderProcessHint'),
      icon: ClipboardCheck,
    },
    {
      id: 'communication',
      label: t('admin.ui.orderCommunication'),
      description: t('admin.ui.orderCommunicationHint'),
      icon: MessageSquareText,
    },
    {
      id: 'history',
      label: t('admin.ui.orderHistory'),
      description: t('admin.ui.orderHistoryHint'),
      icon: History,
    },
  ];
  return (
    <div className="admin-page">
      <Link className="back-link" to="/admin/orders">
        <ArrowLeft aria-hidden="true" size={17} />
        {t('admin.orders')}
      </Link>
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">
            {t(`admin.deliveryOps.statuses.${data.status}`, { defaultValue: data.status })}
          </span>
          <h1>{data.orderNumber}</h1>
          <p>
            {data.customerName} · {data.customerPhone}
          </p>
        </div>
        <Price millimes={data.grandTotalMillimes} />
      </header>

      <AdminWorkspaceNav
        label={t('admin.ui.workspaceLabel')}
        value={workspace}
        items={workspaceItems}
        onChange={setWorkspace}
      />

      <AdminWorkspacePanel id="process" value={workspace}>
        <section className="admin-form-grid" aria-label={t('common.details')}>
          <article className="admin-panel">
            <h2>{t('checkout.summary')}</h2>
            <p>
              {t(`account.paymentStatuses.${data.paymentStatus}`, {
                defaultValue: data.paymentStatus,
              })}
            </p>
            <p>
              <LocalDate value={data.createdAt} />
            </p>
            <p>
              COD: <Price millimes={data.expectedCodMillimes} />
            </p>
          </article>
          <article className="admin-panel">
            <h2>{t('checkout.address')}</h2>
            {data.addresses.map((address) => (
              <address key={address.id}>
                {address.street}, {address.localityName ?? address.delegationName},{' '}
                {address.governorateName} {address.postalCode ?? ''}
              </address>
            ))}
          </article>
        </section>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.columns.sku')}</th>
                <th scope="col">{t('admin.columns.name')}</th>
                <th scope="col">{t('admin.orderOps.quantity')}</th>
                <th scope="col">{t('admin.columns.price')}</th>
                <th scope="col">{t('admin.columns.total')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.sku}</td>
                  <td>
                    {item.productName} / {item.variantName}
                  </td>
                  <td>{item.quantity}</td>
                  <td>
                    <Price millimes={item.unitPriceMillimes} />
                  </td>
                  <td>
                    <Price millimes={item.lineTotalMillimes} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data.status === 'PENDING_CONFIRMATION' ? (
          <section className="admin-panel">
            <h2>{t('common.actions')}</h2>
            <div className="admin-heading-actions">
              <Button
                type="button"
                variant="admin"
                loading={confirm.isPending}
                disabled={busy}
                onClick={() => confirm.mutate()}
              >
                <CheckCircle2 aria-hidden="true" size={17} />
                {t('admin.orderOps.confirm')}
              </Button>
            </div>
            <FormField
              label={t('admin.orderOps.cancellationReason')}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              loading={cancel.isPending}
              disabled={busy || cancelReason.trim().length < 4}
              onClick={() => cancel.mutate()}
            >
              <XCircle aria-hidden="true" size={17} />
              {t('admin.orderOps.cancel')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              loading={progress.isPending}
              disabled={busy || cancelReason.trim().length < 4}
              onClick={() => progress.mutate('reject')}
            >
              {t('admin.orderOps.reject')}
            </Button>
          </section>
        ) : null}

        {data.status === 'CONFIRMED' ? (
          <Button
            type="button"
            variant="admin"
            loading={progress.isPending}
            onClick={() => progress.mutate('prepare')}
          >
            {t('admin.orderOps.prepare')}
          </Button>
        ) : null}
        {data.status === 'PREPARING' && data.deliveryMethodType === 'STORE_PICKUP' ? (
          <Button
            type="button"
            variant="admin"
            loading={progress.isPending}
            onClick={() => progress.mutate('ready')}
          >
            {t('admin.orderOps.readyForPickup')}
          </Button>
        ) : null}
      </AdminWorkspacePanel>

      <AdminWorkspacePanel id="communication" value={workspace}>
        <section className="admin-panel">
          <h2>
            <MessageSquareText aria-hidden="true" size={18} /> {t('admin.orderOps.notes')}
          </h2>
          <form onSubmit={submitNote}>
            <SelectField
              name="visibility"
              label={t('admin.orderOps.visibility')}
              defaultValue="INTERNAL"
            >
              <option value="INTERNAL">{t('admin.orderOps.internal')}</option>
              <option value="CUSTOMER_VISIBLE">{t('admin.orderOps.customerVisible')}</option>
            </SelectField>
            <FormField name="body" label={t('admin.orderOps.newNote')} maxLength={2000} />
            <Button type="submit" variant="admin" loading={note.isPending}>
              {t('admin.orderOps.addNote')}
            </Button>
          </form>
          <ul>
            {data.notes.map((entry) => (
              <li key={entry.id}>
                <strong>
                  {t(`admin.orderOps.visibilities.${entry.visibility}`, {
                    defaultValue: entry.visibility,
                  })}
                </strong>{' '}
                — {entry.body}
              </li>
            ))}
          </ul>
        </section>

        <section className="admin-panel">
          <h2>{t('admin.orderOps.contactAttempt')}</h2>
          <form
            className="admin-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const method = form.get('method');
              const result = form.get('result');
              const explanation = form.get('explanation');
              if (typeof method !== 'string' || typeof result !== 'string') return;
              void adminDataClient
                .recordOrderContactAttempt(id, {
                  expectedVersion: data.version,
                  method: method as 'PHONE' | 'SMS' | 'EMAIL',
                  result,
                  ...(typeof explanation === 'string' && explanation.trim()
                    ? { explanation: explanation.trim() }
                    : {}),
                })
                .then(() => order.refetch());
            }}
          >
            <SelectField name="method" label={t('admin.orderOps.channel')} defaultValue="PHONE">
              <option value="PHONE">{t('admin.orderOps.phone')}</option>
              <option value="SMS">SMS</option>
              <option value="EMAIL">{t('admin.orderOps.email')}</option>
            </SelectField>
            <SelectField name="result" label={t('admin.orderOps.result')} defaultValue="REACHED">
              <option value="REACHED">{t('admin.orderOps.results.REACHED')}</option>
              <option value="NO_ANSWER">{t('admin.orderOps.results.NO_ANSWER')}</option>
              <option value="WRONG_NUMBER">{t('admin.orderOps.results.WRONG_NUMBER')}</option>
              <option value="CALLBACK_REQUESTED">
                {t('admin.orderOps.results.CALLBACK_REQUESTED')}
              </option>
              <option value="UNREACHABLE">{t('admin.orderOps.results.UNREACHABLE')}</option>
              <option value="OTHER">{t('admin.orderOps.results.OTHER')}</option>
            </SelectField>
            <FormField
              name="explanation"
              label={t('admin.orderOps.explanation')}
              maxLength={1000}
            />
            <Button type="submit" variant="admin">
              {t('admin.orderOps.recordContact')}
            </Button>
          </form>
        </section>
      </AdminWorkspacePanel>

      <AdminWorkspacePanel id="history" value={workspace}>
        <section className="admin-panel">
          <h2>{t('admin.orderOps.history')}</h2>
          <ol>
            {data.history.map((entry) => (
              <li key={entry.id}>
                <LocalDate value={entry.createdAt} /> —{' '}
                {entry.fromStatus
                  ? t(`admin.deliveryOps.statuses.${entry.fromStatus}`, {
                      defaultValue: entry.fromStatus,
                    })
                  : t('admin.orderOps.created')}{' '}
                →{' '}
                {t(`admin.deliveryOps.statuses.${entry.toStatus}`, {
                  defaultValue: entry.toStatus,
                })}
                {entry.note ? ` — ${entry.note}` : ''}
              </li>
            ))}
          </ol>
        </section>
      </AdminWorkspacePanel>
      {confirm.isError || cancel.isError || progress.isError || note.isError ? (
        <ErrorState compact />
      ) : null}
    </div>
  );
}
