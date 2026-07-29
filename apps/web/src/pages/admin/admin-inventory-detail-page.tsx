import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Boxes,
  ClipboardCheck,
  History,
  PackagePlus,
  Shuffle,
  SlidersHorizontal,
} from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { adminDataClient } from '../../api/admin-data-client';
import { ApiError } from '../../api/http';
import { useAdminAuth } from '../../auth/admin-auth-context';
import {
  AdminWorkspaceNav,
  AdminWorkspacePanel,
  type AdminWorkspaceItem,
} from '../../components/admin/admin-workspace';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { FormField, SelectField } from '../../components/ui/form-field';
import { LocalDate } from '../../components/ui/price';
import { invalidatePublicProductCaches } from './admin-product-cache';

type Operation = 'ADD' | 'REMOVE' | 'SET';
type Reason = 'PURCHASE_RECEIPT' | 'STOCK_COUNT_CORRECTION' | 'DAMAGE' | 'EXPIRY' | 'OTHER';
type InventoryWorkspace = 'receive' | 'manage' | 'history';

const stringValue = (value: FormDataEntryValue | null): string =>
  typeof value === 'string' ? value.trim() : '';

const inventoryErrorKeys: Record<string, string> = {
  RECENT_AUTHENTICATION_REQUIRED: 'admin.inventoryOps.errors.recentAuthenticationRequired',
  INVENTORY_LOCATION_CODE_CONFLICT: 'admin.inventoryOps.errors.locationCodeConflict',
  INVENTORY_BUCKET_CONFLICT: 'admin.inventoryOps.errors.bucketConflict',
  INVALID_BATCH_DATES: 'admin.inventoryOps.errors.invalidBatchDates',
  INVALID_BATCH_RECEIPT_REFERENCE: 'admin.inventoryOps.errors.invalidBatchReference',
  BATCH_METADATA_CONFLICT: 'admin.inventoryOps.errors.batchMetadataConflict',
  INVENTORY_RESERVED_QUANTITY_CONFLICT: 'admin.inventoryOps.errors.reservedQuantityConflict',
  INVENTORY_DUAL_CONTROL_REQUIRED: 'admin.inventoryOps.errors.dualControlRequired',
  VERSION_CONFLICT: 'admin.inventoryOps.errors.versionConflict',
  LOW_STOCK_THRESHOLD_UNCHANGED: 'admin.inventoryOps.thresholdUnchanged',
};

export function AdminInventoryDetailPage() {
  const { variantId = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAdminAuth();
  const canAdjust = Boolean(user?.permissions.includes('inventory.adjust'));
  const canApprove = Boolean(user?.permissions.includes('inventory.approve'));
  const canTransfer = Boolean(user?.permissions.includes('inventory.transfer'));
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [adjustmentOperation, setAdjustmentOperation] = useState<Operation>('ADD');
  const [movementItemId, setMovementItemId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<InventoryWorkspace>(canAdjust ? 'receive' : 'manage');
  const receiptRequest = useRef<{ signature: string; key: string } | null>(null);
  const transferRequest = useRef<{ signature: string; key: string } | null>(null);
  const variant = useQuery({
    queryKey: ['admin', 'inventory', 'variant', variantId],
    queryFn: () => adminDataClient.inventoryVariant(variantId),
    enabled: Boolean(variantId),
  });
  const locations = useQuery({
    queryKey: ['admin', 'inventory', 'locations'],
    queryFn: adminDataClient.inventoryLocations,
    enabled: canAdjust || canTransfer,
  });
  const adjustments = useQuery({
    queryKey: ['admin', 'inventory', 'adjustments', 'PENDING_APPROVAL'],
    queryFn: () => adminDataClient.inventoryAdjustments(),
  });
  const transfers = useQuery({
    queryKey: ['admin', 'inventory', 'transfers'],
    queryFn: adminDataClient.inventoryTransfers,
  });
  const movements = useQuery({
    queryKey: ['admin', 'inventory', 'movements', movementItemId],
    queryFn: () => adminDataClient.inventoryMovements(movementItemId!),
    enabled: Boolean(movementItemId),
  });
  const invalidate = () => {
    void variant.refetch();
    void queryClient.invalidateQueries({ queryKey: ['admin', 'inventory'] });
    void invalidatePublicProductCaches(queryClient);
  };
  const adjustment = useMutation({
    mutationFn: ({
      itemId,
      payload,
    }: {
      itemId: string;
      payload: Parameters<typeof adminDataClient.adjustInventory>[1];
    }) => adminDataClient.adjustInventory(itemId, payload),
    onSuccess: () => {
      setActiveItem(null);
      setFeedback(t('admin.inventoryOps.adjustmentPending'));
      void queryClient.invalidateQueries({ queryKey: ['admin', 'inventory', 'adjustments'] });
    },
  });
  const threshold = useMutation({
    mutationFn: (lowStockThreshold: number) =>
      adminDataClient.updateLowStockThreshold(variantId, {
        lowStockThreshold,
        expectedVersion: variant.data!.version,
      }),
    onSuccess: () => {
      setFeedback(t('admin.inventoryOps.thresholdUpdated'));
      invalidate();
    },
  });
  const createLocation = useMutation({
    mutationFn: (payload: Parameters<typeof adminDataClient.createInventoryLocation>[0]) =>
      adminDataClient.createInventoryLocation(payload),
    onSuccess: () => {
      setFeedback(t('admin.inventoryOps.locationCreated'));
      void queryClient.invalidateQueries({ queryKey: ['admin', 'inventory', 'locations'] });
    },
  });
  const createBucket = useMutation({
    mutationFn: (payload: Parameters<typeof adminDataClient.createInventoryItem>[0]) =>
      adminDataClient.createInventoryItem(payload),
    onSuccess: () => {
      setFeedback(t('admin.inventoryOps.bucketCreated'));
      invalidate();
    },
  });
  const receipt = useMutation({
    mutationFn: ({
      payload,
      key,
    }: {
      payload: Parameters<typeof adminDataClient.receiveInventoryBatch>[0];
      key: string;
    }) => adminDataClient.receiveInventoryBatch(payload, key),
    onSuccess: () => {
      receiptRequest.current = null;
      setFeedback(t('admin.inventoryOps.receiptRecorded'));
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['admin', 'inventory', 'movements'] });
    },
  });
  const decision = useMutation({
    mutationFn: ({
      id,
      value,
      reason,
    }: {
      id: string;
      value: 'APPROVE' | 'REJECT';
      reason?: string;
    }) => adminDataClient.decideInventoryAdjustment(id, value, reason),
    onSuccess: () => {
      setFeedback(t('admin.inventoryOps.decisionRecorded'));
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['admin', 'inventory', 'adjustments'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'inventory', 'movements'] });
    },
  });
  const transfer = useMutation({
    mutationFn: ({
      itemId,
      payload,
      key,
    }: {
      itemId: string;
      payload: Parameters<typeof adminDataClient.transferInventory>[1];
      key: string;
    }) => adminDataClient.transferInventory(itemId, payload, key),
    onSuccess: () => {
      transferRequest.current = null;
      setFeedback(t('admin.inventoryOps.transferRecorded'));
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['admin', 'inventory', 'transfers'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'inventory', 'movements'] });
    },
  });

  const idempotencyKey = (
    holder: { current: { signature: string; key: string } | null },
    payload: unknown,
  ) => {
    const signature = JSON.stringify(payload);
    if (holder.current?.signature === signature) return holder.current.key;
    const key = `admin-web-${globalThis.crypto.randomUUID()}`;
    holder.current = { signature, key };
    return key;
  };
  const submitAdjustment = (itemId: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!variant.data) return;
    const item = variant.data.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const form = new FormData(event.currentTarget);
    const operation = stringValue(form.get('operation')) as Operation;
    const reasonCode = stringValue(form.get('reasonCode')) as Reason;
    const rawAmount = Number(stringValue(form.get('amount')));
    const note = stringValue(form.get('note'));
    if (!Number.isInteger(rawAmount) || rawAmount < (operation === 'SET' ? 0 : 1)) return;
    adjustment.mutate({
      itemId,
      payload: {
        operation,
        ...(operation === 'SET' ? { targetOnHandQuantity: rawAmount } : { quantity: rawAmount }),
        reasonCode,
        ...(note ? { note } : {}),
        expectedVersion: item.version,
      },
    });
  };
  const submitThreshold = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(stringValue(new FormData(event.currentTarget).get('threshold')));
    if (!Number.isInteger(value) || value < 0) return;
    threshold.reset();
    if (value === variant.data?.lowStockThreshold) {
      setFeedback(t('admin.inventoryOps.thresholdUnchanged'));
      return;
    }
    threshold.mutate(value);
  };
  const submitLocation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const address = stringValue(form.get('address'));
    setFeedback(null);
    createLocation.mutate({
      code: stringValue(form.get('code')).toUpperCase(),
      name: stringValue(form.get('name')),
      ...(address ? { address } : {}),
    });
  };
  const submitBucket = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const note = stringValue(form.get('note'));
    setFeedback(null);
    createBucket.mutate({
      variantId,
      locationId: stringValue(form.get('locationId')),
      initialQuantity: 0,
      ...(note ? { note } : {}),
    });
  };
  const submitReceipt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const supplierReference = stringValue(form.get('supplierReference'));
    const manufacturedAt = stringValue(form.get('manufacturedAt'));
    const note = stringValue(form.get('note'));
    const payload = {
      variantId,
      locationId: stringValue(form.get('locationId')),
      batchNumber: stringValue(form.get('batchNumber')),
      expiryDate: stringValue(form.get('expiryDate')),
      quantity: Number(stringValue(form.get('quantity'))),
      ...(supplierReference ? { supplierReference } : {}),
      ...(manufacturedAt ? { manufacturedAt } : {}),
      ...(note ? { note } : {}),
    };
    receipt.mutate({ payload, key: idempotencyKey(receiptRequest, payload) });
  };
  const submitDecision = (id: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = stringValue(form.get('decision')) as 'APPROVE' | 'REJECT';
    const reason = stringValue(form.get('reason'));
    if (value === 'REJECT' && !reason) return;
    decision.mutate({ id, value, ...(reason ? { reason } : {}) });
  };
  const submitTransfer = (
    itemId: string,
    itemVersion: number,
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const note = stringValue(form.get('note'));
    const payload = {
      destinationLocationId: stringValue(form.get('destinationLocationId')),
      quantity: Number(stringValue(form.get('quantity'))),
      expectedSourceVersion: itemVersion,
      ...(note ? { note } : {}),
    };
    transfer.mutate({
      itemId,
      payload,
      key: idempotencyKey(transferRequest, { itemId, ...payload }),
    });
  };

  if (variant.isPending) return <LoadingState label={t('common.loading')} tone="admin" />;
  if (variant.isError) return <ErrorState onRetry={() => void variant.refetch()} />;
  const data = variant.data;
  const hasLocations = Boolean(locations.data?.length);
  const locationRequired = locations.isSuccess && !hasLocations;
  const errorMessage = (error: Error | null): string | null => {
    if (!error) return null;
    if (error instanceof ApiError) {
      const key = inventoryErrorKeys[error.code];
      return key ? t(key) : error.message;
    }
    return t('common.errorBody');
  };
  const mutationError = (error: Error | null) => {
    const message = errorMessage(error);
    return message ? (
      <p className="form-banner form-banner--error" role="alert">
        {message}
      </p>
    ) : null;
  };
  const workspaceItems: AdminWorkspaceItem<InventoryWorkspace>[] = [
    {
      id: 'receive',
      label: t('admin.ui.stockReceive'),
      description: t('admin.ui.stockReceiveHint'),
      icon: PackagePlus,
    },
    {
      id: 'manage',
      label: t('admin.ui.stockManage'),
      description: t('admin.ui.stockManageHint'),
      icon: Boxes,
    },
    {
      id: 'history',
      label: t('admin.ui.stockHistory'),
      description: t('admin.ui.stockHistoryHint'),
      icon: History,
    },
  ];
  return (
    <div className="admin-page">
      <Link className="back-link" to="/admin/inventory">
        <ArrowLeft aria-hidden="true" size={17} />
        {t('admin.inventory')}
      </Link>
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">{data.sku}</span>
          <h1>
            {data.productNameFr} / {data.nameFr}
          </h1>
          <p>{data.commitmentPolicy}</p>
        </div>
      </header>

      <section className="admin-stock-summary">
        <div className="admin-stock-summary__grid">
          <article>
            <span>{t('admin.columns.onHand')}</span>
            <strong>{data.onHandQuantity}</strong>
          </article>
          <article>
            <span>{t('admin.columns.reserved')}</span>
            <strong>{data.reservedQuantity}</strong>
          </article>
          <article>
            <span>{t('admin.columns.remaining')}</span>
            <strong>{data.availableQuantity}</strong>
          </article>
        </div>
      </section>

      {feedback ? (
        <p className="form-success" role="status">
          {feedback}
        </p>
      ) : null}

      <AdminWorkspaceNav
        label={t('admin.ui.workspaceLabel')}
        value={workspace}
        items={workspaceItems}
        onChange={setWorkspace}
      />

      <AdminWorkspacePanel id="receive" value={workspace}>
        {canAdjust ? (
          <>
            <section className="admin-panel">
              <h2>
                <SlidersHorizontal aria-hidden="true" size={18} />{' '}
                {t('admin.inventoryOps.lowStockThreshold')}
              </h2>
              <form onSubmit={submitThreshold} className="admin-heading-actions">
                <FormField
                  name="threshold"
                  type="number"
                  min={0}
                  label={t('admin.inventoryOps.threshold')}
                  defaultValue={data.lowStockThreshold}
                />
                <Button type="submit" variant="admin" loading={threshold.isPending}>
                  {t('admin.inventoryOps.updateThreshold')}
                </Button>
              </form>
              {mutationError(threshold.error)}
            </section>

            <section className="admin-panel">
              <h2>{t('admin.inventoryOps.locationAndBucket')}</h2>
              <form className="admin-form-grid" onSubmit={submitLocation}>
                <FormField name="code" label={t('admin.inventoryOps.locationCode')} required />
                <FormField name="name" label={t('admin.inventoryOps.locationName')} required />
                <FormField name="address" label={t('admin.inventoryOps.optionalAddress')} />
                <Button type="submit" variant="admin" loading={createLocation.isPending}>
                  {t('admin.inventoryOps.createLocation')}
                </Button>
              </form>
              {mutationError(createLocation.error)}
              {locationRequired ? (
                <p className="form-banner" role="note">
                  {t('admin.inventoryOps.locationRequired')}
                </p>
              ) : null}
              <form className="admin-form-grid" onSubmit={submitBucket}>
                <SelectField
                  name="locationId"
                  label={t('admin.inventoryOps.activeLocation')}
                  disabled={!hasLocations || createBucket.isPending}
                  required
                >
                  <option value="">—</option>
                  {locations.data?.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} · {location.name}
                    </option>
                  ))}
                </SelectField>
                <FormField
                  name="note"
                  label={t('admin.inventoryOps.bucketNote')}
                  maxLength={1000}
                />
                <Button
                  type="submit"
                  variant="admin"
                  loading={createBucket.isPending}
                  disabled={!hasLocations || createBucket.isPending}
                >
                  {t('admin.inventoryOps.createEmptyBucket')}
                </Button>
              </form>
              {mutationError(createBucket.error)}
              <p>{t('admin.inventoryOps.receiptRequiredHint')}</p>
            </section>

            <section className="admin-panel">
              <h2>
                <PackagePlus aria-hidden="true" size={18} /> {t('admin.inventoryOps.batchReceipt')}
              </h2>
              <form className="admin-form-grid" onSubmit={submitReceipt}>
                <SelectField
                  name="locationId"
                  label={t('admin.inventoryOps.activeLocation')}
                  disabled={!hasLocations || receipt.isPending}
                  required
                >
                  <option value="">—</option>
                  {locations.data?.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} · {location.name}
                    </option>
                  ))}
                </SelectField>
                <FormField
                  name="batchNumber"
                  label={t('admin.inventoryOps.batchNumber')}
                  required
                  maxLength={120}
                />
                <FormField
                  name="quantity"
                  label={t('admin.inventoryOps.quantity')}
                  type="number"
                  min={1}
                  required
                />
                <FormField
                  name="expiryDate"
                  label={t('admin.inventoryOps.expiryDate')}
                  type="date"
                  required
                />
                <FormField
                  name="manufacturedAt"
                  label={t('admin.inventoryOps.manufacturedAt')}
                  type="date"
                />
                <FormField
                  name="supplierReference"
                  label={t('admin.inventoryOps.supplierReference')}
                  hint={t('admin.inventoryOps.supplierReferenceHint')}
                  maxLength={160}
                />
                <FormField
                  name="note"
                  label={t('admin.inventoryOps.receiptNote')}
                  maxLength={1000}
                />
                <Button
                  type="submit"
                  variant="admin"
                  loading={receipt.isPending}
                  disabled={!hasLocations || receipt.isPending}
                >
                  {t('admin.inventoryOps.recordReceipt')}
                </Button>
              </form>
              {mutationError(receipt.error)}
            </section>
          </>
        ) : (
          <EmptyState title={t('admin.accessDenied')} />
        )}
      </AdminWorkspacePanel>

      <AdminWorkspacePanel id="manage" value={workspace}>
        <section className="admin-panel">
          <h2>
            <ClipboardCheck aria-hidden="true" size={18} /> {t('admin.inventoryOps.approvalQueue')}
          </h2>
          {adjustments.isPending ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
          {adjustments.data?.items.length === 0 ? (
            <p>{t('admin.inventoryOps.noPendingAdjustments')}</p>
          ) : null}
          {adjustments.data?.items.map((pending) => (
            <article className="admin-panel" key={pending.id}>
              <strong>
                {pending.inventoryItem.variant.sku} · {pending.inventoryItem.location.name}
              </strong>
              <p>
                {pending.onHandBefore} → {pending.proposedOnHandQuantity} (
                {pending.quantityDelta > 0 ? '+' : ''}
                {pending.quantityDelta}) ·{' '}
                {t(`admin.inventoryOps.reasons.${pending.reasonCode}`, {
                  defaultValue: pending.reasonCode,
                })}
              </p>
              <small>
                {t('admin.inventoryOps.expires')}{' '}
                <LocalDate value={pending.expiresAt ?? pending.requestedAt} />
              </small>
              {canApprove ? (
                <>
                  <form
                    className="admin-form-grid"
                    onSubmit={(event) => submitDecision(pending.id, event)}
                  >
                    <SelectField
                      name="decision"
                      label={t('admin.inventoryOps.decision')}
                      defaultValue="APPROVE"
                    >
                      <option value="APPROVE">{t('admin.inventoryOps.approve')}</option>
                      <option value="REJECT">{t('admin.inventoryOps.reject')}</option>
                    </SelectField>
                    <FormField
                      name="reason"
                      label={t('admin.inventoryOps.decisionReason')}
                      maxLength={500}
                    />
                    <Button
                      type="submit"
                      variant="admin"
                      loading={decision.isPending && decision.variables?.id === pending.id}
                      disabled={pending.requestedBy === user?.id}
                    >
                      {pending.requestedBy === user?.id
                        ? t('admin.inventoryOps.secondAdminRequired')
                        : t('admin.inventoryOps.recordDecision')}
                    </Button>
                  </form>
                  {decision.variables?.id === pending.id ? mutationError(decision.error) : null}
                </>
              ) : null}
            </article>
          ))}
        </section>

        <section className="admin-panel">
          <h2>
            <Boxes aria-hidden="true" size={18} /> {t('admin.inventoryOps.locationsAndLots')}
          </h2>
          {data.items.map((item) => (
            <article className="admin-panel" key={item.id}>
              <header className="admin-page__heading">
                <div>
                  <strong>
                    {item.location.name} · {item.batch?.batchNumber ?? item.lotKey}
                  </strong>
                  <p>
                    {t('admin.inventoryOps.itemQuantities', {
                      onHand: item.onHandQuantity,
                      reserved: item.reservedQuantity,
                      available: item.availableQuantity,
                    })}
                  </p>
                  <small>
                    <LocalDate value={item.updatedAt} />
                  </small>
                </div>
                <div className="admin-heading-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setMovementItemId((current) => (current === item.id ? null : item.id))
                    }
                  >
                    <History aria-hidden="true" size={16} />{' '}
                    {t('admin.inventoryOps.movementsTitle')}
                  </Button>
                  {canAdjust ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setActiveItem((current) => {
                          adjustment.reset();
                          setAdjustmentOperation('ADD');
                          return current === item.id ? null : item.id;
                        })
                      }
                    >
                      {t('admin.inventoryOps.requestAdjustment')}
                    </Button>
                  ) : null}
                </div>
              </header>
              {canAdjust && activeItem === item.id ? (
                <form onSubmit={(event) => submitAdjustment(item.id, event)}>
                  <div className="admin-form-grid">
                    <SelectField
                      name="operation"
                      label={t('admin.inventoryOps.operation')}
                      value={adjustmentOperation}
                      onChange={(event) => setAdjustmentOperation(event.target.value as Operation)}
                    >
                      <option value="ADD">{t('admin.inventoryOps.operations.ADD')}</option>
                      <option value="REMOVE">{t('admin.inventoryOps.operations.REMOVE')}</option>
                      <option value="SET">{t('admin.inventoryOps.operations.SET')}</option>
                    </SelectField>
                    <FormField
                      name="amount"
                      label={t('admin.inventoryOps.quantity')}
                      type="number"
                      min={adjustmentOperation === 'SET' ? 0 : 1}
                      required
                    />
                    <SelectField
                      name="reasonCode"
                      label={t('admin.inventoryOps.reason')}
                      defaultValue="STOCK_COUNT_CORRECTION"
                    >
                      <option value="STOCK_COUNT_CORRECTION">
                        {t('admin.inventoryOps.reasons.STOCK_COUNT_CORRECTION')}
                      </option>
                      <option value="DAMAGE">{t('admin.inventoryOps.reasons.DAMAGE')}</option>
                      <option value="EXPIRY">{t('admin.inventoryOps.reasons.EXPIRY')}</option>
                      <option value="OTHER">{t('admin.inventoryOps.reasons.OTHER')}</option>
                    </SelectField>
                    <FormField name="note" label={t('admin.inventoryOps.note')} maxLength={1000} />
                  </div>
                  <Button type="submit" variant="admin" loading={adjustment.isPending}>
                    {t('admin.inventoryOps.submitForApproval')}
                  </Button>
                  {mutationError(adjustment.error)}
                </form>
              ) : null}
              {canTransfer ? (
                <>
                  <form
                    className="admin-form-grid"
                    onSubmit={(event) => submitTransfer(item.id, item.version, event)}
                  >
                    <SelectField
                      name="destinationLocationId"
                      label={t('admin.inventoryOps.destinationLocation')}
                      required
                    >
                      <option value="">—</option>
                      {locations.data
                        ?.filter((location) => location.id !== item.location.id)
                        .map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.code} · {location.name}
                          </option>
                        ))}
                    </SelectField>
                    <FormField
                      name="quantity"
                      label={t('admin.inventoryOps.quantity')}
                      type="number"
                      min={1}
                      max={item.availableQuantity}
                      required
                    />
                    <FormField
                      name="note"
                      label={t('admin.inventoryOps.transferNote')}
                      maxLength={1000}
                    />
                    <Button type="submit" variant="admin" loading={transfer.isPending}>
                      <Shuffle aria-hidden="true" size={16} /> {t('admin.inventoryOps.transfer')}
                    </Button>
                  </form>
                  {transfer.variables?.itemId === item.id ? mutationError(transfer.error) : null}
                </>
              ) : null}
              {movementItemId === item.id ? (
                <div className="admin-table-wrap">
                  {movements.isPending ? (
                    <LoadingState label={t('common.loading')} tone="admin" />
                  ) : null}
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>{t('common.status')}</th>
                        <th>{t('admin.inventoryOps.delta')}</th>
                        <th>{t('admin.columns.onHand')}</th>
                        <th>{t('admin.inventoryOps.occurredAt')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.data?.items.map((movement) => (
                        <tr key={movement.id}>
                          <td>
                            {t(`admin.inventoryOps.movements.${movement.type}`, {
                              defaultValue: movement.type,
                            })}
                          </td>
                          <td>{movement.quantityDelta}</td>
                          <td>{movement.onHandAfter}</td>
                          <td>
                            <LocalDate value={movement.occurredAt} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      </AdminWorkspacePanel>
      <AdminWorkspacePanel id="history" value={workspace}>
        <section className="admin-panel">
          <h2>
            <Shuffle aria-hidden="true" size={18} /> {t('admin.inventoryOps.recentTransfers')}
          </h2>
          {transfers.data?.items.length === 0 ? <p>{t('admin.inventoryOps.noTransfers')}</p> : null}
          {transfers.data?.items.slice(0, 10).map((record) => (
            <p key={record.id}>
              {record.sourceInventoryItem.variant.sku} · {record.sourceInventoryItem.location.name}{' '}
              → {record.destinationInventoryItem.location.name} · {record.quantity} ·{' '}
              <LocalDate value={record.occurredAt} />
            </p>
          ))}
        </section>
      </AdminWorkspacePanel>
      {locations.isError || adjustments.isError || transfers.isError || movements.isError ? (
        <ErrorState
          compact
          onRetry={() => {
            void locations.refetch();
            void adjustments.refetch();
            void transfers.refetch();
            if (movementItemId) void movements.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
