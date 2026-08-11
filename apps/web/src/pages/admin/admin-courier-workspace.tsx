import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  Filter,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  Truck,
  UserRoundCheck,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';

import { adminDataClient } from '../../api/admin-data-client';
import { ApiError } from '../../api/http';
import type {
  AdminCourierAssignmentOption,
  AdminCourierAssignmentWarning,
  AdminCourierAvailabilityStatus,
  AdminCourierRecord,
  AdminCourierStatus,
  AdminCourierWhatsAppPreview,
  AdminDeliveryDetail,
  AdminDeliveryZoneConfig,
  AdminRecord,
} from '../../api/types';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import {
  CheckboxField,
  FormField,
  SelectField,
  TextareaField,
} from '../../components/ui/form-field';
import { Price } from '../../components/ui/price';
import { parseOptionalCourierFeeTnd } from './courier-fee';

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

const attemptOutcomes = [
  'CUSTOMER_UNAVAILABLE',
  'ADDRESS_NOT_FOUND',
  'CUSTOMER_REFUSED',
  'FAILED_AGE_VERIFICATION',
  'PARTIAL_CASH_NOT_ALLOWED',
  'RESCHEDULED',
  'OTHER_FAILED',
] as const;

const courierStatuses: AdminCourierStatus[] = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'];
const courierAvailabilities: AdminCourierAvailabilityStatus[] = ['AVAILABLE', 'OFF_DUTY'];

type CourierFeeError = 'format' | 'precision' | 'nonNegative' | 'maximum';

const feeInputValue = (millimes: number | null | undefined): string =>
  millimes === null || millimes === undefined ? '' : (millimes / 1_000).toFixed(3);

const textEntry = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

const optionalText = (form: FormData, key: string): string | undefined =>
  textEntry(form, key) || undefined;

const nullableText = (form: FormData, key: string): string | null => textEntry(form, key) || null;

const optionalPositiveInteger = (form: FormData, key: string): number | undefined => {
  const value = textEntry(form, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const nullablePositiveInteger = (form: FormData, key: string): number | null => {
  const value = textEntry(form, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const recordText = (record: AdminRecord, key: string): string => {
  const value = record[key];
  return typeof value === 'string' ? value : '';
};

const courierStatusTone = (courier: AdminCourierRecord): 'active' | 'ready' | 'blocking' => {
  if (courier.status !== 'ACTIVE') return 'blocking';
  return courier.availabilityStatus === 'AVAILABLE' ? 'active' : 'ready';
};

interface CoverageInput {
  deliveryZoneId: string;
  active: boolean;
  feeMillimes?: number;
}

interface CoverageResult {
  coverageZones: CoverageInput[];
  invalidInput: HTMLInputElement | null;
  error: CourierFeeError | null;
}

function readCoverage(
  formElement: HTMLFormElement,
  zones: AdminDeliveryZoneConfig[],
): CoverageResult {
  const form = new FormData(formElement);
  const coverageZones: CoverageInput[] = [];
  for (const zone of zones) {
    if (form.get(`coverage-${zone.id}`) !== 'on') continue;
    const result = parseOptionalCourierFeeTnd(textEntry(form, `coverage-fee-${zone.id}`));
    if (result.error) {
      return {
        coverageZones: [],
        invalidInput: formElement.elements.namedItem(
          `coverage-fee-${zone.id}`,
        ) as HTMLInputElement | null,
        error: result.error,
      };
    }
    coverageZones.push({
      deliveryZoneId: zone.id,
      active: true,
      ...(result.value === null ? {} : { feeMillimes: result.value }),
    });
  }
  return { coverageZones, invalidInput: null, error: null };
}

interface CourierOperationInput {
  run: () => Promise<unknown>;
  success: string;
  after?: (result: unknown) => void;
}

interface AdminCourierWorkspaceProps {
  zones: AdminDeliveryZoneConfig[];
  canAssignSensitive: boolean;
  canUpdateSensitive: boolean;
  selectedDeliveryIds: string[];
  setSelectedDeliveryIds: Dispatch<SetStateAction<string[]>>;
}

export function AdminCourierWorkspace({
  zones,
  canAssignSensitive,
  canUpdateSensitive,
  selectedDeliveryIds,
  setSelectedDeliveryIds,
}: AdminCourierWorkspaceProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const createFormRef = useRef<HTMLFormElement>(null);
  const deliverySectionRef = useRef<HTMLElement>(null);
  const [feedback, setFeedback] = useState('');
  const [localError, setLocalError] = useState('');
  const [courierFilters, setCourierFilters] = useState({
    q: '',
    status: '' as '' | AdminCourierStatus,
    availabilityStatus: '' as '' | AdminCourierAvailabilityStatus,
  });
  const [deliveryFilters, setDeliveryFilters] = useState({ q: '', status: '', courierId: '' });
  const [selectedDeliveryId, setSelectedDeliveryId] = useState('');
  const selectedDeliveryIdRef = useRef('');
  const [selectedAssignmentCourierId, setSelectedAssignmentCourierId] = useState('');
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<AdminCourierAssignmentWarning[]>(
    [],
  );
  const [whatsappPreview, setWhatsappPreview] = useState<AdminCourierWhatsAppPreview | null>(null);

  const courierQueryString = useMemo(() => {
    const query = new URLSearchParams({ page: '1', limit: '50' });
    if (courierFilters.q) query.set('q', courierFilters.q);
    if (courierFilters.status) query.set('status', courierFilters.status);
    if (courierFilters.availabilityStatus) {
      query.set('availabilityStatus', courierFilters.availabilityStatus);
    }
    return query.toString();
  }, [courierFilters]);

  const deliveryQueryString = useMemo(() => {
    const query = new URLSearchParams({ page: '1', limit: '50' });
    if (deliveryFilters.q) query.set('q', deliveryFilters.q);
    if (deliveryFilters.status) query.set('status', deliveryFilters.status);
    if (deliveryFilters.courierId) query.set('courierId', deliveryFilters.courierId);
    return query.toString();
  }, [deliveryFilters]);

  const courierRecords = useQuery({
    queryKey: ['admin', 'courier-workspace', 'records', courierQueryString],
    queryFn: () => adminDataClient.courierRecords(courierQueryString),
  });
  const deliveries = useQuery({
    queryKey: ['admin', 'courier-workspace', 'deliveries', deliveryQueryString],
    queryFn: () => adminDataClient.list('deliveries', deliveryQueryString),
  });
  const delivery = useQuery({
    queryKey: ['admin', 'courier-workspace', 'delivery', selectedDeliveryId],
    queryFn: () => adminDataClient.delivery(selectedDeliveryId),
    enabled: Boolean(selectedDeliveryId),
  });
  const assignmentOptions = useQuery({
    queryKey: ['admin', 'courier-workspace', 'assignment-options', selectedDeliveryId],
    queryFn: () => adminDataClient.couriers(selectedDeliveryId),
    enabled: Boolean(selectedDeliveryId),
  });

  const invalidateCourierWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'courier-workspace'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'delivery'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'deliveries'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'delivery-operations'] }),
    ]);
  };

  const operation = useMutation({
    mutationFn: ({ run }: CourierOperationInput) => run(),
    onMutate: () => {
      setFeedback('');
      setLocalError('');
      setWhatsappPreview(null);
    },
    onSuccess: (result, variables) => {
      setFeedback(variables.success);
      variables.after?.(result);
      void invalidateCourierWorkspace();
    },
  });
  const whatsapp = useMutation({
    mutationFn: adminDataClient.courierWhatsAppPreview,
    onMutate: () => {
      setFeedback('');
      setLocalError('');
      setWhatsappPreview(null);
    },
    onSuccess: (preview, deliveryId) => {
      if (selectedDeliveryIdRef.current === deliveryId) setWhatsappPreview(preview);
    },
  });

  const selectedAssignmentOption = assignmentOptions.data?.find(
    (option) => option.id === selectedAssignmentCourierId,
  );
  const assignmentWarnings = selectedAssignmentOption?.warnings ?? [];
  const warningsAcknowledged = assignmentWarnings.every((warning) =>
    acknowledgedWarnings.includes(warning),
  );

  const feeErrorMessage = (error: CourierFeeError) =>
    t(`admin.deliveryOps.courierFeeErrors.${error}`);

  const createCourier = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const coverage = readCoverage(element, zones);
    if (coverage.error) {
      setLocalError(feeErrorMessage(coverage.error));
      coverage.invalidInput?.focus();
      return;
    }
    const defaultFee = parseOptionalCourierFeeTnd(textEntry(form, 'defaultFeeTnd'));
    if (defaultFee.error) {
      setLocalError(feeErrorMessage(defaultFee.error));
      (element.elements.namedItem('defaultFeeTnd') as HTMLInputElement | null)?.focus();
      return;
    }
    const availabilityStatus = textEntry(form, 'availabilityStatus');
    const maximumActiveDeliveries = optionalPositiveInteger(form, 'maximumActiveDeliveries');
    operation.mutate({
      run: () =>
        adminDataClient.createCourierRecord({
          code: textEntry(form, 'code').toUpperCase(),
          name: textEntry(form, 'name'),
          ...(optionalText(form, 'companyName')
            ? { companyName: textEntry(form, 'companyName') }
            : {}),
          ...(availabilityStatus === 'OFF_DUTY' ? { availabilityStatus: 'OFF_DUTY' } : {}),
          ...(optionalText(form, 'contactName')
            ? { contactName: textEntry(form, 'contactName') }
            : {}),
          ...(optionalText(form, 'phoneE164') ? { phoneE164: textEntry(form, 'phoneE164') } : {}),
          ...(optionalText(form, 'whatsappPhoneE164')
            ? { whatsappPhoneE164: textEntry(form, 'whatsappPhoneE164') }
            : {}),
          ...(optionalText(form, 'email') ? { email: textEntry(form, 'email') } : {}),
          ...(defaultFee.value === null ? {} : { defaultFeeMillimes: defaultFee.value }),
          ...(maximumActiveDeliveries === undefined ? {} : { maximumActiveDeliveries }),
          ...(optionalText(form, 'whatsappTemplate')
            ? { whatsappTemplate: textEntry(form, 'whatsappTemplate') }
            : {}),
          ...(coverage.coverageZones.length ? { coverageZones: coverage.coverageZones } : {}),
          ...(optionalText(form, 'notes') ? { notes: textEntry(form, 'notes') } : {}),
        }),
      success: t('admin.deliveryOps.courierCreated'),
      after: (result) => {
        const created = result as AdminCourierRecord;
        createFormRef.current?.reset();
        setFeedback(
          t('admin.deliveryOps.courierCreatedNamed', {
            code: created.code,
            name: created.name,
          }),
        );
      },
    });
  };

  const updateCourier = (event: FormEvent<HTMLFormElement>, courier: AdminCourierRecord) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const coverage = readCoverage(element, zones);
    if (coverage.error) {
      setLocalError(feeErrorMessage(coverage.error));
      coverage.invalidInput?.focus();
      return;
    }
    const defaultFee = parseOptionalCourierFeeTnd(textEntry(form, 'defaultFeeTnd'));
    if (defaultFee.error) {
      setLocalError(feeErrorMessage(defaultFee.error));
      (element.elements.namedItem('defaultFeeTnd') as HTMLInputElement | null)?.focus();
      return;
    }
    operation.mutate({
      run: () =>
        adminDataClient.updateCourierRecord(courier, {
          code: textEntry(form, 'code').toUpperCase(),
          name: textEntry(form, 'name'),
          companyName: nullableText(form, 'companyName'),
          availabilityStatus: textEntry(
            form,
            'availabilityStatus',
          ) as AdminCourierAvailabilityStatus,
          contactName: nullableText(form, 'contactName'),
          phoneE164: nullableText(form, 'phoneE164'),
          whatsappPhoneE164: nullableText(form, 'whatsappPhoneE164'),
          email: nullableText(form, 'email'),
          defaultFeeMillimes: defaultFee.value,
          maximumActiveDeliveries: nullablePositiveInteger(form, 'maximumActiveDeliveries'),
          whatsappTemplate: nullableText(form, 'whatsappTemplate'),
          coverageZones: coverage.coverageZones,
          notes: nullableText(form, 'notes'),
        }),
      success: t('admin.deliveryOps.courierProfileUpdated'),
    });
  };

  const filterDeliveriesForCourier = (courier: AdminCourierRecord) => {
    setDeliveryFilters({ q: '', status: '', courierId: courier.id });
    window.setTimeout(() => deliverySectionRef.current?.scrollIntoView({ block: 'start' }), 0);
  };

  const copyWhatsAppMessage = async () => {
    if (!whatsappPreview) return;
    try {
      await navigator.clipboard.writeText(whatsappPreview.renderedMessage);
      setFeedback(t('admin.deliveryOps.whatsappCopied'));
      setLocalError('');
    } catch {
      setLocalError(t('admin.deliveryOps.whatsappCopyFailed'));
    }
  };

  const retry = () => {
    void Promise.all([
      courierRecords.refetch(),
      deliveries.refetch(),
      ...(selectedDeliveryId ? [delivery.refetch(), assignmentOptions.refetch()] : []),
    ]);
  };

  const queryError =
    courierRecords.isError || deliveries.isError || delivery.isError || assignmentOptions.isError;
  const actionError = operation.error ?? whatsapp.error;

  return (
    <div className="admin-courier-workspace">
      <section
        className="admin-panel admin-courier-directory"
        aria-labelledby="courier-directory-title"
      >
        <div className="admin-delivery-section__heading">
          <div>
            <h2 id="courier-directory-title">
              <BriefcaseBusiness aria-hidden="true" size={19} />{' '}
              {t('admin.deliveryOps.courierDirectoryTitle')}
            </h2>
            <p className="admin-delivery-section__intro">
              {t('admin.deliveryOps.courierDirectoryBody')}
            </p>
          </div>
          <span className="admin-delivery-status" data-status="active">
            {t('admin.deliveryOps.courierTotal', { count: courierRecords.data?.total ?? 0 })}
          </span>
        </div>

        <details className="admin-delivery-disclosure admin-courier-create">
          <summary className="admin-delivery-disclosure__summary">
            <span>
              <strong>{t('admin.deliveryOps.createCourier')}</strong>
              <small>{t('admin.deliveryOps.createCourierHint')}</small>
            </span>
            <Plus aria-hidden="true" size={20} />
          </summary>
          <div className="admin-delivery-disclosure__content">
            <form ref={createFormRef} className="admin-form-grid" onSubmit={createCourier}>
              <CourierFields zones={zones} disabled={!canUpdateSensitive || operation.isPending} />
              <Button
                type="submit"
                variant="admin"
                loading={operation.isPending}
                disabled={!canUpdateSensitive || operation.isPending}
              >
                <Plus aria-hidden="true" size={17} /> {t('admin.deliveryOps.createCourier')}
              </Button>
            </form>
          </div>
        </details>

        <form
          key={`${courierFilters.q}:${courierFilters.status}:${courierFilters.availabilityStatus}`}
          className="admin-courier-filters"
          aria-label={t('admin.deliveryOps.courierFilters')}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setCourierFilters({
              q: textEntry(form, 'q'),
              status: textEntry(form, 'status') as '' | AdminCourierStatus,
              availabilityStatus: textEntry(form, 'availabilityStatus') as
                '' | AdminCourierAvailabilityStatus,
            });
          }}
        >
          <FormField
            name="q"
            label={t('admin.deliveryOps.searchCouriers')}
            defaultValue={courierFilters.q}
            leading={<Search aria-hidden="true" size={17} />}
            maxLength={80}
          />
          <SelectField
            name="status"
            label={t('common.status')}
            defaultValue={courierFilters.status}
          >
            <option value="">{t('admin.deliveryOps.allCourierStatuses')}</option>
            {courierStatuses.map((status) => (
              <option key={status} value={status}>
                {t(`admin.deliveryOps.statuses.${status}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            name="availabilityStatus"
            label={t('admin.deliveryOps.availability')}
            defaultValue={courierFilters.availabilityStatus}
          >
            <option value="">{t('admin.deliveryOps.allAvailabilities')}</option>
            {courierAvailabilities.map((status) => (
              <option key={status} value={status}>
                {t(`admin.deliveryOps.availabilityStatuses.${status}`)}
              </option>
            ))}
          </SelectField>
          <div className="admin-courier-filter-actions">
            <Button type="submit" variant="admin">
              <Filter aria-hidden="true" size={17} /> {t('admin.deliveryOps.applyFilters')}
            </Button>
            <Button
              type="reset"
              variant="ghost"
              onClick={() => setCourierFilters({ q: '', status: '', availabilityStatus: '' })}
            >
              {t('admin.deliveryOps.clearFilters')}
            </Button>
          </div>
        </form>

        {courierRecords.isPending ? (
          <LoadingState label={t('common.loading')} tone="admin" />
        ) : null}
        {courierRecords.data?.items.length === 0 ? (
          <EmptyState title={t('admin.deliveryOps.noCouriers')} />
        ) : null}
        <div className="admin-courier-grid">
          {courierRecords.data?.items.map((courier) => (
            <CourierCard
              key={courier.id}
              courier={courier}
              zones={zones}
              canUpdateSensitive={canUpdateSensitive}
              pending={operation.isPending}
              onUpdate={updateCourier}
              onStatus={(status) =>
                operation.mutate({
                  run: () => adminDataClient.updateCourierStatus(courier, status),
                  success: t('admin.deliveryOps.courierUpdated'),
                })
              }
              onAvailability={(availabilityStatus) =>
                operation.mutate({
                  run: () => adminDataClient.updateCourierRecord(courier, { availabilityStatus }),
                  success: t('admin.deliveryOps.courierAvailabilityUpdated'),
                })
              }
              onViewDeliveries={() => filterDeliveriesForCourier(courier)}
            />
          ))}
        </div>
      </section>

      <section
        ref={deliverySectionRef}
        id="courier-deliveries"
        className="admin-panel admin-courier-deliveries"
        aria-labelledby="courier-deliveries-title"
      >
        <div className="admin-delivery-section__heading">
          <div>
            <h2 id="courier-deliveries-title">
              <Truck aria-hidden="true" size={19} /> {t('admin.deliveryOps.courierDeliveriesTitle')}
            </h2>
            <p className="admin-delivery-section__intro">
              {t('admin.deliveryOps.courierDeliveriesBody')}
            </p>
          </div>
          {deliveryFilters.courierId ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeliveryFilters((current) => ({ ...current, courierId: '' }))}
            >
              {t('admin.deliveryOps.showAllCouriers')}
            </Button>
          ) : null}
        </div>

        <form
          key={`${deliveryFilters.q}:${deliveryFilters.status}:${deliveryFilters.courierId}`}
          className="admin-courier-filters"
          aria-label={t('admin.deliveryOps.deliveryFilters')}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setDeliveryFilters({
              q: textEntry(form, 'q'),
              status: textEntry(form, 'status'),
              courierId: textEntry(form, 'courierId'),
            });
          }}
        >
          <FormField
            name="q"
            label={t('admin.deliveryOps.searchDeliveries')}
            defaultValue={deliveryFilters.q}
            leading={<Search aria-hidden="true" size={17} />}
            maxLength={80}
          />
          <SelectField
            name="status"
            label={t('common.status')}
            defaultValue={deliveryFilters.status}
          >
            <option value="">{t('admin.deliveryOps.allDeliveryStatuses')}</option>
            {[
              'PENDING_CONFIRMATION',
              'CONFIRMED',
              'PREPARING',
              'READY_FOR_PICKUP',
              'ASSIGNED_TO_COURIER',
              'HANDED_TO_COURIER',
              'IN_TRANSIT',
              'OUT_FOR_DELIVERY',
              'DELIVERY_ATTEMPTED',
              'RESCHEDULED',
              'DELIVERED',
              'FAILED',
              'RETURN_TO_SENDER',
              'RETURNED',
              'CANCELLED',
            ].map((status) => (
              <option key={status} value={status}>
                {t(`admin.deliveryOps.statuses.${status}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            name="courierId"
            label={t('admin.deliveryOps.courier')}
            defaultValue={deliveryFilters.courierId}
          >
            <option value="">{t('admin.deliveryOps.allCouriers')}</option>
            {courierRecords.data?.items.map((courier) => (
              <option key={courier.id} value={courier.id}>
                {courier.code} · {courier.name}
              </option>
            ))}
          </SelectField>
          <div className="admin-courier-filter-actions">
            <Button type="submit" variant="admin">
              <Filter aria-hidden="true" size={17} /> {t('admin.deliveryOps.applyFilters')}
            </Button>
            <Button
              type="reset"
              variant="ghost"
              onClick={() => setDeliveryFilters({ q: '', status: '', courierId: '' })}
            >
              {t('admin.deliveryOps.clearFilters')}
            </Button>
          </div>
        </form>

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
                    recordText(item, 'trackingNumber') || recordText(item, 'id');
                  const status = recordText(item, 'status');
                  const id = recordText(item, 'id');
                  const selectable = status === 'ASSIGNED_TO_COURIER' && canAssignSensitive;
                  return (
                    <tr key={id}>
                      <td>
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            disabled={!selectable || operation.isPending}
                            checked={selectedDeliveryIds.includes(id)}
                            onChange={(event) =>
                              setSelectedDeliveryIds((current) =>
                                event.target.checked
                                  ? [...current, id]
                                  : current.filter((selectedId) => selectedId !== id),
                              )
                            }
                          />
                          <span className="sr-only">
                            {t('admin.deliveryOps.selectDelivery', { id: trackingNumber })}
                          </span>
                        </label>
                      </td>
                      <td>{trackingNumber}</td>
                      <td>{recordText(item, 'zoneName') || '—'}</td>
                      <td>{recordText(item, 'courierName') || '—'}</td>
                      <td>{t(`admin.deliveryOps.statuses.${status}`, { defaultValue: status })}</td>
                      <td>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={delivery.isFetching}
                          onClick={() => {
                            setSelectedAssignmentCourierId('');
                            setAcknowledgedWarnings([]);
                            setWhatsappPreview(null);
                            selectedDeliveryIdRef.current = id;
                            setSelectedDeliveryId(id);
                          }}
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
        <DeliveryCourierDetail
          key={delivery.data.id}
          delivery={delivery.data}
          options={assignmentOptions.data ?? []}
          selectedCourierId={selectedAssignmentCourierId}
          setSelectedCourierId={(courierId) => {
            setSelectedAssignmentCourierId(courierId);
            setAcknowledgedWarnings([]);
          }}
          acknowledgedWarnings={acknowledgedWarnings}
          setAcknowledgedWarnings={setAcknowledgedWarnings}
          warningsAcknowledged={warningsAcknowledged}
          canAssignSensitive={canAssignSensitive}
          canUpdateSensitive={canUpdateSensitive}
          pending={operation.isPending}
          onOperation={(input) => operation.mutate(input)}
          whatsappPending={whatsapp.isPending}
          whatsappPreview={whatsappPreview}
          onPreviewWhatsApp={() => whatsapp.mutate(delivery.data.id)}
          onCopyWhatsApp={() => void copyWhatsAppMessage()}
        />
      ) : null}

      {feedback ? (
        <p className="form-banner form-banner--success" role="status" aria-live="polite">
          <CheckCircle2 aria-hidden="true" size={18} /> {feedback}
        </p>
      ) : null}
      {localError ? (
        <p className="form-banner form-banner--error" role="alert">
          <AlertTriangle aria-hidden="true" size={18} /> {localError}
        </p>
      ) : null}
      {actionError ? <CourierError error={actionError} /> : null}
      {queryError ? (
        <ErrorState
          compact
          title={t('admin.deliveryOps.operationsLoadErrorTitle')}
          body={t('admin.deliveryOps.operationsLoadErrorBody')}
          onRetry={retry}
        />
      ) : null}
    </div>
  );
}

function CourierFields({
  courier,
  zones,
  disabled,
}: {
  courier?: AdminCourierRecord;
  zones: AdminDeliveryZoneConfig[];
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const coverageZones = courier?.coverageZones ?? [];
  return (
    <>
      <FormField
        name="code"
        label={t('admin.deliveryOps.code')}
        defaultValue={courier?.code}
        pattern="[A-Za-z0-9][A-Za-z0-9_-]+"
        minLength={2}
        maxLength={80}
        disabled={disabled}
        required
        onInput={(event) => {
          event.currentTarget.value = event.currentTarget.value.toUpperCase();
        }}
      />
      <FormField
        name="name"
        label={t('admin.deliveryOps.courierName')}
        defaultValue={courier?.name}
        minLength={2}
        maxLength={200}
        disabled={disabled}
        required
      />
      <FormField
        name="companyName"
        label={t('admin.deliveryOps.companyName')}
        defaultValue={courier?.companyName ?? ''}
        minLength={2}
        maxLength={200}
        disabled={disabled}
      />
      <SelectField
        name="availabilityStatus"
        label={t('admin.deliveryOps.availability')}
        defaultValue={courier?.availabilityStatus ?? 'AVAILABLE'}
        disabled={disabled}
      >
        {courierAvailabilities.map((status) => (
          <option key={status} value={status}>
            {t(`admin.deliveryOps.availabilityStatuses.${status}`)}
          </option>
        ))}
      </SelectField>
      <FormField
        name="contactName"
        label={t('admin.deliveryOps.contactName')}
        defaultValue={courier?.contactName ?? ''}
        minLength={2}
        maxLength={160}
        disabled={disabled}
      />
      <FormField
        name="phoneE164"
        type="tel"
        label={t('admin.deliveryOps.phoneE164')}
        defaultValue={courier?.phoneE164 ?? ''}
        placeholder="+21612345678"
        pattern="\+[1-9][0-9]{7,14}"
        disabled={disabled}
      />
      <FormField
        name="whatsappPhoneE164"
        type="tel"
        label={t('admin.deliveryOps.whatsappPhone')}
        hint={t('admin.deliveryOps.whatsappPhoneHint')}
        defaultValue={courier?.whatsappPhoneE164 ?? ''}
        placeholder="+21620123456"
        pattern="\+[1-9][0-9]{7,14}"
        disabled={disabled}
      />
      <FormField
        name="email"
        type="email"
        label={t('admin.deliveryOps.email')}
        defaultValue={courier?.email ?? ''}
        maxLength={320}
        disabled={disabled}
      />
      <FormField
        name="defaultFeeTnd"
        label={t('admin.deliveryOps.defaultCourierFee')}
        hint={t('admin.deliveryOps.courierFeeHint')}
        defaultValue={feeInputValue(courier?.defaultFeeMillimes)}
        inputMode="decimal"
        placeholder="8,000"
        disabled={disabled}
      />
      <FormField
        name="maximumActiveDeliveries"
        type="number"
        label={t('admin.deliveryOps.maximumActiveDeliveries')}
        hint={t('admin.deliveryOps.maximumActiveDeliveriesHint')}
        defaultValue={courier?.maximumActiveDeliveries ?? ''}
        min={1}
        max={10_000}
        step={1}
        disabled={disabled}
      />
      <fieldset className="admin-courier-coverage field--wide">
        <legend>{t('admin.deliveryOps.coverageTitle')}</legend>
        <p>{t('admin.deliveryOps.coverageHint')}</p>
        {zones.length === 0 ? <p>{t('admin.deliveryOps.noDeliveryZones')}</p> : null}
        <div className="admin-courier-coverage__grid">
          {zones.map((zone) => {
            const coverage = coverageZones.find((item) => item.deliveryZoneId === zone.id);
            return (
              <div className="admin-courier-coverage__row" key={zone.id}>
                <CheckboxField
                  name={`coverage-${zone.id}`}
                  defaultChecked={coverage?.active ?? false}
                  disabled={disabled}
                  label={
                    <span>
                      <strong>{zone.nameFr}</strong>
                      <small>
                        {zone.code} ·{' '}
                        {zone.active
                          ? t('admin.deliveryOps.coverageZoneActive')
                          : t('admin.deliveryOps.coverageZoneInactive')}
                      </small>
                    </span>
                  }
                />
                <FormField
                  name={`coverage-fee-${zone.id}`}
                  label={t('admin.deliveryOps.zoneCourierFee')}
                  defaultValue={feeInputValue(coverage?.feeMillimes)}
                  inputMode="decimal"
                  placeholder={t('admin.deliveryOps.useDefaultFee')}
                  disabled={disabled}
                />
              </div>
            );
          })}
        </div>
      </fieldset>
      <TextareaField
        name="whatsappTemplate"
        className="field--wide"
        label={t('admin.deliveryOps.whatsappTemplate')}
        hint={t('admin.deliveryOps.whatsappTemplateHint')}
        defaultValue={courier?.whatsappTemplate ?? ''}
        maxLength={2_000}
        rows={6}
        disabled={disabled}
      />
      <TextareaField
        name="notes"
        className="field--wide"
        label={t('admin.deliveryOps.notes')}
        defaultValue={courier?.notes ?? ''}
        maxLength={1_000}
        rows={3}
        disabled={disabled}
      />
    </>
  );
}

function CourierCard({
  courier,
  zones,
  canUpdateSensitive,
  pending,
  onUpdate,
  onStatus,
  onAvailability,
  onViewDeliveries,
}: {
  courier: AdminCourierRecord;
  zones: AdminDeliveryZoneConfig[];
  canUpdateSensitive: boolean;
  pending: boolean;
  onUpdate: (event: FormEvent<HTMLFormElement>, courier: AdminCourierRecord) => void;
  onStatus: (status: AdminCourierStatus) => void;
  onAvailability: (status: AdminCourierAvailabilityStatus) => void;
  onViewDeliveries: () => void;
}) {
  const { t, i18n } = useTranslation();
  const externallyManaged = (courier.integrations ?? []).some(
    (integration) => integration.type !== 'MANUAL',
  );
  const availabilityStatus = courier.availabilityStatus ?? 'AVAILABLE';
  const coverageZones = courier.coverageZones ?? [];
  const targets: AdminCourierStatus[] =
    courier.status === 'ACTIVE'
      ? ['SUSPENDED', 'ARCHIVED']
      : courier.status === 'SUSPENDED'
        ? ['ACTIVE', 'ARCHIVED']
        : ['ACTIVE'];
  return (
    <article
      className="admin-delivery-record admin-courier-card"
      data-status={courierStatusTone({ ...courier, availabilityStatus })}
      aria-labelledby={`courier-${courier.id}-title`}
    >
      <div className="admin-delivery-record__heading">
        <div>
          <span className="admin-delivery-record__eyebrow">{courier.code}</span>
          <h3 id={`courier-${courier.id}-title`}>{courier.name}</h3>
          {courier.companyName ? <p>{courier.companyName}</p> : null}
        </div>
        <div className="admin-courier-card__statuses">
          <span
            className="admin-delivery-status"
            data-status={courier.status === 'ACTIVE' ? 'active' : 'blocking'}
          >
            {t(`admin.deliveryOps.statuses.${courier.status}`)}
          </span>
          <span
            className="admin-delivery-status"
            data-status={availabilityStatus === 'AVAILABLE' ? 'active' : 'ready'}
          >
            {t(`admin.deliveryOps.availabilityStatuses.${availabilityStatus}`)}
          </span>
        </div>
      </div>
      <dl className="admin-delivery-facts">
        <div>
          <dt>{t('admin.deliveryOps.currentLoad')}</dt>
          <dd>
            {courier.activeDeliveryCount ?? 0} / {courier.maximumActiveDeliveries ?? '∞'}
          </dd>
        </div>
        <div>
          <dt>{t('admin.deliveryOps.coverageTitle')}</dt>
          <dd>
            {courier.coverageMode === 'ZONES'
              ? t('admin.deliveryOps.coverageZoneCount', { count: coverageZones.length })
              : t('admin.deliveryOps.coverageUnrestricted')}
          </dd>
        </div>
        <div>
          <dt>{t('admin.deliveryOps.defaultCourierFee')}</dt>
          <dd>
            {courier.defaultFeeMillimes === null || courier.defaultFeeMillimes === undefined ? (
              '—'
            ) : (
              <Price millimes={courier.defaultFeeMillimes} />
            )}
          </dd>
        </div>
        <div>
          <dt>{t('admin.deliveryOps.deliveryHistory')}</dt>
          <dd>{courier.deliveryCount ?? 0}</dd>
        </div>
      </dl>
      {coverageZones.length ? (
        <ul className="admin-courier-zone-list" aria-label={t('admin.deliveryOps.coverageTitle')}>
          {coverageZones.map((coverage) => (
            <li key={coverage.deliveryZoneId}>
              <span>{i18n.language.startsWith('ar') ? coverage.nameAr : coverage.nameFr}</span>
              {coverage.feeMillimes === null ? (
                <small>{t('admin.deliveryOps.useDefaultFee')}</small>
              ) : (
                <small>
                  <Price millimes={coverage.feeMillimes} />
                </small>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {courier.contactName || courier.phoneE164 || courier.whatsappPhoneE164 || courier.email ? (
        <p className="admin-courier-contact">
          {[courier.contactName, courier.phoneE164, courier.whatsappPhoneE164, courier.email]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
      {courier.notes ? <p className="admin-courier-notes">{courier.notes}</p> : null}
      {externallyManaged ? <p role="note">{t('admin.deliveryOps.externallyManaged')}</p> : null}
      <div className="admin-delivery-actions">
        <Button type="button" variant="ghost" onClick={onViewDeliveries}>
          <Truck aria-hidden="true" size={17} /> {t('admin.deliveryOps.viewCourierDeliveries')}
        </Button>
        {courier.status === 'ACTIVE' ? (
          <Button
            type="button"
            variant="ghost"
            disabled={!canUpdateSensitive || externallyManaged || pending}
            onClick={() =>
              onAvailability(availabilityStatus === 'AVAILABLE' ? 'OFF_DUTY' : 'AVAILABLE')
            }
          >
            <UserRoundCheck aria-hidden="true" size={17} />{' '}
            {t(
              availabilityStatus === 'AVAILABLE'
                ? 'admin.deliveryOps.setOffDuty'
                : 'admin.deliveryOps.setAvailable',
            )}
          </Button>
        ) : null}
      </div>
      <details className="admin-delivery-disclosure admin-courier-editor">
        <summary className="admin-delivery-disclosure__summary">
          <span>
            <strong>{t('admin.deliveryOps.editCourier')}</strong>
            <small>{t('admin.deliveryOps.editCourierHint')}</small>
          </span>
          <Pencil aria-hidden="true" size={19} />
        </summary>
        <div className="admin-delivery-disclosure__content">
          <form
            key={courier.updatedAt}
            className="admin-form-grid"
            onSubmit={(event) => onUpdate(event, courier)}
          >
            <CourierFields
              courier={courier}
              zones={zones}
              disabled={!canUpdateSensitive || externallyManaged || pending}
            />
            <Button
              type="submit"
              variant="admin"
              loading={pending}
              disabled={!canUpdateSensitive || externallyManaged || pending}
            >
              {t('admin.deliveryOps.saveCourier')}
            </Button>
          </form>
          <div
            className="admin-courier-lifecycle"
            aria-label={t('admin.deliveryOps.courierLifecycle')}
          >
            {targets.map((status) => (
              <Button
                type="button"
                variant={status === 'ARCHIVED' ? 'danger' : 'ghost'}
                key={status}
                loading={pending}
                disabled={!canUpdateSensitive || externallyManaged || pending}
                onClick={() => onStatus(status)}
              >
                {t(`admin.deliveryOps.courierActions.${status}`)}
              </Button>
            ))}
          </div>
        </div>
      </details>
    </article>
  );
}

function DeliveryCourierDetail({
  delivery,
  options,
  selectedCourierId,
  setSelectedCourierId,
  acknowledgedWarnings,
  setAcknowledgedWarnings,
  warningsAcknowledged,
  canAssignSensitive,
  canUpdateSensitive,
  pending,
  onOperation,
  whatsappPending,
  whatsappPreview,
  onPreviewWhatsApp,
  onCopyWhatsApp,
}: {
  delivery: AdminDeliveryDetail;
  options: AdminCourierAssignmentOption[];
  selectedCourierId: string;
  setSelectedCourierId: (courierId: string) => void;
  acknowledgedWarnings: AdminCourierAssignmentWarning[];
  setAcknowledgedWarnings: Dispatch<SetStateAction<AdminCourierAssignmentWarning[]>>;
  warningsAcknowledged: boolean;
  canAssignSensitive: boolean;
  canUpdateSensitive: boolean;
  pending: boolean;
  onOperation: (input: CourierOperationInput) => void;
  whatsappPending: boolean;
  whatsappPreview: AdminCourierWhatsAppPreview | null;
  onPreviewWhatsApp: () => void;
  onCopyWhatsApp: () => void;
}) {
  const { t } = useTranslation();
  const selectedOption = options.find((option) => option.id === selectedCourierId);
  const isReassignment = Boolean(delivery.courier);
  const sameCourier = delivery.courier?.id === selectedCourierId;
  return (
    <section
      className="admin-panel admin-courier-delivery-detail"
      aria-labelledby="courier-delivery-detail-title"
    >
      <div className="admin-delivery-section__heading">
        <div>
          <span className="admin-delivery-record__eyebrow">
            {t('admin.deliveryOps.deliveryWorkspace')}
          </span>
          <h2 id="courier-delivery-detail-title">
            {delivery.orderNumber} ·{' '}
            {t(`admin.deliveryOps.statuses.${delivery.status}`, { defaultValue: delivery.status })}
          </h2>
          <p className="admin-delivery-section__intro">
            {t('admin.deliveryOps.expectedCod')}: <Price millimes={delivery.expectedCodMillimes} />{' '}
            · {t('admin.deliveryOps.currentCourier')}:{' '}
            {delivery.courier ? `${delivery.courier.code} · ${delivery.courier.name}` : '—'}
          </p>
        </div>
      </div>

      <div className="admin-courier-detail-grid">
        <section className="admin-courier-operation-card" aria-labelledby="assignment-title">
          <h3 id="assignment-title">{t('admin.deliveryOps.assignmentTitle')}</h3>
          <p>{t('admin.deliveryOps.assignmentHint')}</p>
          <form
            className="admin-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const courierId = textEntry(form, 'courierId');
              if (!courierId || sameCourier || !selectedOption) return;
              const warnings = selectedOption.warnings.filter((warning) =>
                acknowledgedWarnings.includes(warning),
              );
              const reason = textEntry(form, 'reason');
              onOperation({
                run: () =>
                  isReassignment
                    ? adminDataClient.reassignDelivery(
                        delivery,
                        courierId,
                        reason,
                        warnings,
                        optionalText(form, 'trackingNumber'),
                        optionalText(form, 'note'),
                      )
                    : adminDataClient.assignDelivery(
                        delivery,
                        courierId,
                        warnings,
                        optionalText(form, 'trackingNumber'),
                        optionalText(form, 'note'),
                      ),
                success: t(
                  isReassignment
                    ? 'admin.deliveryOps.deliveryReassigned'
                    : 'admin.deliveryOps.deliveryAssigned',
                ),
                after: () => {
                  setSelectedCourierId('');
                  setAcknowledgedWarnings([]);
                },
              });
            }}
          >
            <SelectField
              name="courierId"
              label={t('admin.deliveryOps.activeCourier')}
              value={selectedCourierId}
              disabled={!canAssignSensitive || pending}
              onChange={(event) => setSelectedCourierId(event.currentTarget.value)}
              required
            >
              <option value="">—</option>
              {options.map((option) => (
                <option key={option.id} value={option.id} disabled={!option.assignable}>
                  {option.code} · {option.name} · {option.activeDeliveryCount}/
                  {option.maximumActiveDeliveries ?? '∞'}
                  {!option.assignable
                    ? ` · ${t('admin.deliveryOps.availabilityStatuses.OFF_DUTY')}`
                    : ''}
                </option>
              ))}
            </SelectField>
            {selectedOption ? (
              <p className="admin-courier-capacity" role="status">
                {t('admin.deliveryOps.assignmentCapacity', {
                  active: selectedOption.activeDeliveryCount,
                  maximum: selectedOption.maximumActiveDeliveries ?? '∞',
                })}
              </p>
            ) : null}
            {selectedOption?.warnings.length ? (
              <fieldset className="admin-courier-warnings">
                <legend>{t('admin.deliveryOps.assignmentWarnings')}</legend>
                <p>{t('admin.deliveryOps.assignmentWarningsHint')}</p>
                {selectedOption.warnings.map((warning) => (
                  <CheckboxField
                    key={warning}
                    checked={acknowledgedWarnings.includes(warning)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setAcknowledgedWarnings((current) =>
                        checked
                          ? [...current, warning]
                          : current.filter((item) => item !== warning),
                      );
                    }}
                    label={t(`admin.deliveryOps.assignmentWarningLabels.${warning}`)}
                  />
                ))}
              </fieldset>
            ) : null}
            {isReassignment ? (
              <TextareaField
                name="reason"
                label={t('admin.deliveryOps.reassignmentReason')}
                minLength={4}
                maxLength={1_000}
                rows={3}
                disabled={!canAssignSensitive || pending}
                required
              />
            ) : null}
            <FormField
              name="trackingNumber"
              label={t('admin.deliveryOps.trackingNumberOptional')}
              defaultValue={delivery.trackingNumber ?? ''}
              maxLength={120}
              disabled={!canAssignSensitive || pending}
            />
            <TextareaField
              name="note"
              label={t('admin.deliveryOps.assignmentNoteOptional')}
              maxLength={1_000}
              rows={2}
              disabled={!canAssignSensitive || pending}
            />
            <Button
              type="submit"
              variant="admin"
              loading={pending}
              disabled={
                !canAssignSensitive ||
                pending ||
                !selectedCourierId ||
                !selectedOption?.assignable ||
                sameCourier ||
                !warningsAcknowledged
              }
            >
              {t(isReassignment ? 'admin.deliveryOps.reassign' : 'admin.deliveryOps.assign')}
            </Button>
          </form>
          {delivery.courier ? (
            <form
              className="admin-courier-unassign"
              onSubmit={(event) => {
                event.preventDefault();
                const element = event.currentTarget;
                const form = new FormData(element);
                onOperation({
                  run: () => adminDataClient.unassignDelivery(delivery, textEntry(form, 'reason')),
                  success: t('admin.deliveryOps.deliveryUnassigned'),
                  after: () => element.reset(),
                });
              }}
            >
              <TextareaField
                name="reason"
                label={t('admin.deliveryOps.unassignmentReason')}
                minLength={4}
                maxLength={1_000}
                rows={2}
                disabled={!canAssignSensitive || pending}
                required
              />
              <Button
                type="submit"
                variant="danger"
                loading={pending}
                disabled={!canAssignSensitive || pending}
              >
                {t('admin.deliveryOps.unassign')}
              </Button>
            </form>
          ) : null}
        </section>

        <section className="admin-courier-operation-card" aria-labelledby="courier-contact-title">
          <h3 id="courier-contact-title">
            <MessageCircle aria-hidden="true" size={18} /> {t('admin.deliveryOps.whatsappTitle')}
          </h3>
          <p>{t('admin.deliveryOps.whatsappBody')}</p>
          <Button
            type="button"
            variant="ghost"
            loading={whatsappPending}
            disabled={!delivery.courier || whatsappPending}
            onClick={onPreviewWhatsApp}
          >
            {t('admin.deliveryOps.previewWhatsApp')}
          </Button>
          {whatsappPreview ? (
            <div className="admin-courier-whatsapp-preview">
              <span className="admin-delivery-status" data-status="ready">
                {t('admin.deliveryOps.manualOnly')}
              </span>
              <p>
                <strong>{whatsappPreview.courierName}</strong> · {whatsappPreview.phoneE164}
              </p>
              <pre>{whatsappPreview.renderedMessage}</pre>
              <div className="admin-delivery-actions">
                <Button type="button" variant="ghost" onClick={onCopyWhatsApp}>
                  <Clipboard aria-hidden="true" size={17} /> {t('admin.deliveryOps.copyMessage')}
                </Button>
                <a
                  className="button button--admin"
                  href={whatsappPreview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink aria-hidden="true" size={17} />{' '}
                  {t('admin.deliveryOps.openWhatsApp')}
                </a>
                <Button
                  type="button"
                  variant="admin"
                  loading={pending}
                  disabled={!canUpdateSensitive || pending}
                  onClick={() =>
                    onOperation({
                      run: () => adminDataClient.recordCourierWhatsAppContact(delivery),
                      success: t('admin.deliveryOps.whatsappContactRecorded'),
                    })
                  }
                >
                  {t('admin.deliveryOps.recordWhatsAppContact')}
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="admin-courier-operation-card" aria-labelledby="internal-notes-title">
          <h3 id="internal-notes-title">{t('admin.deliveryOps.internalNotesTitle')}</h3>
          <p>{t('admin.deliveryOps.internalNotesHint')}</p>
          <form
            className="admin-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const internalNotes = nullableText(
                new FormData(event.currentTarget),
                'internalNotes',
              );
              onOperation({
                run: () => adminDataClient.updateDeliveryInternalNotes(delivery, internalNotes),
                success: t('admin.deliveryOps.internalNotesSaved'),
              });
            }}
          >
            <TextareaField
              name="internalNotes"
              label={t('admin.deliveryOps.notes')}
              defaultValue={delivery.internalNotes ?? ''}
              maxLength={2_000}
              rows={5}
              disabled={!canUpdateSensitive || pending}
            />
            <Button
              type="submit"
              variant="admin"
              loading={pending}
              disabled={!canUpdateSensitive || pending}
            >
              {t('admin.deliveryOps.saveInternalNotes')}
            </Button>
          </form>
        </section>

        <section className="admin-courier-operation-card" aria-labelledby="delivery-state-title">
          <h3 id="delivery-state-title">{t('admin.deliveryOps.deliveryStateTitle')}</h3>
          <p>{t('admin.deliveryOps.deliveryStateHint')}</p>
          <form
            className="admin-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const target = textEntry(form, 'targetStatus');
              if (!target) return;
              onOperation({
                run: () =>
                  adminDataClient.transitionDelivery(
                    delivery,
                    target,
                    optionalText(form, 'explanation'),
                  ),
                success: t('admin.deliveryOps.deliveryTransitioned'),
              });
            }}
          >
            <SelectField
              name="targetStatus"
              label={t('admin.deliveryOps.operationalTransition')}
              disabled={!canUpdateSensitive || pending}
              required
            >
              <option value="">—</option>
              {operationalDeliveryTargets.map((status) => (
                <option key={status} value={status}>
                  {t(`admin.deliveryOps.statuses.${status}`)}
                </option>
              ))}
            </SelectField>
            <TextareaField
              name="explanation"
              label={t('admin.deliveryOps.explanation')}
              maxLength={1_000}
              rows={2}
              disabled={!canUpdateSensitive || pending}
            />
            <Button
              type="submit"
              variant="admin"
              loading={pending}
              disabled={!canUpdateSensitive || pending}
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
              if (!outcome) return;
              onOperation({
                run: () =>
                  adminDataClient.recordDeliveryAttempt(
                    delivery,
                    outcome,
                    textEntry(form, 'explanation'),
                  ),
                success: t('admin.deliveryOps.attemptRecorded'),
              });
            }}
          >
            <SelectField
              name="outcome"
              label={t('admin.deliveryOps.attemptOutcome')}
              disabled={!canUpdateSensitive || pending}
              required
            >
              {attemptOutcomes.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {t(`admin.deliveryOps.outcomes.${outcome}`)}
                </option>
              ))}
            </SelectField>
            <TextareaField
              name="explanation"
              label={t('admin.deliveryOps.explanation')}
              maxLength={1_000}
              rows={2}
              disabled={!canUpdateSensitive || pending}
            />
            <Button
              type="submit"
              variant="ghost"
              loading={pending}
              disabled={!canUpdateSensitive || pending}
            >
              {t('admin.deliveryOps.recordAttempt')}
            </Button>
          </form>
          <Button
            type="button"
            variant="admin"
            loading={pending}
            disabled={
              !canUpdateSensitive ||
              pending ||
              (delivery.paymentStatus !== 'CASH_COLLECTED_BY_COURIER' &&
                delivery.paymentStatus !== 'CASH_COLLECTED_AT_STORE')
            }
            onClick={() =>
              onOperation({
                run: () =>
                  adminDataClient.completeDelivery(
                    delivery,
                    delivery.ageVerificationRequired ? 'PASSED' : 'NOT_REQUIRED',
                  ),
                success: t('admin.deliveryOps.deliveryCompleted'),
              })
            }
          >
            {t('admin.deliveryOps.completeDelivery')}
          </Button>
        </section>
      </div>
    </section>
  );
}

function CourierError({ error }: { error: Error }) {
  const { t } = useTranslation();
  const alertRef = useRef<HTMLElement>(null);
  const apiError = error instanceof ApiError ? error : null;
  useEffect(() => alertRef.current?.focus(), [error]);
  return (
    <section ref={alertRef} className="admin-form-error" role="alert" tabIndex={-1}>
      <AlertTriangle aria-hidden="true" size={20} />
      <div>
        <strong>{t('admin.deliveryOps.errors.title')}</strong>
        <p>{apiError?.message ?? t('admin.deliveryOps.errors.fallback')}</p>
        {apiError?.requestId ? (
          <small>
            {t('admin.deliveryOps.requestReference', { requestId: apiError.requestId })}
          </small>
        ) : null}
      </div>
    </section>
  );
}
