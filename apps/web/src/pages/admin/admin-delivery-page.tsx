import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck,
  Download,
  FileCheck2,
  FileUp,
  MapPinned,
  Plus,
  RefreshCw,
  Route,
  Truck,
  Users,
} from 'lucide-react';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { adminDataClient } from '../../api/admin-data-client';
import type {
  AdminCourierStatus,
  AdminCsvDownload,
  AdminDeliveryManifestStatus,
  AdminDeliveryStatusImportResult,
} from '../../api/types';
import { useAdminAuth } from '../../auth/admin-auth-context';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { CheckboxField, FormField, SelectField } from '../../components/ui/form-field';
import { LocalDate, Price } from '../../components/ui/price';

const deliveryStatuses = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'ON_HOLD',
  'PREPARING',
  'READY_FOR_PICKUP',
  'ASSIGNED_TO_COURIER',
  'HANDED_TO_COURIER',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERY_ATTEMPTED',
  'RESCHEDULED',
  'DELIVERED',
  'REFUSED',
  'FAILED',
  'RETURN_TO_SENDER',
  'RETURNED',
  'CANCELLED',
] as const;

const operationalDeliveryTargets = [
  'ON_HOLD',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'ASSIGNED_TO_COURIER',
  'HANDED_TO_COURIER',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'RETURN_TO_SENDER',
] as const;

const manifestTargets: Record<AdminDeliveryManifestStatus, AdminDeliveryManifestStatus[]> = {
  DRAFT: ['SEALED', 'CANCELLED'],
  SEALED: ['HANDED_OVER', 'CANCELLED'],
  HANDED_OVER: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

const textEntry = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

const optionalText = (form: FormData, key: string): string | undefined => {
  const value = textEntry(form, key);
  return value || undefined;
};

const downloadCsv = ({ content, filename }: AdminCsvDownload): void => {
  const objectUrl = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
};

const isoDateTime = (value: string): string | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

interface OperationInput {
  run: () => Promise<unknown>;
  success: string;
  after?: () => void;
}

interface ExportInput {
  run: () => Promise<AdminCsvDownload>;
  success: string;
}

export function AdminDeliveryPage() {
  const { t } = useTranslation();
  const { user } = useAdminAuth();
  const queryClient = useQueryClient();
  const canAssign = Boolean(user?.permissions.includes('deliveries.assign'));
  const canUpdate = Boolean(user?.permissions.includes('deliveries.update'));
  const canExport = Boolean(user?.permissions.includes('reports.export'));
  const hasRecentAuthentication = !user?.requiresRecentAuthentication;
  const canAssignSensitive = canAssign && hasRecentAuthentication;
  const canUpdateSensitive = canUpdate && hasRecentAuthentication;
  const canExportSensitive = canExport && hasRecentAuthentication;
  const [selectedDeliveryId, setSelectedDeliveryId] = useState('');
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<string[]>([]);
  const [selectedManifestId, setSelectedManifestId] = useState('');
  const [manifestTarget, setManifestTarget] = useState('');
  const [feedback, setFeedback] = useState('');
  const [importKey, setImportKey] = useState(() => `delivery-${Date.now().toString(36)}`);
  const [importCsv, setImportCsv] = useState('');
  const [importFilename, setImportFilename] = useState('');
  const [fileError, setFileError] = useState('');
  const [applyConfirmed, setApplyConfirmed] = useState(false);
  const [importResult, setImportResult] = useState<AdminDeliveryStatusImportResult | null>(null);
  const [dryRunApproval, setDryRunApproval] = useState<{ importKey: string; csv: string } | null>(
    null,
  );

  const deliveries = useQuery({
    queryKey: ['admin', 'deliveries', 'page=1&limit=20'],
    queryFn: () => adminDataClient.list('deliveries', 'page=1&limit=20'),
  });
  const zones = useQuery({
    queryKey: ['admin', 'delivery-config', 'zones'],
    queryFn: adminDataClient.deliveryZones,
  });
  const rates = useQuery({
    queryKey: ['admin', 'delivery-config', 'rates'],
    queryFn: adminDataClient.deliveryRates,
  });
  const pickups = useQuery({
    queryKey: ['admin', 'delivery-config', 'pickups'],
    queryFn: adminDataClient.pickupLocations,
  });
  const delivery = useQuery({
    queryKey: ['admin', 'delivery', selectedDeliveryId],
    queryFn: () => adminDataClient.delivery(selectedDeliveryId),
    enabled: Boolean(selectedDeliveryId),
  });
  const couriers = useQuery({
    queryKey: ['admin', 'delivery', 'couriers'],
    queryFn: adminDataClient.couriers,
  });
  const courierRecords = useQuery({
    queryKey: ['admin', 'delivery-operations', 'couriers'],
    queryFn: () => adminDataClient.courierRecords(),
  });
  const manifests = useQuery({
    queryKey: ['admin', 'delivery-operations', 'manifests'],
    queryFn: () => adminDataClient.deliveryManifests(),
  });
  const manifest = useQuery({
    queryKey: ['admin', 'delivery-operations', 'manifest', selectedManifestId],
    queryFn: () => adminDataClient.deliveryManifest(selectedManifestId),
    enabled: Boolean(selectedManifestId),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'delivery-config'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'deliveries'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'delivery'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'delivery-operations'] }),
    ]);
  };

  const action = useMutation({
    mutationFn: ({ run }: OperationInput) => run(),
    onMutate: () => {
      setFeedback('');
    },
    onSuccess: (_result, variables) => {
      variables.after?.();
      setFeedback(variables.success);
      void refresh();
    },
  });
  const exportAction = useMutation({
    mutationFn: ({ run }: ExportInput) => run(),
    onMutate: () => {
      setFeedback('');
    },
    onSuccess: (result, variables) => {
      downloadCsv(result);
      setFeedback(
        result.rowCount === null
          ? variables.success
          : t('admin.deliveryOps.exportDownloadedRows', { count: result.rowCount }),
      );
    },
  });
  const importAction = useMutation({
    mutationFn: (input: { importKey: string; dryRun: boolean; csv: string }) =>
      adminDataClient.importDeliveryStatuses(input),
    onMutate: () => {
      setFeedback('');
      setImportResult(null);
    },
    onSuccess: (result, input) => {
      setImportResult(result);
      if (input.dryRun && result.valid) {
        setDryRunApproval({ importKey: input.importKey, csv: input.csv });
        setFeedback(t('admin.deliveryOps.dryRunValid'));
      } else if (input.dryRun) {
        setDryRunApproval(null);
        setFeedback(t('admin.deliveryOps.dryRunInvalid'));
      } else if (result.applied) {
        setDryRunApproval(null);
        setApplyConfirmed(false);
        setFeedback(t('admin.deliveryOps.importApplied', { count: result.appliedCount }));
      }
      void refresh();
    },
  });

  const createZone = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    action.mutate({
      run: () =>
        adminDataClient.createDeliveryZone({
          code: textEntry(form, 'code'),
          nameFr: textEntry(form, 'nameFr'),
          nameAr: textEntry(form, 'nameAr'),
        }),
      success: t('admin.deliveryOps.zoneCreated'),
      after: () => element.reset(),
    });
  };
  const linkLocality = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const zone = zones.data?.items.find((item) => item.id === textEntry(form, 'zoneId'));
    const localityId = textEntry(form, 'localityId');
    if (zone && localityId) {
      action.mutate({
        run: () => adminDataClient.linkDeliveryZoneLocality(zone, localityId, true),
        success: t('admin.deliveryOps.localityLinked'),
        after: () => element.reset(),
      });
    }
  };
  const createRate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    action.mutate({
      run: () =>
        adminDataClient.createDeliveryRate({
          deliveryZoneId: textEntry(form, 'deliveryZoneId'),
          name: textEntry(form, 'name'),
          feeMillimes: Number(textEntry(form, 'feeMillimes')),
        }),
      success: t('admin.deliveryOps.rateCreated'),
      after: () => element.reset(),
    });
  };
  const createPickup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    action.mutate({
      run: () =>
        adminDataClient.createPickupLocation({
          code: textEntry(form, 'code'),
          nameFr: textEntry(form, 'nameFr'),
          nameAr: textEntry(form, 'nameAr'),
          address: textEntry(form, 'address'),
        }),
      success: t('admin.deliveryOps.pickupCreated'),
      after: () => element.reset(),
    });
  };
  const createCourier = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const contactName = optionalText(form, 'contactName');
    const phoneE164 = optionalText(form, 'phoneE164');
    const email = optionalText(form, 'email');
    const notes = optionalText(form, 'notes');
    action.mutate({
      run: () =>
        adminDataClient.createCourierRecord({
          code: textEntry(form, 'code'),
          name: textEntry(form, 'name'),
          ...(contactName ? { contactName } : {}),
          ...(phoneE164 ? { phoneE164 } : {}),
          ...(email ? { email } : {}),
          ...(notes ? { notes } : {}),
        }),
      success: t('admin.deliveryOps.courierCreated'),
      after: () => element.reset(),
    });
  };
  const createManifest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const courierId = textEntry(form, 'courierId');
    const manifestDate = textEntry(form, 'manifestDate');
    if (!courierId || selectedDeliveryIds.length === 0) return;
    action.mutate({
      run: async () => {
        const details = await Promise.all(
          selectedDeliveryIds.map((id) => adminDataClient.delivery(id)),
        );
        const created = await adminDataClient.createDeliveryManifest({
          courierId,
          manifestDate,
          deliveries: details.map((item) => ({
            deliveryId: item.id,
            expectedVersion: item.version,
          })),
        });
        setSelectedManifestId(created.id);
        return created;
      },
      success: t('admin.deliveryOps.manifestCreated'),
      after: () => {
        element.reset();
        setSelectedDeliveryIds([]);
      },
    });
  };

  const onCsvFile = async (event: ChangeEvent<HTMLInputElement>) => {
    setFileError('');
    setImportCsv('');
    setImportFilename('');
    setImportResult(null);
    setDryRunApproval(null);
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!file.name.toLocaleLowerCase('en-US').endsWith('.csv') || file.size > 250_000) {
      setFileError(t('admin.deliveryOps.fileInvalid'));
      event.currentTarget.value = '';
      return;
    }
    try {
      const csv = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (!csv || csv.includes('\0')) throw new Error('INVALID_CSV');
      setImportCsv(csv);
      setImportFilename(file.name);
    } catch {
      setFileError(t('admin.deliveryOps.fileInvalid'));
      event.currentTarget.value = '';
    }
  };

  const submitImport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const dryRun = submitter?.value !== 'apply';
    if (!importCsv || importKey.length < 8) return;
    if (
      !dryRun &&
      (!applyConfirmed ||
        dryRunApproval?.csv !== importCsv ||
        dryRunApproval.importKey !== importKey)
    ) {
      setFileError(t('admin.deliveryOps.applyNeedsDryRun'));
      return;
    }
    setFileError('');
    importAction.mutate({ importKey, dryRun, csv: importCsv });
  };

  const submitStatusExport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = new URLSearchParams({ limit: '500' });
    const status = optionalText(form, 'status');
    const courierId = optionalText(form, 'courierId');
    const from = isoDateTime(textEntry(form, 'from'));
    const to = isoDateTime(textEntry(form, 'to'));
    if (status) query.set('status', status);
    if (courierId) query.set('courierId', courierId);
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    exportAction.mutate({
      run: () => adminDataClient.downloadDeliveryStatuses(query.toString()),
      success: t('admin.deliveryOps.exportDownloaded'),
    });
  };

  const allQueries = [
    deliveries,
    zones,
    rates,
    pickups,
    delivery,
    couriers,
    courierRecords,
    manifests,
    manifest,
  ];
  const hasError =
    allQueries.some((query) => query.isError) ||
    action.isError ||
    exportAction.isError ||
    importAction.isError;
  const currentError = action.error ?? exportAction.error ?? importAction.error;
  const loading = zones.isPending || rates.isPending || pickups.isPending;
  const importCanApply =
    canUpdateSensitive &&
    applyConfirmed &&
    dryRunApproval?.importKey === importKey &&
    dryRunApproval.csv === importCsv;

  return (
    <div className="admin-page admin-delivery-ops">
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">{t('brand.adminShort')}</span>
          <h1>{t('admin.delivery')}</h1>
          <p>{t('admin.deliveryOps.subtitle')}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          disabled={allQueries.some((query) => query.isFetching) || action.isPending}
          onClick={() => void refresh()}
        >
          <RefreshCw aria-hidden="true" size={18} /> {t('admin.refresh')}
        </Button>
      </header>

      {feedback ? (
        <p className="form-banner form-banner--success" role="status">
          {feedback}
        </p>
      ) : null}
      {!canAssign && !canUpdate ? (
        <p className="form-banner" role="note">
          {t('admin.deliveryOps.readOnlyPermission')}
        </p>
      ) : null}
      {!hasRecentAuthentication && (canAssign || canUpdate) ? (
        <p className="form-banner" role="note">
          {t('admin.deliveryOps.recentAuthenticationRequired')}
        </p>
      ) : null}
      {currentError ? (
        <p className="form-banner form-banner--error" role="alert">
          {currentError.message}
        </p>
      ) : null}

      <div className="admin-stock-sections">
        <section className="admin-panel">
          <h2>
            <Truck aria-hidden="true" size={18} /> {t('admin.deliveryOps.inProgressTitle')}
          </h2>
          <p>{t('admin.deliveryOps.inProgressBody')}</p>
          {deliveries.isPending ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
          {deliveries.data?.items.length === 0 ? (
            <EmptyState title={t('admin.deliveryOps.noDeliveries')} />
          ) : null}
          {deliveries.data?.items.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t('admin.deliveryOps.manifestSelection')}</th>
                    <th>{t('admin.deliveryOps.orderTracking')}</th>
                    <th>{t('admin.deliveryOps.zone')}</th>
                    <th>{t('admin.deliveryOps.courier')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.data.items.map((item) => {
                    const trackingNumber =
                      typeof item.trackingNumber === 'string' ? item.trackingNumber : item.id;
                    const status = typeof item.status === 'string' ? item.status : '';
                    const selectable = status === 'ASSIGNED_TO_COURIER' && canAssignSensitive;
                    return (
                      <tr key={item.id}>
                        <td>
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              disabled={!selectable || action.isPending}
                              checked={selectedDeliveryIds.includes(item.id)}
                              onChange={(event) =>
                                setSelectedDeliveryIds((current) =>
                                  event.target.checked
                                    ? [...current, item.id]
                                    : current.filter((id) => id !== item.id),
                                )
                              }
                            />
                            <span className="sr-only">
                              {t('admin.deliveryOps.selectDelivery', { id: trackingNumber })}
                            </span>
                          </label>
                        </td>
                        <td>{trackingNumber}</td>
                        <td>{typeof item.zoneName === 'string' ? item.zoneName : '—'}</td>
                        <td>{typeof item.courierName === 'string' ? item.courierName : '—'}</td>
                        <td>
                          {t(`admin.deliveryOps.statuses.${status}`, { defaultValue: status })}
                        </td>
                        <td>
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={delivery.isFetching}
                            onClick={() => setSelectedDeliveryId(item.id)}
                          >
                            {t('admin.deliveryOps.manage')}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        {delivery.isPending && selectedDeliveryId ? (
          <LoadingState label={t('common.loading')} tone="admin" />
        ) : null}
        {delivery.data ? (
          <section className="admin-panel">
            <h2>
              {delivery.data.orderNumber} ·{' '}
              {t(`admin.deliveryOps.statuses.${delivery.data.status}`, {
                defaultValue: delivery.data.status,
              })}
            </h2>
            <p>
              {t('admin.deliveryOps.expectedCod')}:{' '}
              <Price millimes={delivery.data.expectedCodMillimes} /> ·{' '}
              {t('admin.deliveryOps.payment')}:{' '}
              {t(`account.paymentStatuses.${delivery.data.paymentStatus}`, {
                defaultValue: delivery.data.paymentStatus,
              })}
            </p>
            <form
              className="admin-form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                const courierId = textEntry(new FormData(event.currentTarget), 'courierId');
                if (courierId) {
                  action.mutate({
                    run: () => adminDataClient.assignDelivery(delivery.data, courierId),
                    success: t('admin.deliveryOps.deliveryAssigned'),
                  });
                }
              }}
            >
              <SelectField
                name="courierId"
                label={t('admin.deliveryOps.activeCourier')}
                disabled={!canAssign || action.isPending}
                required
              >
                <option value="">—</option>
                {couriers.data?.map((courier) => (
                  <option key={courier.id} value={courier.id}>
                    {courier.code} · {courier.name}
                  </option>
                ))}
              </SelectField>
              <Button
                type="submit"
                variant="admin"
                loading={action.isPending}
                disabled={!canAssign || action.isPending}
              >
                {t('admin.deliveryOps.assign')}
              </Button>
            </form>
            <form
              className="admin-form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const target = textEntry(form, 'targetStatus');
                if (target) {
                  action.mutate({
                    run: () =>
                      adminDataClient.transitionDelivery(
                        delivery.data,
                        target,
                        optionalText(form, 'explanation'),
                      ),
                    success: t('admin.deliveryOps.deliveryTransitioned'),
                  });
                }
              }}
            >
              <SelectField
                name="targetStatus"
                label={t('admin.deliveryOps.operationalTransition')}
                disabled={!canUpdate || action.isPending}
                required
              >
                <option value="">—</option>
                {operationalDeliveryTargets.map((status) => (
                  <option key={status} value={status}>
                    {t(`admin.deliveryOps.statuses.${status}`)}
                  </option>
                ))}
              </SelectField>
              <FormField
                name="explanation"
                label={t('admin.deliveryOps.explanation')}
                maxLength={1000}
                disabled={!canUpdate || action.isPending}
              />
              <Button
                type="submit"
                variant="admin"
                loading={action.isPending}
                disabled={!canUpdate || action.isPending}
              >
                {t('admin.deliveryOps.applyTransition')}
              </Button>
            </form>
            <form
              className="admin-form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const outcome = textEntry(form, 'outcome');
                if (outcome) {
                  action.mutate({
                    run: () =>
                      adminDataClient.recordDeliveryAttempt(
                        delivery.data,
                        outcome,
                        textEntry(form, 'explanation'),
                      ),
                    success: t('admin.deliveryOps.attemptRecorded'),
                  });
                }
              }}
            >
              <SelectField
                name="outcome"
                label={t('admin.deliveryOps.attemptOutcome')}
                disabled={!canUpdate || action.isPending}
                required
              >
                {[
                  'CUSTOMER_UNAVAILABLE',
                  'ADDRESS_NOT_FOUND',
                  'CUSTOMER_REFUSED',
                  'FAILED_AGE_VERIFICATION',
                  'PARTIAL_CASH_NOT_ALLOWED',
                  'RESCHEDULED',
                  'OTHER_FAILED',
                ].map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {t(`admin.deliveryOps.outcomes.${outcome}`)}
                  </option>
                ))}
              </SelectField>
              <FormField
                name="explanation"
                label={t('admin.deliveryOps.explanation')}
                maxLength={1000}
                disabled={!canUpdate || action.isPending}
              />
              <Button
                type="submit"
                variant="admin"
                loading={action.isPending}
                disabled={!canUpdate || action.isPending}
              >
                {t('admin.deliveryOps.recordAttempt')}
              </Button>
            </form>
            <Button
              type="button"
              variant="admin"
              loading={action.isPending}
              disabled={
                !canUpdateSensitive ||
                action.isPending ||
                (delivery.data.paymentStatus !== 'CASH_COLLECTED_BY_COURIER' &&
                  delivery.data.paymentStatus !== 'CASH_COLLECTED_AT_STORE')
              }
              onClick={() =>
                action.mutate({
                  run: () =>
                    adminDataClient.completeDelivery(
                      delivery.data,
                      delivery.data.ageVerificationRequired ? 'PASSED' : 'NOT_REQUIRED',
                    ),
                  success: t('admin.deliveryOps.deliveryCompleted'),
                })
              }
            >
              {t('admin.deliveryOps.completeDelivery')}
            </Button>
          </section>
        ) : null}

        <section className="admin-panel">
          <h2>
            <Users aria-hidden="true" size={18} /> {t('admin.deliveryOps.couriersTitle')}
          </h2>
          <p>{t('admin.deliveryOps.couriersBody')}</p>
          <form className="admin-form-grid" onSubmit={createCourier}>
            <FormField
              name="code"
              label={t('admin.deliveryOps.code')}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]+"
              minLength={2}
              maxLength={80}
              disabled={!canUpdateSensitive || action.isPending}
              required
            />
            <FormField
              name="name"
              label={t('admin.deliveryOps.courierName')}
              minLength={2}
              maxLength={200}
              disabled={!canUpdateSensitive || action.isPending}
              required
            />
            <FormField
              name="contactName"
              label={t('admin.deliveryOps.contactName')}
              maxLength={160}
              disabled={!canUpdateSensitive || action.isPending}
            />
            <FormField
              name="phoneE164"
              label={t('admin.deliveryOps.phoneE164')}
              placeholder="+21612345678"
              pattern="\+[1-9][0-9]{7,14}"
              disabled={!canUpdateSensitive || action.isPending}
            />
            <FormField
              name="email"
              type="email"
              label={t('admin.deliveryOps.email')}
              maxLength={320}
              disabled={!canUpdateSensitive || action.isPending}
            />
            <FormField
              name="notes"
              label={t('admin.deliveryOps.notes')}
              maxLength={1000}
              disabled={!canUpdateSensitive || action.isPending}
            />
            <Button
              type="submit"
              variant="admin"
              loading={action.isPending}
              disabled={!canUpdateSensitive || action.isPending}
            >
              <Plus aria-hidden="true" size={17} /> {t('admin.deliveryOps.createCourier')}
            </Button>
          </form>
          {courierRecords.isPending ? (
            <LoadingState label={t('common.loading')} tone="admin" />
          ) : null}
          {courierRecords.data?.items.length === 0 ? (
            <EmptyState title={t('admin.deliveryOps.noCouriers')} />
          ) : null}
          {courierRecords.data?.items.map((courier) => {
            const externallyManaged = courier.integrations.some(
              (integration) => integration.type !== 'MANUAL',
            );
            const targets: AdminCourierStatus[] =
              courier.status === 'ACTIVE'
                ? ['SUSPENDED', 'ARCHIVED']
                : courier.status === 'SUSPENDED'
                  ? ['ACTIVE', 'ARCHIVED']
                  : ['ACTIVE'];
            return (
              <article className="admin-panel" key={courier.id}>
                <h3>
                  {courier.code} · {courier.name}
                </h3>
                <p>
                  {t(`admin.deliveryOps.statuses.${courier.status}`)} ·{' '}
                  {t('admin.deliveryOps.courierCounts', {
                    deliveries: courier.deliveryCount,
                    manifests: courier.manifestCount,
                  })}
                </p>
                {courier.contactName || courier.phoneE164 || courier.email ? (
                  <p>
                    {[courier.contactName, courier.phoneE164, courier.email]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                ) : null}
                {externallyManaged ? <p>{t('admin.deliveryOps.externallyManaged')}</p> : null}
                <div className="admin-heading-actions">
                  {targets.map((status) => (
                    <Button
                      type="button"
                      variant={status === 'ARCHIVED' ? 'danger' : 'ghost'}
                      key={status}
                      loading={action.isPending}
                      disabled={!canUpdateSensitive || externallyManaged || action.isPending}
                      onClick={() =>
                        action.mutate({
                          run: () => adminDataClient.updateCourierStatus(courier, status),
                          success: t('admin.deliveryOps.courierUpdated'),
                        })
                      }
                    >
                      {t(`admin.deliveryOps.courierActions.${status}`)}
                    </Button>
                  ))}
                </div>
              </article>
            );
          })}
        </section>

        <section className="admin-panel">
          <h2>
            <ClipboardCheck aria-hidden="true" size={18} /> {t('admin.deliveryOps.manifestsTitle')}
          </h2>
          <p>{t('admin.deliveryOps.manifestsBody')}</p>
          <form className="admin-form-grid" onSubmit={createManifest}>
            <SelectField
              name="courierId"
              label={t('admin.deliveryOps.activeCourier')}
              disabled={!canAssignSensitive || action.isPending}
              required
            >
              <option value="">—</option>
              {couriers.data?.map((courier) => (
                <option key={courier.id} value={courier.id}>
                  {courier.code} · {courier.name}
                </option>
              ))}
            </SelectField>
            <FormField
              name="manifestDate"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              label={t('admin.deliveryOps.manifestDate')}
              disabled={!canAssignSensitive || action.isPending}
              required
            />
            <p role="status">
              {t('admin.deliveryOps.selectedDeliveries', { count: selectedDeliveryIds.length })}
            </p>
            <Button
              type="submit"
              variant="admin"
              loading={action.isPending}
              disabled={!canAssignSensitive || selectedDeliveryIds.length === 0 || action.isPending}
            >
              {t('admin.deliveryOps.createManifest')}
            </Button>
          </form>
          {manifests.isPending ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
          {manifests.data?.items.length === 0 ? (
            <EmptyState title={t('admin.deliveryOps.noManifests')} />
          ) : null}
          {manifests.data?.items.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t('admin.deliveryOps.manifestNumber')}</th>
                    <th>{t('admin.deliveryOps.manifestDate')}</th>
                    <th>{t('admin.deliveryOps.courier')}</th>
                    <th>{t('admin.deliveryOps.itemCount')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {manifests.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.manifestNumber}</td>
                      <td>
                        <LocalDate value={`${item.manifestDate}T00:00:00.000Z`} />
                      </td>
                      <td>{item.courier.name}</td>
                      <td>{item.itemCount}</td>
                      <td>{t(`admin.deliveryOps.statuses.${item.status}`)}</td>
                      <td>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={manifest.isFetching}
                          onClick={() => {
                            setManifestTarget('');
                            setSelectedManifestId(item.id);
                          }}
                        >
                          {t('common.details')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        {manifest.isPending && selectedManifestId ? (
          <LoadingState label={t('common.loading')} tone="admin" />
        ) : null}
        {manifest.data ? (
          <section className="admin-panel" aria-labelledby="delivery-manifest-detail-title">
            <h2 id="delivery-manifest-detail-title">
              {manifest.data.manifestNumber} ·{' '}
              {t(`admin.deliveryOps.statuses.${manifest.data.status}`)}
            </h2>
            <p>
              {manifest.data.courier.code} · {manifest.data.courier.name} ·{' '}
              {t('admin.deliveryOps.selectedDeliveries', { count: manifest.data.itemCount })}
            </p>
            <div className="admin-heading-actions">
              <Button
                type="button"
                variant="ghost"
                loading={exportAction.isPending}
                disabled={!canExportSensitive || exportAction.isPending}
                onClick={() =>
                  exportAction.mutate({
                    run: () => adminDataClient.downloadDeliveryManifest(manifest.data.id),
                    success: t('admin.deliveryOps.exportDownloaded'),
                  })
                }
              >
                <Download aria-hidden="true" size={17} /> {t('admin.deliveryOps.downloadManifest')}
              </Button>
            </div>
            {manifestTargets[manifest.data.status].length ? (
              <form
                className="admin-form-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  if (!manifestTarget) return;
                  action.mutate({
                    run: () =>
                      adminDataClient.transitionDeliveryManifest(
                        manifest.data,
                        manifestTarget as Exclude<AdminDeliveryManifestStatus, 'DRAFT'>,
                        optionalText(form, 'reason'),
                      ),
                    success: t('admin.deliveryOps.manifestTransitioned'),
                    after: () => setManifestTarget(''),
                  });
                }}
              >
                <SelectField
                  name="manifestTarget"
                  label={t('admin.deliveryOps.manifestTransition')}
                  value={manifestTarget}
                  disabled={!canUpdateSensitive || action.isPending}
                  onChange={(event) => setManifestTarget(event.target.value)}
                  required
                >
                  <option value="">—</option>
                  {manifestTargets[manifest.data.status].map((status) => (
                    <option value={status} key={status}>
                      {t(`admin.deliveryOps.manifestActions.${status}`)}
                    </option>
                  ))}
                </SelectField>
                <FormField
                  name="reason"
                  label={t('admin.deliveryOps.cancellationReason')}
                  minLength={manifestTarget === 'CANCELLED' ? 4 : undefined}
                  maxLength={1000}
                  disabled={!canUpdateSensitive || action.isPending}
                  required={manifestTarget === 'CANCELLED'}
                />
                <Button
                  type="submit"
                  variant="admin"
                  loading={action.isPending}
                  disabled={!canUpdateSensitive || !manifestTarget || action.isPending}
                >
                  {t('admin.deliveryOps.applyManifestTransition')}
                </Button>
              </form>
            ) : null}
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('admin.deliveryOps.orderTracking')}</th>
                    <th>{t('admin.deliveryOps.recipient')}</th>
                    <th>{t('admin.deliveryOps.address')}</th>
                    <th>{t('admin.deliveryOps.expectedCod')}</th>
                    <th>{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {manifest.data.items.map((item) => (
                    <tr key={item.deliveryId}>
                      <td>{item.sequence}</td>
                      <td>{item.trackingNumber ?? item.orderNumber}</td>
                      <td>
                        {item.recipientName} · {item.recipientPhone}
                      </td>
                      <td>
                        {item.address
                          ? [
                              item.address.street,
                              item.address.localityName,
                              item.address.delegationName,
                              item.address.governorateName,
                            ]
                              .filter(Boolean)
                              .join(', ')
                          : '—'}
                      </td>
                      <td>
                        <Price millimes={item.expectedCodMillimes} />
                      </td>
                      <td>{t(`admin.deliveryOps.statuses.${item.status}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="admin-panel">
          <h2>
            <FileCheck2 aria-hidden="true" size={18} /> {t('admin.deliveryOps.statusTransferTitle')}
          </h2>
          <p>{t('admin.deliveryOps.statusTransferBody')}</p>
          <h3>{t('admin.deliveryOps.exportStatuses')}</h3>
          <form className="admin-form-grid" onSubmit={submitStatusExport}>
            <SelectField name="status" label={t('common.status')}>
              <option value="">{t('admin.deliveryOps.allStatuses')}</option>
              {deliveryStatuses.map((status) => (
                <option key={status} value={status}>
                  {t(`admin.deliveryOps.statuses.${status}`)}
                </option>
              ))}
            </SelectField>
            <SelectField name="courierId" label={t('admin.deliveryOps.courier')}>
              <option value="">{t('admin.deliveryOps.allCouriers')}</option>
              {couriers.data?.map((courier) => (
                <option key={courier.id} value={courier.id}>
                  {courier.code} · {courier.name}
                </option>
              ))}
            </SelectField>
            <FormField name="from" type="datetime-local" label={t('admin.deliveryOps.from')} />
            <FormField name="to" type="datetime-local" label={t('admin.deliveryOps.to')} />
            <Button
              type="submit"
              variant="ghost"
              loading={exportAction.isPending}
              disabled={!canExportSensitive || exportAction.isPending}
            >
              <Download aria-hidden="true" size={17} /> {t('admin.deliveryOps.downloadStatuses')}
            </Button>
          </form>

          <h3>{t('admin.deliveryOps.importStatuses')}</h3>
          <form className="admin-form-grid" onSubmit={submitImport}>
            <FormField
              name="importKey"
              value={importKey}
              label={t('admin.deliveryOps.importKey')}
              minLength={8}
              maxLength={80}
              pattern="[A-Za-z0-9][A-Za-z0-9_.:-]+"
              disabled={!canUpdateSensitive || importAction.isPending}
              onChange={(event) => {
                setImportKey(event.target.value);
                setDryRunApproval(null);
                setImportResult(null);
              }}
              required
            />
            <FormField
              name="csv"
              type="file"
              accept=".csv,text/csv"
              label={t('admin.deliveryOps.csvFile')}
              hint={t('admin.deliveryOps.csvFileHint')}
              error={fileError || undefined}
              disabled={!canUpdateSensitive || importAction.isPending}
              onChange={(event) => void onCsvFile(event)}
              required={!importCsv}
            />
            {importFilename ? (
              <p role="status">{t('admin.deliveryOps.fileLoaded', { filename: importFilename })}</p>
            ) : null}
            <CheckboxField
              checked={applyConfirmed}
              disabled={!canUpdateSensitive || importAction.isPending}
              onChange={(event) => setApplyConfirmed(event.target.checked)}
              label={t('admin.deliveryOps.confirmApply')}
            />
            <div className="admin-heading-actions">
              <Button
                type="submit"
                name="mode"
                value="dry-run"
                variant="ghost"
                loading={importAction.isPending}
                disabled={!canUpdateSensitive || !importCsv || importAction.isPending}
              >
                <FileCheck2 aria-hidden="true" size={17} /> {t('admin.deliveryOps.dryRun')}
              </Button>
              <Button
                type="submit"
                name="mode"
                value="apply"
                variant="admin"
                loading={importAction.isPending}
                disabled={!importCanApply || importAction.isPending}
              >
                <FileUp aria-hidden="true" size={17} /> {t('admin.deliveryOps.applyImport')}
              </Button>
            </div>
          </form>
          {importResult ? (
            <div role="status" aria-live="polite">
              <p>
                {t('admin.deliveryOps.importSummary', {
                  rows: importResult.rowCount,
                  applied: importResult.appliedCount,
                  valid: importResult.valid ? t('common.yes') : t('common.no'),
                })}
                {importResult.replayed ? ` · ${t('admin.deliveryOps.replayed')}` : ''}
              </p>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{t('admin.deliveryOps.row')}</th>
                      <th>{t('admin.deliveryOps.deliveryId')}</th>
                      <th>{t('admin.deliveryOps.transition')}</th>
                      <th>{t('admin.deliveryOps.validation')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.rows.map((row) => (
                      <tr key={`${row.row}-${row.deliveryId}`}>
                        <td>{row.row}</td>
                        <td>{row.deliveryId}</td>
                        <td>
                          {row.currentStatus ?? '—'} → {row.targetStatus}
                        </td>
                        <td>
                          {row.valid ? t('admin.deliveryOps.valid') : (row.message ?? row.code)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>

        {loading ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
        <section className="admin-panel">
          <h2>
            <MapPinned aria-hidden="true" size={18} /> {t('admin.deliveryOps.zonesTitle')}
          </h2>
          <form className="admin-form-grid" onSubmit={createZone}>
            <FormField
              name="code"
              label={t('admin.deliveryOps.code')}
              disabled={!canUpdateSensitive || action.isPending}
              required
            />
            <FormField
              name="nameFr"
              label={t('admin.deliveryOps.nameFr')}
              disabled={!canUpdateSensitive || action.isPending}
              required
            />
            <FormField
              name="nameAr"
              label={t('admin.deliveryOps.nameAr')}
              dir="rtl"
              disabled={!canUpdateSensitive || action.isPending}
              required
            />
            <Button
              type="submit"
              variant="admin"
              loading={action.isPending}
              disabled={!canUpdateSensitive || action.isPending}
            >
              <Plus aria-hidden="true" size={17} /> {t('admin.deliveryOps.createInactiveZone')}
            </Button>
          </form>
          {zones.data?.items.map((zone) => (
            <article className="admin-panel" key={zone.id}>
              <strong>
                {zone.code} · {zone.nameFr}
              </strong>
              <p>
                {t('admin.deliveryOps.zoneCounts', {
                  localities: zone.localityCount,
                  rates: zone.activeRateCount,
                })}{' '}
                ·{' '}
                {zone.active
                  ? t('admin.deliveryOps.statuses.ACTIVE')
                  : t('admin.deliveryOps.inactive')}
              </p>
              <Button
                type="button"
                variant="ghost"
                loading={action.isPending}
                disabled={!canUpdateSensitive || action.isPending}
                onClick={() =>
                  action.mutate({
                    run: () => adminDataClient.setDeliveryZoneActive(zone, !zone.active),
                    success: t('admin.deliveryOps.zoneUpdated'),
                  })
                }
              >
                {zone.active ? t('admin.deliveryOps.deactivate') : t('admin.deliveryOps.activate')}
              </Button>
            </article>
          ))}
          <form className="admin-form-grid" onSubmit={linkLocality}>
            <SelectField
              name="zoneId"
              label={t('admin.deliveryOps.zone')}
              disabled={!canUpdateSensitive || action.isPending}
              required
            >
              <option value="">—</option>
              {zones.data?.items.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.nameFr}
                </option>
              ))}
            </SelectField>
            <FormField
              name="localityId"
              label={t('admin.deliveryOps.localityId')}
              disabled={!canUpdateSensitive || action.isPending}
              required
            />
            <Button
              type="submit"
              variant="admin"
              loading={action.isPending}
              disabled={!canUpdateSensitive || action.isPending}
            >
              {t('admin.deliveryOps.addLocality')}
            </Button>
          </form>
        </section>

        <section className="admin-panel">
          <h2>
            <Route aria-hidden="true" size={18} /> {t('admin.deliveryOps.ratesTitle')}
          </h2>
          <form className="admin-form-grid" onSubmit={createRate}>
            <SelectField
              name="deliveryZoneId"
              label={t('admin.deliveryOps.zone')}
              disabled={!canUpdateSensitive || action.isPending}
              required
            >
              <option value="">—</option>
              {zones.data?.items.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.nameFr}
                </option>
              ))}
            </SelectField>
            <FormField
              name="name"
              label={t('admin.deliveryOps.rateName')}
              disabled={!canUpdateSensitive || action.isPending}
              required
            />
            <FormField
              name="feeMillimes"
              type="number"
              min={0}
              label={t('admin.deliveryOps.amountMillimes')}
              disabled={!canUpdateSensitive || action.isPending}
              required
            />
            <Button
              type="submit"
              variant="admin"
              loading={action.isPending}
              disabled={!canUpdateSensitive || action.isPending}
            >
              {t('admin.deliveryOps.createInactiveRate')}
            </Button>
          </form>
          {rates.data?.items.map((rate) => (
            <article className="admin-panel" key={rate.id}>
              <strong>{rate.name}</strong> · <Price millimes={rate.feeMillimes} /> ·{' '}
              {rate.active
                ? t('admin.deliveryOps.statuses.ACTIVE')
                : t('admin.deliveryOps.inactive')}
              <Button
                type="button"
                variant="ghost"
                loading={action.isPending}
                disabled={!canUpdateSensitive || action.isPending}
                onClick={() =>
                  action.mutate({
                    run: () => adminDataClient.setDeliveryRateActive(rate, !rate.active),
                    success: t('admin.deliveryOps.rateUpdated'),
                  })
                }
              >
                {rate.active ? t('admin.deliveryOps.deactivate') : t('admin.deliveryOps.activate')}
              </Button>
            </article>
          ))}
        </section>

        <section className="admin-panel">
          <h2>{t('admin.deliveryOps.pickupsTitle')}</h2>
          <form className="admin-form-grid" onSubmit={createPickup}>
            <FormField
              name="code"
              label={t('admin.deliveryOps.code')}
              disabled={!canUpdateSensitive || action.isPending}
              required
            />
            <FormField
              name="nameFr"
              label={t('admin.deliveryOps.nameFr')}
              disabled={!canUpdateSensitive || action.isPending}
              required
            />
            <FormField
              name="nameAr"
              label={t('admin.deliveryOps.nameAr')}
              dir="rtl"
              disabled={!canUpdateSensitive || action.isPending}
              required
            />
            <FormField
              name="address"
              label={t('admin.deliveryOps.address')}
              disabled={!canUpdateSensitive || action.isPending}
              required
            />
            <Button
              type="submit"
              variant="admin"
              loading={action.isPending}
              disabled={!canUpdateSensitive || action.isPending}
            >
              {t('admin.deliveryOps.createInactivePickup')}
            </Button>
          </form>
          {pickups.data?.items.map((pickup) => (
            <article className="admin-panel" key={pickup.id}>
              <strong>{pickup.nameFr}</strong> · {pickup.address} ·{' '}
              {pickup.active
                ? t('admin.deliveryOps.statuses.ACTIVE')
                : t('admin.deliveryOps.inactive')}
              <Button
                type="button"
                variant="ghost"
                loading={action.isPending}
                disabled={!canUpdateSensitive || action.isPending}
                onClick={() =>
                  action.mutate({
                    run: () => adminDataClient.setPickupActive(pickup, !pickup.active),
                    success: t('admin.deliveryOps.pickupUpdated'),
                  })
                }
              >
                {pickup.active
                  ? t('admin.deliveryOps.deactivate')
                  : t('admin.deliveryOps.activate')}
              </Button>
            </article>
          ))}
        </section>
      </div>

      {hasError ? <ErrorState compact onRetry={() => void refresh()} /> : null}
    </div>
  );
}
