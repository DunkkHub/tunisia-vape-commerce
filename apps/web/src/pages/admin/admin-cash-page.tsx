import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Banknote, Download, HandCoins, RefreshCw } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { adminDataClient } from '../../api/admin-data-client';
import { useAdminAuth } from '../../auth/admin-auth-context';
import {
  AdminWorkspaceNav,
  AdminWorkspacePanel,
  type AdminWorkspaceItem,
} from '../../components/admin/admin-workspace';
import { Button } from '../../components/ui/button';
import { ErrorState, LoadingState } from '../../components/ui/feedback';
import { FormField, SelectField } from '../../components/ui/form-field';
import { LocalDate, Price } from '../../components/ui/price';
import { downloadText } from '../../utils/download-text';

const text = (form: FormData, key: string): string => {
  const entry = form.get(key);
  return typeof entry === 'string' ? entry.trim() : '';
};

type CashWorkspace = 'collections' | 'remittances' | 'discrepancies';

export function AdminCashPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAdminAuth();
  const canReconcile = Boolean(user?.permissions.includes('cash.reconcile'));
  const canExport = Boolean(
    user?.permissions.includes('cash.read') && user.permissions.includes('reports.export'),
  );
  const [workspace, setWorkspace] = useState<CashWorkspace>('collections');
  const [exportMessage, setExportMessage] = useState('');
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [selectedRemittanceId, setSelectedRemittanceId] = useState('');
  const [collectionResolutionByDiscrepancy, setCollectionResolutionByDiscrepancy] = useState<
    Record<string, 'RESOLVED' | 'WRITTEN_OFF'>
  >({});
  const collectionIdempotency = useRef<{ collectionId: string; key: string } | null>(null);
  const collections = useQuery({
    queryKey: ['admin', 'cash', 'collections'],
    queryFn: adminDataClient.cashCollections,
  });
  const collection = useQuery({
    queryKey: ['admin', 'cash', 'collection', selectedCollectionId],
    queryFn: () => adminDataClient.cashCollection(selectedCollectionId),
    enabled: Boolean(selectedCollectionId),
  });
  const remittances = useQuery({
    queryKey: ['admin', 'cash', 'remittances'],
    queryFn: adminDataClient.cashRemittances,
  });
  const remittance = useQuery({
    queryKey: ['admin', 'cash', 'remittance', selectedRemittanceId],
    queryFn: () => adminDataClient.cashRemittance(selectedRemittanceId),
    enabled: Boolean(selectedRemittanceId),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'cash'] });
  };
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: refresh,
  });
  const exportCollections = useMutation({
    mutationFn: () => adminDataClient.downloadCashCollections(),
    onSuccess: (result) => {
      downloadText(result.content, result.filename, 'text/csv;charset=utf-8');
      setExportMessage(t('admin.cashOps.exportReadyRows', { count: result.rowCount ?? 0 }));
    },
  });
  const exportRemittances = useMutation({
    mutationFn: () => adminDataClient.downloadCashRemittances(),
    onSuccess: (result) => {
      downloadText(result.content, result.filename, 'text/csv;charset=utf-8');
      setExportMessage(t('admin.cashOps.exportReadyRows', { count: result.rowCount ?? 0 }));
    },
  });
  const record = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const currentCollection = collection.data;
    if (!currentCollection?.delivery?.version) return;
    const form = new FormData(event.currentTarget);
    const amount = Number(text(form, 'collectedMillimes'));
    const reason = text(form, 'reasonDetail');
    if (collectionIdempotency.current?.collectionId !== currentCollection.id) {
      collectionIdempotency.current = {
        collectionId: currentCollection.id,
        key: globalThis.crypto.randomUUID(),
      };
    }
    const key = collectionIdempotency.current.key;
    action.mutate(
      () => adminDataClient.recordCashCollection(currentCollection, amount, key, reason),
      {
        onSuccess: () => {
          collectionIdempotency.current = null;
        },
      },
    );
  };
  const createRemittance = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    action.mutate(() =>
      adminDataClient.createCashRemittance({
        courierId: text(form, 'courierId'),
        remittanceNumber: text(form, 'remittanceNumber'),
        declaredMillimes: Number(text(form, 'declaredMillimes')),
        collectionId: text(form, 'collectionId'),
        amountMillimes: Number(text(form, 'amountMillimes')),
      }),
    );
  };
  const workspaceItems: AdminWorkspaceItem<CashWorkspace>[] = [
    {
      id: 'collections',
      label: t('admin.ui.cashCollections'),
      description: t('admin.ui.cashCollectionsHint'),
      icon: Banknote,
    },
    {
      id: 'remittances',
      label: t('admin.ui.cashRemittances'),
      description: t('admin.ui.cashRemittancesHint'),
      icon: HandCoins,
    },
    {
      id: 'discrepancies',
      label: t('admin.ui.cashDiscrepancies'),
      description: t('admin.ui.cashDiscrepanciesHint'),
      icon: AlertTriangle,
    },
  ];

  return (
    <div className="admin-page">
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">COD</span>
          <h1>{t('admin.cash')}</h1>
          <p>{t('admin.cashOps.subtitle')}</p>
        </div>
        <Button type="button" variant="ghost" onClick={refresh}>
          <RefreshCw aria-hidden="true" size={18} /> {t('admin.refresh')}
        </Button>
      </header>
      {exportMessage ? (
        <p className="form-success" role="status">
          {exportMessage}
        </p>
      ) : null}
      <AdminWorkspaceNav
        label={t('admin.ui.workspaceLabel')}
        value={workspace}
        items={workspaceItems}
        onChange={setWorkspace}
      />
      <AdminWorkspacePanel id="collections" value={workspace}>
        <section className="admin-panel">
          <div className="admin-panel__heading">
            <h2>
              <Banknote aria-hidden="true" size={18} /> {t('admin.cashOps.collectionsTitle')}
            </h2>
            {canExport ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => exportCollections.mutate()}
                loading={exportCollections.isPending}
              >
                <Download aria-hidden="true" size={17} /> {t('admin.cashOps.exportCollections')}
              </Button>
            ) : null}
          </div>
          {collections.isPending ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('admin.columns.order')}</th>
                  <th>{t('admin.columns.courier')}</th>
                  <th>{t('admin.columns.expected')}</th>
                  <th>{t('admin.cashOps.collected')}</th>
                  <th>{t('admin.cashOps.accountable')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {collections.data?.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.orderNumber}</td>
                    <td>{item.courierName ?? '—'}</td>
                    <td>
                      <Price millimes={item.expectedMillimes} />
                    </td>
                    <td>
                      <Price millimes={item.collectedMillimes} />
                    </td>
                    <td>
                      {item.accountableMillimes === null ? (
                        '—'
                      ) : (
                        <Price millimes={item.accountableMillimes} />
                      )}
                      {item.discrepancyStatus ? (
                        <small>
                          {t(`admin.cashOps.statuses.${item.discrepancyStatus}`, {
                            defaultValue: item.discrepancyStatus,
                          })}
                          {item.adjustmentMillimes ? (
                            <>
                              {' · '}
                              {t('admin.cashOps.adjustment')}:{' '}
                              <Price millimes={item.adjustmentMillimes} />
                            </>
                          ) : null}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      {t(`admin.cashOps.statuses.${item.status}`, { defaultValue: item.status })}
                    </td>
                    <td>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setSelectedCollectionId(item.id)}
                      >
                        {t('common.details')}
                      </Button>
                    </td>
                  </tr>
                ))}
                {collections.data?.items.length === 0 ? (
                  <tr>
                    <td colSpan={7}>{t('admin.cashOps.noCollections')}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {collection.data && collection.data.status === 'EXPECTED' ? (
            <form className="admin-panel" onSubmit={record}>
              <h3>{collection.data.orderNumber}</h3>
              <FormField
                name="collectedMillimes"
                label={t('admin.cashOps.collectedMillimes')}
                type="number"
                min={0}
                defaultValue={collection.data.expectedMillimes}
                required
              />
              <FormField
                name="reasonDetail"
                label={t('admin.cashOps.differenceReason')}
                maxLength={1000}
              />
              <Button type="submit" variant="admin" loading={action.isPending}>
                {t('admin.cashOps.recordCollection')}
              </Button>
            </form>
          ) : null}
          {collection.data?.discrepancies
            .filter((item) => item.status === 'OPEN' || item.status === 'INVESTIGATING')
            .map((discrepancy) => {
              const resolution = collectionResolutionByDiscrepancy[discrepancy.id] ?? 'RESOLVED';
              const requiresSecondAdmin =
                discrepancy.openedByUserId === user?.id ||
                collection.data.collectedByUserId === user?.id;
              return (
                <form
                  className="admin-form-grid"
                  key={discrepancy.id}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const reasonDetail = text(form, 'reasonDetail');
                    const finalVerifiedMillimes = Number(text(form, 'finalVerifiedMillimes'));
                    action.mutate(() =>
                      adminDataClient.resolveCashDiscrepancy(
                        discrepancy.id,
                        resolution,
                        reasonDetail,
                        resolution === 'RESOLVED' ? finalVerifiedMillimes : undefined,
                      ),
                    );
                  }}
                >
                  <h3>{t('admin.cashOps.discrepancyTitle')}</h3>
                  <p>
                    {collection.data.orderNumber} &middot; {discrepancy.reasonCode ?? '—'} &middot;{' '}
                    <Price millimes={Math.abs(discrepancy.differenceMillimes)} />
                  </p>
                  <SelectField
                    name="resolution"
                    label={t('admin.cashOps.resolution')}
                    value={resolution}
                    onChange={(event) => {
                      const next = event.currentTarget.value as 'RESOLVED' | 'WRITTEN_OFF';
                      setCollectionResolutionByDiscrepancy((current) => ({
                        ...current,
                        [discrepancy.id]: next,
                      }));
                    }}
                  >
                    <option value="RESOLVED">{t('admin.cashOps.resolved')}</option>
                    <option value="WRITTEN_OFF">{t('admin.cashOps.writtenOff')}</option>
                  </SelectField>
                  <FormField
                    name="finalVerifiedMillimes"
                    label={t('admin.cashOps.finalVerified')}
                    type="number"
                    min={0}
                    defaultValue={collection.data.expectedMillimes}
                    disabled={resolution === 'WRITTEN_OFF'}
                    required={resolution === 'RESOLVED'}
                  />
                  <FormField
                    name="reasonDetail"
                    label={t('admin.cashOps.resolutionReason')}
                    minLength={4}
                    maxLength={1000}
                    required
                  />
                  <Button
                    type="submit"
                    variant="admin"
                    loading={action.isPending}
                    disabled={!canReconcile || requiresSecondAdmin}
                  >
                    {requiresSecondAdmin
                      ? t('admin.cashOps.secondAdminRequired')
                      : t('admin.cashOps.resolve')}
                  </Button>
                </form>
              );
            })}
        </section>
      </AdminWorkspacePanel>

      <AdminWorkspacePanel id="remittances" value={workspace}>
        <section className="admin-panel">
          <h2>{t('admin.cashOps.newRemittance')}</h2>
          <form className="admin-form-grid" onSubmit={createRemittance}>
            <FormField name="courierId" label={t('admin.cashOps.courierId')} required />
            <FormField
              name="remittanceNumber"
              label={t('admin.cashOps.remittanceNumber')}
              required
            />
            <SelectField name="collectionId" label={t('admin.cashOps.collection')} required>
              <option value="">—</option>
              {collections.data?.items
                .filter(
                  (item) => item.status === 'COLLECTED' || item.status === 'PARTIALLY_COLLECTED',
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.orderNumber}
                  </option>
                ))}
            </SelectField>
            <FormField
              name="amountMillimes"
              label={t('admin.cashOps.allocatedMillimes')}
              type="number"
              min={1}
              required
            />
            <FormField
              name="declaredMillimes"
              label={t('admin.cashOps.declaredMillimes')}
              type="number"
              min={1}
              required
            />
            <Button type="submit" variant="admin">
              {t('admin.cashOps.createDraft')}
            </Button>
          </form>
        </section>

        <section className="admin-panel">
          <div className="admin-panel__heading">
            <h2>{t('admin.cashOps.remittancesTitle')}</h2>
            {canExport ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => exportRemittances.mutate()}
                loading={exportRemittances.isPending}
              >
                <Download aria-hidden="true" size={17} /> {t('admin.cashOps.exportRemittances')}
              </Button>
            ) : null}
          </div>
          {remittances.data?.items.map((remittance) => (
            <article className="admin-panel" key={remittance.id}>
              <strong>{remittance.remittanceNumber}</strong> · {remittance.courierName} ·{' '}
              <Price millimes={remittance.declaredMillimes} /> ·{' '}
              {t(`admin.cashOps.statuses.${remittance.status}`, {
                defaultValue: remittance.status,
              })}
              {remittance.createdAt ? <LocalDate value={remittance.createdAt} /> : null}
              {remittance.status === 'DRAFT' ? (
                <Button
                  type="button"
                  variant="admin"
                  onClick={() =>
                    action.mutate(() => adminDataClient.submitCashRemittance(remittance.id))
                  }
                >
                  {t('admin.cashOps.submit')}
                </Button>
              ) : null}
              {remittance.status === 'SUBMITTED' || remittance.status === 'RECEIVED' ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const verified = Number(text(form, 'verifiedMillimes'));
                    const reason = text(form, 'reasonDetail');
                    action.mutate(() =>
                      adminDataClient.reconcileCashRemittance(remittance.id, verified, reason),
                    );
                  }}
                >
                  <FormField
                    name="verifiedMillimes"
                    label={t('admin.cashOps.verifiedMillimes')}
                    type="number"
                    min={0}
                    defaultValue={remittance.declaredMillimes}
                    required
                  />
                  <FormField name="reasonDetail" label={t('admin.cashOps.differenceReason')} />
                  <Button type="submit" variant="admin">
                    {t('admin.cashOps.reconcile')}
                  </Button>
                </form>
              ) : null}
              {remittance.status === 'DISCREPANCY' && canReconcile ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setSelectedRemittanceId(remittance.id);
                    setWorkspace('discrepancies');
                  }}
                >
                  {t('admin.cashOps.openDiscrepancy')}
                </Button>
              ) : null}
            </article>
          ))}
          {remittances.data?.items.length === 0 ? <p>{t('admin.cashOps.noRemittances')}</p> : null}
        </section>
      </AdminWorkspacePanel>
      <AdminWorkspacePanel id="discrepancies" value={workspace}>
        {remittance.data?.status === 'DISCREPANCY' ? (
          <section className="admin-panel">
            <h2>{t('admin.cashOps.discrepancyTitle')}</h2>
            <p>
              {remittance.data.remittanceNumber} · {t('admin.cashOps.declared')}{' '}
              <Price millimes={remittance.data.declaredMillimes} /> · {t('admin.cashOps.verified')}{' '}
              <Price millimes={remittance.data.verifiedMillimes ?? 0} />
            </p>
            {remittance.data.discrepancies
              .filter((item) => item.status === 'OPEN')
              .map((discrepancy) => (
                <form
                  className="admin-form-grid"
                  key={discrepancy.id}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const resolution = text(form, 'resolution') as 'RESOLVED' | 'WRITTEN_OFF';
                    const reasonDetail = text(form, 'reasonDetail');
                    const finalVerifiedMillimes = Number(text(form, 'finalVerifiedMillimes'));
                    action.mutate(() =>
                      adminDataClient.resolveCashDiscrepancy(
                        discrepancy.id,
                        resolution,
                        reasonDetail,
                        resolution === 'RESOLVED' ? finalVerifiedMillimes : undefined,
                      ),
                    );
                  }}
                >
                  <p>
                    {discrepancy.reasonCode} ·{' '}
                    <Price millimes={Math.abs(discrepancy.differenceMillimes)} />
                  </p>
                  <SelectField
                    name="resolution"
                    label={t('admin.cashOps.resolution')}
                    defaultValue="RESOLVED"
                  >
                    <option value="RESOLVED">{t('admin.cashOps.resolved')}</option>
                    <option value="WRITTEN_OFF">{t('admin.cashOps.writtenOff')}</option>
                  </SelectField>
                  <FormField
                    name="finalVerifiedMillimes"
                    label={t('admin.cashOps.finalVerified')}
                    type="number"
                    min={0}
                    defaultValue={remittance.data?.declaredMillimes ?? 0}
                    required
                  />
                  <FormField
                    name="reasonDetail"
                    label={t('admin.cashOps.resolutionReason')}
                    minLength={4}
                    maxLength={1000}
                    required
                  />
                  <Button
                    type="submit"
                    variant="admin"
                    loading={action.isPending}
                    disabled={discrepancy.openedByUserId === user?.id}
                  >
                    {discrepancy.openedByUserId === user?.id
                      ? t('admin.cashOps.secondAdminRequired')
                      : t('admin.cashOps.resolve')}
                  </Button>
                </form>
              ))}
          </section>
        ) : (
          <section className="admin-panel admin-empty-workspace">
            <AlertTriangle aria-hidden="true" size={22} />
            <p>{t('admin.cashOps.noRemittances')}</p>
          </section>
        )}
      </AdminWorkspacePanel>
      {collections.isError ||
      collection.isError ||
      remittances.isError ||
      remittance.isError ||
      action.isError ||
      exportCollections.isError ||
      exportRemittances.isError ? (
        <ErrorState compact />
      ) : null}
    </div>
  );
}
