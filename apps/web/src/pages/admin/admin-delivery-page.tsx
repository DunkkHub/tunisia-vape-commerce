import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
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
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { adminDataClient } from '../../api/admin-data-client';
import { ApiError } from '../../api/http';
import type {
  AdminCourierStatus,
  AdminCsvDownload,
  AdminDeliveryZoneConfig,
  AdminDeliveryRateConfig,
  AdminDeliveryManifestStatus,
  AdminDeliveryStatusImportResult,
  GeographyOption,
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

const optionalInteger = (form: FormData, key: string): number | undefined => {
  const value = textEntry(form, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
};

const nullableInteger = (form: FormData, key: string): number | null => {
  const value = textEntry(form, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
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
  section?: DeliveryConfigurationSection;
}

interface ExportInput {
  run: () => Promise<AdminCsvDownload>;
  success: string;
}

type DeliveryGeographyScope = 'GOVERNORATE' | 'DELEGATION' | 'LOCALITY';
type DeliveryConfigurationSection = 'zone' | 'geography' | 'rate' | 'pickup';
type DeliveryWorkspace = 'configuration' | 'operations' | 'tools';

const deliveryErrorMessageKeys: Record<string, string> = {
  RECENT_AUTHENTICATION_REQUIRED: 'admin.deliveryOps.errors.recentAuthenticationRequired',
  DELIVERY_ZONE_CODE_CONFLICT: 'admin.deliveryOps.errors.zoneCodeConflict',
  PICKUP_CODE_CONFLICT: 'admin.deliveryOps.errors.pickupCodeConflict',
  DELIVERY_GEOGRAPHY_EMPTY: 'admin.deliveryOps.errors.geographyEmpty',
  DELIVERY_GEOGRAPHY_TOO_LARGE: 'admin.deliveryOps.errors.geographyTooLarge',
  DELIVERY_ZONE_GEOGRAPHY_MISSING: 'admin.deliveryOps.errors.zoneGeographyMissing',
  DELIVERY_ZONE_RATE_MISSING: 'admin.deliveryOps.errors.zoneRateMissing',
  DELIVERY_ZONE_VERSION_CONFLICT: 'admin.deliveryOps.errors.versionConflict',
  DELIVERY_ZONE_AMOUNT_INVALID: 'admin.deliveryOps.errors.zoneAmountInvalid',
  DELIVERY_ZONE_ESTIMATE_INVALID: 'admin.deliveryOps.errors.zoneEstimateInvalid',
  DELIVERY_ZONE_ESTIMATE_UNIT_INVALID: 'admin.deliveryOps.errors.zoneEstimateUnitInvalid',
  BIZERTE_EXPRESS_CONFIGURATION_INVALID: 'admin.deliveryOps.errors.bizerteConfigurationInvalid',
  BIZERTE_EXPRESS_EXPLICIT_COVERAGE_REQUIRED:
    'admin.deliveryOps.errors.bizerteExplicitCoverageRequired',
  BIZERTE_EXPRESS_COVERAGE_INVALID: 'admin.deliveryOps.errors.bizerteCoverageInvalid',
  DELIVERY_RATE_VERSION_CONFLICT: 'admin.deliveryOps.errors.versionConflict',
  PICKUP_LOCATION_VERSION_CONFLICT: 'admin.deliveryOps.errors.versionConflict',
  DELIVERY_RATE_AMBIGUOUS: 'admin.deliveryOps.errors.rateAmbiguous',
  DELIVERY_RATE_AMOUNT_INVALID: 'admin.deliveryOps.errors.rateAmountInvalid',
  DELIVERY_RATE_FREE_CONFIGURATION_REQUIRED:
    'admin.deliveryOps.errors.rateFreeConfigurationRequired',
  DELIVERY_RATE_DATES_INVALID: 'admin.deliveryOps.errors.rateDatesInvalid',
  DELIVERY_RATE_BOUNDS_INVALID: 'admin.deliveryOps.errors.rateBoundsInvalid',
  DELIVERY_RATE_SCOPE_INVALID: 'admin.deliveryOps.errors.rateScopeInvalid',
  DELIVERY_GEOGRAPHY_UNAVAILABLE: 'admin.deliveryOps.errors.geographyUnavailable',
  INVENTORY_LOCATION_UNAVAILABLE: 'admin.deliveryOps.errors.inventoryLocationUnavailable',
  ACTIVE_DELIVERY_ZONE_GEOGRAPHY_REQUIRED: 'admin.deliveryOps.errors.activeZoneGeographyRequired',
  ACTIVE_DELIVERY_ZONE_RATE_REQUIRED: 'admin.deliveryOps.errors.activeZoneRateRequired',
};

function DeliveryConfigurationError({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  const alertRef = useRef<HTMLElement>(null);
  const apiError = error instanceof ApiError ? error : null;
  const messageKey = apiError ? deliveryErrorMessageKeys[apiError.code] : undefined;
  const message =
    apiError?.code === 'VALIDATION_ERROR'
      ? t('admin.deliveryOps.errors.validation')
      : messageKey
        ? t(messageKey)
        : apiError?.message || t('admin.deliveryOps.errors.fallback');

  useEffect(() => {
    alertRef.current?.focus();
  }, [error]);

  return (
    <section ref={alertRef} className="admin-form-error" role="alert" tabIndex={-1}>
      <AlertTriangle aria-hidden="true" size={20} />
      <div>
        <strong>{t('admin.deliveryOps.errors.title')}</strong>
        <p>{message}</p>
        {apiError?.requestId ? (
          <small>
            {t('admin.deliveryOps.requestReference', { requestId: apiError.requestId })}
          </small>
        ) : null}
      </div>
    </section>
  );
}

const uppercaseCodeInput = (event: FormEvent<HTMLInputElement>) => {
  event.currentTarget.value = event.currentTarget.value.toUpperCase();
};

type DeliveryZonePreset = 'STANDARD_COD' | 'BIZERTE_EXPRESS';

const setFormControlValue = (form: HTMLFormElement, name: string, value: string | boolean) => {
  const control = form.elements.namedItem(name);
  if (control instanceof HTMLInputElement) {
    if (control.type === 'checkbox') control.checked = Boolean(value);
    else control.value = String(value);
  } else if (control instanceof HTMLSelectElement) {
    control.value = String(value);
  }
};

const applyDeliveryZonePreset = (form: HTMLFormElement, preset: DeliveryZonePreset) => {
  setFormControlValue(form, 'code', preset);
  setFormControlValue(form, 'paymentMethod', 'CASH_ON_DELIVERY');
  setFormControlValue(form, 'assignmentMode', 'MANUAL');
  if (preset === 'STANDARD_COD') {
    setFormControlValue(form, 'estimatedMinDays', '1');
    setFormControlValue(form, 'estimatedMaxDays', '3');
    setFormControlValue(form, 'estimatedMinMinutes', '');
    setFormControlValue(form, 'estimatedMaxMinutes', '');
    setFormControlValue(form, 'driverCommunication', '');
    setFormControlValue(form, 'phoneConfirmationRequired', true);
  } else {
    setFormControlValue(form, 'estimatedMinDays', '');
    setFormControlValue(form, 'estimatedMaxDays', '');
    setFormControlValue(form, 'estimatedMinMinutes', '30');
    setFormControlValue(form, 'estimatedMaxMinutes', '50');
    setFormControlValue(form, 'driverCommunication', 'WHATSAPP');
    setFormControlValue(form, 'phoneConfirmationRequired', false);
  }
  form.dispatchEvent(new Event('input', { bubbles: true }));
};

const isBizerteGeographyOption = (option: GeographyOption): boolean => {
  const normalized = option.name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-TN');
  return normalized.includes('bizerte') || normalized.includes('بنزرت');
};

const MAX_DELIVERY_RATE_MILLIMES = 1_000_000;

type DeliveryRateAmountError = 'required' | 'format' | 'precision' | 'nonNegative' | 'maximum';

type DeliveryRateAmountResult =
  { feeMillimes: number; error: null } | { feeMillimes: null; error: DeliveryRateAmountError };

const deliveryRateAmountErrorKeys: Record<DeliveryRateAmountError, string> = {
  required: 'admin.deliveryOps.errors.rateAmountRequired',
  format: 'admin.deliveryOps.errors.rateAmountFormat',
  precision: 'admin.deliveryOps.errors.rateAmountPrecision',
  nonNegative: 'admin.deliveryOps.errors.rateAmountNonNegative',
  maximum: 'admin.deliveryOps.errors.rateAmountMaximum',
};

function parseDeliveryRateTnd(value: string): DeliveryRateAmountResult {
  const normalized = value.trim();
  if (!normalized) return { feeMillimes: null, error: 'required' };
  if (normalized.startsWith('-')) return { feeMillimes: null, error: 'nonNegative' };

  const match = /^(\d+)(?:[.,](\d+))?$/.exec(normalized);
  if (!match) return { feeMillimes: null, error: 'format' };
  const whole = match[1];
  if (!whole) return { feeMillimes: null, error: 'format' };
  const fraction = match[2] ?? '';
  if (fraction.length > 3) return { feeMillimes: null, error: 'precision' };

  const feeMillimes = BigInt(whole) * 1_000n + BigInt((fraction || '0').padEnd(3, '0'));
  if (feeMillimes > BigInt(MAX_DELIVERY_RATE_MILLIMES)) {
    return { feeMillimes: null, error: 'maximum' };
  }
  return { feeMillimes: Number(feeMillimes), error: null };
}

function formatDeliveryRateTnd(feeMillimes: number): string {
  const dinars = Math.floor(feeMillimes / 1_000);
  const millimes = (feeMillimes % 1_000).toString().padStart(3, '0');
  return `${dinars},${millimes}`;
}

function DeliveryRateEditor({
  rate,
  canUpdateSensitive,
}: {
  rate: AdminDeliveryRateConfig;
  canUpdateSensitive: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [amountDraft, setAmountDraft] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState('');
  const [requestReference, setRequestReference] = useState('');
  const [requestFailure, setRequestFailure] = useState('');
  const [success, setSuccess] = useState('');
  const amountTnd = amountDraft ?? formatDeliveryRateTnd(rate.feeMillimes);
  const parsedAmount = parseDeliveryRateTnd(amountTnd);

  const updateRate = useMutation({
    mutationFn: (feeMillimes: number) => adminDataClient.updateDeliveryRate(rate, { feeMillimes }),
    onMutate: () => {
      setFieldError('');
      setRequestReference('');
      setRequestFailure('');
      setSuccess('');
    },
    onSuccess: async (updatedRate) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof adminDataClient.deliveryRates>>>(
        ['admin', 'delivery-config', 'rates'],
        (current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) =>
                  item.id === updatedRate.id ? updatedRate : item,
                ),
              }
            : current,
      );
      setAmountDraft(null);
      setSuccess(t('admin.deliveryOps.rateAmountSaved'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'delivery-config'] }),
        queryClient.invalidateQueries({ queryKey: ['delivery'] }),
        queryClient.invalidateQueries({ queryKey: ['checkout'] }),
        queryClient.invalidateQueries({ queryKey: ['storefront'] }),
      ]);
    },
    onError: (error) => {
      const apiError = error instanceof ApiError ? error : null;
      setRequestReference(apiError?.requestId ?? '');
      if (apiError?.code === 'DELIVERY_RATE_VERSION_CONFLICT') {
        setFieldError(t('admin.deliveryOps.errors.versionConflict'));
        void queryClient.invalidateQueries({
          queryKey: ['admin', 'delivery-config', 'rates'],
        });
      } else if (
        apiError?.code === 'DELIVERY_RATE_AMOUNT_INVALID' ||
        apiError?.code === 'VALIDATION_ERROR'
      ) {
        setFieldError(t('admin.deliveryOps.errors.rateAmountInvalid'));
      } else {
        const messageKey = apiError ? deliveryErrorMessageKeys[apiError.code] : undefined;
        setRequestFailure(messageKey ? t(messageKey) : t('admin.deliveryOps.errors.fallback'));
      }
      window.setTimeout(() => inputRef.current?.focus(), 0);
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuccess('');
    setRequestFailure('');
    setRequestReference('');
    if (parsedAmount.error) {
      setFieldError(t(deliveryRateAmountErrorKeys[parsedAmount.error]));
      inputRef.current?.focus();
      return;
    }
    updateRate.mutate(parsedAmount.feeMillimes);
  };

  return (
    <form
      className="admin-form-grid"
      aria-label={t('admin.deliveryOps.editRateForm', { name: rate.name })}
      onSubmit={submit}
    >
      <FormField
        ref={inputRef}
        name={`rate-${rate.id}-amountTnd`}
        label={t('admin.deliveryOps.amountTnd')}
        hint={t('admin.deliveryOps.amountTndHint')}
        value={amountTnd}
        inputMode="decimal"
        autoComplete="off"
        maxLength={24}
        spellCheck={false}
        error={fieldError || undefined}
        disabled={!canUpdateSensitive || updateRate.isPending}
        onChange={(event) => {
          const nextValue = event.target.value;
          const nextParsed = parseDeliveryRateTnd(nextValue);
          setAmountDraft(nextValue);
          setSuccess('');
          setRequestFailure('');
          setRequestReference('');
          if (fieldError) {
            setFieldError(nextParsed.error ? t(deliveryRateAmountErrorKeys[nextParsed.error]) : '');
          }
        }}
        required
      />
      {parsedAmount.error ? null : (
        <p className="field__hint" aria-live="polite">
          <Price millimes={parsedAmount.feeMillimes} /> ·{' '}
          {t('admin.deliveryOps.rateAmountPreview', {
            millimes: parsedAmount.feeMillimes,
          })}
        </p>
      )}
      {fieldError && requestReference ? (
        <small className="field__hint">
          {t('admin.deliveryOps.requestReference', { requestId: requestReference })}
        </small>
      ) : null}
      {requestFailure ? (
        <div className="form-banner form-banner--error" role="alert">
          <AlertTriangle aria-hidden="true" size={18} />
          <span>
            {requestFailure}
            {requestReference ? (
              <small>
                {' '}
                {t('admin.deliveryOps.requestReference', { requestId: requestReference })}
              </small>
            ) : null}
          </span>
        </div>
      ) : null}
      {success ? (
        <p className="form-banner form-banner--success" role="status" aria-live="polite">
          {success}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="admin"
        loading={updateRate.isPending}
        disabled={
          !canUpdateSensitive ||
          updateRate.isPending ||
          (!parsedAmount.error && parsedAmount.feeMillimes === rate.feeMillimes)
        }
      >
        {t('admin.deliveryOps.saveRateAmount')}
      </Button>
    </form>
  );
}

function DeliveryZonePresetButtons({
  disabled,
  onApply,
}: {
  disabled: boolean;
  onApply: (preset: DeliveryZonePreset) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="field field--wide">
      <strong>{t('admin.deliveryOps.zonePresetTitle')}</strong>
      <p className="field__hint">{t('admin.deliveryOps.zonePresetHint')}</p>
      <div className="admin-heading-actions">
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={() => onApply('STANDARD_COD')}
        >
          {t('admin.deliveryOps.applyStandardCod')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={() => onApply('BIZERTE_EXPRESS')}
        >
          {t('admin.deliveryOps.applyBizerteExpress')}
        </Button>
      </div>
    </div>
  );
}

function DeliveryZoneEditor({
  zone,
  canUpdateSensitive,
}: {
  zone: AdminDeliveryZoneConfig;
  canUpdateSensitive: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [success, setSuccess] = useState('');
  const updateZone = useMutation({
    mutationFn: (payload: Parameters<typeof adminDataClient.updateDeliveryZone>[1]) =>
      adminDataClient.updateDeliveryZone(zone, payload),
    onMutate: () => {
      setSuccess('');
    },
    onSuccess: async (updatedZone) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof adminDataClient.deliveryZones>>>(
        ['admin', 'delivery-config', 'zones'],
        (current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) =>
                  item.id === updatedZone.id ? updatedZone : item,
                ),
              }
            : current,
      );
      setSuccess(t('admin.deliveryOps.zoneDetailsUpdated'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'delivery-config'] }),
        queryClient.invalidateQueries({ queryKey: ['delivery'] }),
        queryClient.invalidateQueries({ queryKey: ['checkout'] }),
        queryClient.invalidateQueries({ queryKey: ['storefront'] }),
      ]);
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    updateZone.mutate({
      code: textEntry(form, 'code').toUpperCase(),
      nameFr: textEntry(form, 'nameFr'),
      nameAr: textEntry(form, 'nameAr'),
      priority: optionalInteger(form, 'priority') ?? zone.priority,
      estimatedMinDays: nullableInteger(form, 'estimatedMinDays'),
      estimatedMaxDays: nullableInteger(form, 'estimatedMaxDays'),
      estimatedMinMinutes: nullableInteger(form, 'estimatedMinMinutes'),
      estimatedMaxMinutes: nullableInteger(form, 'estimatedMaxMinutes'),
      paymentMethod:
        textEntry(form, 'paymentMethod') === 'CASH_ON_DELIVERY' ? 'CASH_ON_DELIVERY' : null,
      assignmentMode: textEntry(form, 'assignmentMode') === 'MANUAL' ? 'MANUAL' : null,
      driverCommunication:
        textEntry(form, 'driverCommunication') === 'WHATSAPP'
          ? 'WHATSAPP'
          : textEntry(form, 'driverCommunication') === 'PHONE'
            ? 'PHONE'
            : null,
      phoneConfirmationRequired: form.get('phoneConfirmationRequired') === 'on',
      manualReviewRequired: form.get('manualReviewRequired') === 'on',
    });
  };

  return (
    <form
      ref={formRef}
      className="admin-form-grid"
      aria-label={t('admin.deliveryOps.zoneEditForm', { code: zone.code })}
      onInput={() => {
        updateZone.reset();
        setSuccess('');
      }}
      onSubmit={submit}
    >
      <DeliveryZonePresetButtons
        disabled={!canUpdateSensitive || updateZone.isPending}
        onApply={(preset) => {
          if (formRef.current) applyDeliveryZonePreset(formRef.current, preset);
        }}
      />
      <FormField
        name="code"
        label={t('admin.deliveryOps.configurationCode')}
        defaultValue={zone.code}
        pattern="[A-Z0-9]+(?:[_-][A-Z0-9]+)*"
        maxLength={80}
        autoCapitalize="characters"
        spellCheck={false}
        onInput={uppercaseCodeInput}
        disabled={!canUpdateSensitive || updateZone.isPending}
        required
      />
      <FormField
        name="nameFr"
        label={t('admin.deliveryOps.nameFr')}
        defaultValue={zone.nameFr}
        maxLength={160}
        disabled={!canUpdateSensitive || updateZone.isPending}
        required
      />
      <FormField
        name="nameAr"
        label={t('admin.deliveryOps.nameAr')}
        defaultValue={zone.nameAr}
        dir="rtl"
        maxLength={160}
        disabled={!canUpdateSensitive || updateZone.isPending}
        required
      />
      <FormField
        name="priority"
        type="number"
        defaultValue={zone.priority}
        min={-1_000_000}
        max={1_000_000}
        label={t('admin.deliveryOps.priority')}
        disabled={!canUpdateSensitive || updateZone.isPending}
        required
      />
      <FormField
        name="estimatedMinDays"
        type="number"
        defaultValue={zone.estimatedMinDays ?? ''}
        min={0}
        max={365}
        label={t('admin.deliveryOps.estimatedMinDays')}
        disabled={!canUpdateSensitive || updateZone.isPending}
      />
      <FormField
        name="estimatedMaxDays"
        type="number"
        defaultValue={zone.estimatedMaxDays ?? ''}
        min={0}
        max={365}
        label={t('admin.deliveryOps.estimatedMaxDays')}
        disabled={!canUpdateSensitive || updateZone.isPending}
      />
      <FormField
        name="estimatedMinMinutes"
        type="number"
        defaultValue={zone.estimatedMinMinutes ?? ''}
        min={1}
        max={10_080}
        label={t('admin.deliveryOps.estimatedMinMinutes')}
        disabled={!canUpdateSensitive || updateZone.isPending}
      />
      <FormField
        name="estimatedMaxMinutes"
        type="number"
        defaultValue={zone.estimatedMaxMinutes ?? ''}
        min={1}
        max={10_080}
        label={t('admin.deliveryOps.estimatedMaxMinutes')}
        disabled={!canUpdateSensitive || updateZone.isPending}
      />
      <SelectField
        name="paymentMethod"
        label={t('admin.deliveryOps.paymentMethod')}
        defaultValue={zone.paymentMethod ?? ''}
        disabled={!canUpdateSensitive || updateZone.isPending}
      >
        <option value="">—</option>
        <option value="CASH_ON_DELIVERY">
          {t('admin.deliveryOps.paymentMethods.CASH_ON_DELIVERY')}
        </option>
      </SelectField>
      <SelectField
        name="assignmentMode"
        label={t('admin.deliveryOps.assignmentMode')}
        defaultValue={zone.assignmentMode ?? ''}
        disabled={!canUpdateSensitive || updateZone.isPending}
      >
        <option value="">—</option>
        <option value="MANUAL">{t('admin.deliveryOps.assignmentModes.MANUAL')}</option>
      </SelectField>
      <SelectField
        name="driverCommunication"
        label={t('admin.deliveryOps.driverCommunication')}
        defaultValue={zone.driverCommunication ?? ''}
        disabled={!canUpdateSensitive || updateZone.isPending}
      >
        <option value="">—</option>
        <option value="WHATSAPP">{t('admin.deliveryOps.communicationChannels.WHATSAPP')}</option>
        <option value="PHONE">{t('admin.deliveryOps.communicationChannels.PHONE')}</option>
      </SelectField>
      <CheckboxField
        name="phoneConfirmationRequired"
        defaultChecked={zone.phoneConfirmationRequired}
        disabled={!canUpdateSensitive || updateZone.isPending}
        label={t('admin.deliveryOps.phoneConfirmationRequired')}
      />
      <CheckboxField
        name="manualReviewRequired"
        defaultChecked={zone.manualReviewRequired}
        disabled={!canUpdateSensitive || updateZone.isPending}
        label={t('admin.deliveryOps.manualReviewRequired')}
      />
      <Button
        type="submit"
        variant="admin"
        loading={updateZone.isPending}
        disabled={!canUpdateSensitive || updateZone.isPending}
      >
        {t('admin.deliveryOps.saveZoneDetails')}
      </Button>
      {success ? (
        <p className="form-banner form-banner--success" role="status" aria-live="polite">
          {success}
        </p>
      ) : null}
      {updateZone.error ? <DeliveryConfigurationError error={updateZone.error} /> : null}
    </form>
  );
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
  const [workspace, setWorkspace] = useState<DeliveryWorkspace>('configuration');
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<string[]>([]);
  const [selectedManifestId, setSelectedManifestId] = useState('');
  const [manifestTarget, setManifestTarget] = useState('');
  const [geographyScope, setGeographyScope] = useState<DeliveryGeographyScope>('GOVERNORATE');
  const [selectedGeographyZoneId, setSelectedGeographyZoneId] = useState('');
  const [governorateId, setGovernorateId] = useState('');
  const [delegationId, setDelegationId] = useState('');
  const [localityId, setLocalityId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [feedbackSection, setFeedbackSection] = useState<DeliveryConfigurationSection | null>(null);
  const [courierFeedback, setCourierFeedback] = useState('');
  const zoneFormRef = useRef<HTMLFormElement>(null);
  const rateFormRef = useRef<HTMLFormElement>(null);
  const courierFormRef = useRef<HTMLFormElement>(null);
  const createRateAmountRef = useRef<HTMLInputElement>(null);
  const [createRateAmountTnd, setCreateRateAmountTnd] = useState('');
  const [createRateAmountError, setCreateRateAmountError] = useState('');
  const parsedCreateRateAmount = parseDeliveryRateTnd(createRateAmountTnd);
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
  const governorates = useQuery({
    queryKey: ['admin', 'delivery-config', 'geography', 'governorates'],
    queryFn: adminDataClient.deliveryGeographyGovernorates,
  });
  const delegations = useQuery({
    queryKey: ['admin', 'delivery-config', 'geography', 'delegations', governorateId],
    queryFn: () => adminDataClient.deliveryGeographyDelegations(governorateId),
    enabled: Boolean(governorateId),
  });
  const localities = useQuery({
    queryKey: ['admin', 'delivery-config', 'geography', 'localities', delegationId],
    queryFn: () => adminDataClient.deliveryGeographyLocalities(delegationId),
    enabled: Boolean(delegationId),
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
      queryClient.invalidateQueries({ queryKey: ['delivery'] }),
      queryClient.invalidateQueries({ queryKey: ['checkout'] }),
      queryClient.invalidateQueries({ queryKey: ['storefront'] }),
    ]);
  };

  const action = useMutation({
    mutationFn: ({ run }: OperationInput) => run(),
    onMutate: () => {
      setFeedback('');
      setFeedbackSection(null);
    },
    onSuccess: (_result, variables) => {
      variables.after?.();
      setFeedback(variables.success);
      setFeedbackSection(variables.section ?? null);
      void refresh();
    },
  });
  const courierCreation = useMutation({
    mutationFn: adminDataClient.createCourierRecord,
    onMutate: () => {
      setCourierFeedback('');
    },
    onSuccess: (courier) => {
      courierFormRef.current?.reset();
      setCourierFeedback(
        t('admin.deliveryOps.courierCreatedNamed', {
          code: courier.code,
          name: courier.name,
        }),
      );
      void queryClient.invalidateQueries({ queryKey: ['admin', 'delivery', 'couriers'] });
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'delivery-operations', 'couriers'],
      });
    },
  });
  const exportAction = useMutation({
    mutationFn: ({ run }: ExportInput) => run(),
    onMutate: () => {
      setFeedback('');
      setFeedbackSection(null);
    },
    onSuccess: (result, variables) => {
      downloadCsv(result);
      setFeedbackSection(null);
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
      setFeedbackSection(null);
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
    const priority = optionalInteger(form, 'priority');
    const estimatedMinDays = optionalInteger(form, 'estimatedMinDays');
    const estimatedMaxDays = optionalInteger(form, 'estimatedMaxDays');
    const estimatedMinMinutes = optionalInteger(form, 'estimatedMinMinutes');
    const estimatedMaxMinutes = optionalInteger(form, 'estimatedMaxMinutes');
    const paymentMethod = textEntry(form, 'paymentMethod');
    const assignmentMode = textEntry(form, 'assignmentMode');
    const driverCommunication = textEntry(form, 'driverCommunication');
    action.mutate({
      run: () =>
        adminDataClient.createDeliveryZone({
          code: textEntry(form, 'code').toUpperCase(),
          nameFr: textEntry(form, 'nameFr'),
          nameAr: textEntry(form, 'nameAr'),
          ...(priority === undefined ? {} : { priority }),
          ...(estimatedMinDays === undefined ? {} : { estimatedMinDays }),
          ...(estimatedMaxDays === undefined ? {} : { estimatedMaxDays }),
          ...(estimatedMinMinutes === undefined ? {} : { estimatedMinMinutes }),
          ...(estimatedMaxMinutes === undefined ? {} : { estimatedMaxMinutes }),
          ...(paymentMethod === 'CASH_ON_DELIVERY'
            ? { paymentMethod: 'CASH_ON_DELIVERY' as const }
            : {}),
          ...(assignmentMode === 'MANUAL' ? { assignmentMode: 'MANUAL' as const } : {}),
          ...(driverCommunication === 'WHATSAPP' || driverCommunication === 'PHONE'
            ? { driverCommunication }
            : {}),
          phoneConfirmationRequired: form.get('phoneConfirmationRequired') === 'on',
          manualReviewRequired: form.get('manualReviewRequired') === 'on',
        }),
      success: t('admin.deliveryOps.zoneCreated'),
      after: () => element.reset(),
      section: 'zone',
    });
  };
  const linkGeography = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const zone = zones.data?.items.find((item) => item.id === selectedGeographyZoneId);
    const geographyId =
      geographyScope === 'GOVERNORATE'
        ? governorateId
        : geographyScope === 'DELEGATION'
          ? delegationId
          : localityId;
    if (zone && geographyId) {
      action.mutate({
        run: () =>
          adminDataClient.linkDeliveryZoneGeography(zone, geographyScope, geographyId, true),
        success: t('admin.deliveryOps.geographyLinked'),
        after: () => {
          element.reset();
          setSelectedGeographyZoneId('');
          setGeographyScope('GOVERNORATE');
          setGovernorateId('');
          setDelegationId('');
          setLocalityId('');
        },
        section: 'geography',
      });
    }
  };
  const createRate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const priority = optionalInteger(form, 'priority');
    const parsedAmount = parseDeliveryRateTnd(textEntry(form, 'feeTnd'));
    if (parsedAmount.error) {
      setCreateRateAmountError(t(deliveryRateAmountErrorKeys[parsedAmount.error]));
      createRateAmountRef.current?.focus();
      return;
    }
    action.mutate({
      run: () =>
        adminDataClient.createDeliveryRate({
          deliveryZoneId: textEntry(form, 'deliveryZoneId'),
          name: textEntry(form, 'name'),
          feeMillimes: parsedAmount.feeMillimes,
          ...(priority === undefined ? {} : { priority }),
          express: form.get('express') === 'on',
        }),
      success: t('admin.deliveryOps.rateCreated'),
      after: () => {
        element.reset();
        setCreateRateAmountTnd('');
        setCreateRateAmountError('');
      },
      section: 'rate',
    });
  };
  const createPickup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    action.mutate({
      run: () =>
        adminDataClient.createPickupLocation({
          code: textEntry(form, 'code').toUpperCase(),
          nameFr: textEntry(form, 'nameFr'),
          nameAr: textEntry(form, 'nameAr'),
          address: textEntry(form, 'address'),
        }),
      success: t('admin.deliveryOps.pickupCreated'),
      after: () => element.reset(),
      section: 'pickup',
    });
  };
  const createCourier = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const contactName = optionalText(form, 'contactName');
    const phoneE164 = optionalText(form, 'phoneE164');
    const email = optionalText(form, 'email');
    const notes = optionalText(form, 'notes');
    courierCreation.mutate({
      code: textEntry(form, 'code'),
      name: textEntry(form, 'name'),
      ...(contactName ? { contactName } : {}),
      ...(phoneE164 ? { phoneE164 } : {}),
      ...(email ? { email } : {}),
      ...(notes ? { notes } : {}),
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
    governorates,
    delegations,
    localities,
    delivery,
    couriers,
    courierRecords,
    manifests,
    manifest,
  ];
  const configurationHasError = [zones, rates, pickups, governorates, delegations, localities].some(
    (query) => query.isError,
  );
  const operationsHasError = [
    deliveries,
    delivery,
    couriers,
    courierRecords,
    manifests,
    manifest,
  ].some((query) => query.isError);
  const toolsHaveError = couriers.isError;
  const currentError =
    action.error && !action.variables?.section
      ? action.error
      : (exportAction.error ?? importAction.error);
  const loading = zones.isPending || rates.isPending || pickups.isPending;
  const importCanApply =
    canUpdateSensitive &&
    applyConfirmed &&
    dryRunApproval?.importKey === importKey &&
    dryRunApproval.csv === importCsv;
  const sectionError = (section: DeliveryConfigurationSection): Error | null =>
    action.isError && action.variables?.section === section ? action.error : null;
  const sectionFeedback = (section: DeliveryConfigurationSection): string | null =>
    action.isSuccess && feedbackSection === section ? feedback : null;
  const clearSectionError = (section: DeliveryConfigurationSection) => {
    if (action.isError && action.variables?.section === section) action.reset();
  };
  const selectedGeographyZone = zones.data?.items.find(
    (zone) => zone.id === selectedGeographyZoneId,
  );
  const isBizerteExpress = selectedGeographyZone?.code === 'BIZERTE_EXPRESS';
  const bizerteGovernorate = governorates.data?.find(isBizerteGeographyOption);
  const geographyGovernorateOptions = isBizerteExpress
    ? governorates.data?.filter(isBizerteGeographyOption)
    : governorates.data;
  const selectedGeographyId =
    geographyScope === 'GOVERNORATE'
      ? governorateId
      : geographyScope === 'DELEGATION'
        ? delegationId
        : localityId;
  const selectedGeographyIsEmpty =
    (geographyScope === 'GOVERNORATE' &&
      Boolean(governorateId) &&
      delegations.isSuccess &&
      delegations.data.length === 0) ||
    (geographyScope === 'DELEGATION' &&
      Boolean(delegationId) &&
      localities.isSuccess &&
      localities.data.length === 0);
  const selectedGeographyOption = localityId
    ? localities.data?.find((item) => item.id === localityId)
    : delegationId
      ? delegations.data?.find((item) => item.id === delegationId)
      : governorateId
        ? governorates.data?.find((item) => item.id === governorateId)
        : undefined;
  const bizerteGovernorateUnavailable =
    isBizerteExpress && governorates.isSuccess && !bizerteGovernorate;
  const bizerteSelectionInvalid =
    isBizerteExpress &&
    (geographyScope === 'GOVERNORATE' ||
      (Boolean(governorateId) && governorateId !== bizerteGovernorate?.id));
  const zoneItems = zones.data?.items ?? [];
  const activeZoneCount = zoneItems.filter((zone) => zone.active).length;
  const incompleteZoneCount = zoneItems.filter(
    (zone) => !zone.active && (zone.localityCount === 0 || zone.activeRateCount === 0),
  ).length;

  const openConfigurationStep = (
    targetId: 'delivery-zones' | 'delivery-coverage' | 'delivery-rates',
    zoneId?: string,
  ) => {
    setWorkspace('configuration');
    if (targetId === 'delivery-coverage' && zoneId) {
      setSelectedGeographyZoneId(zoneId);
      setGeographyScope(
        zoneItems.find((zone) => zone.id === zoneId)?.code === 'BIZERTE_EXPRESS'
          ? 'DELEGATION'
          : 'GOVERNORATE',
      );
      setGovernorateId('');
      setDelegationId('');
      setLocalityId('');
    }
    if (targetId === 'delivery-rates' && zoneId && rateFormRef.current) {
      setFormControlValue(rateFormRef.current, 'deliveryZoneId', zoneId);
    }
    window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
    }, 0);
  };

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

      {feedback && !feedbackSection ? (
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
      {currentError ? <DeliveryConfigurationError error={currentError} /> : null}

      <section className="admin-delivery-overview" aria-labelledby="delivery-workspace-title">
        <div className="admin-delivery-overview__heading">
          <div>
            <h2 id="delivery-workspace-title">{t('admin.deliveryOps.workspaceTitle')}</h2>
            <p>{t('admin.deliveryOps.workspaceHint')}</p>
          </div>
          <div className="admin-delivery-overview__counts" role="status" aria-live="polite">
            <span>
              <strong>{activeZoneCount}</strong> {t('admin.deliveryOps.activeZonesCount')}
            </span>
            <span>
              <strong>{incompleteZoneCount}</strong> {t('admin.deliveryOps.incompleteZonesCount')}
            </span>
          </div>
        </div>
        <nav
          className="admin-delivery-workspace-nav"
          aria-label={t('admin.deliveryOps.workspaceNav')}
        >
          <Button
            id="delivery-workspace-configuration"
            type="button"
            variant={workspace === 'configuration' ? 'admin' : 'ghost'}
            className="admin-delivery-workspace-nav__button"
            aria-current={workspace === 'configuration' ? 'page' : undefined}
            aria-controls="delivery-configuration-panel"
            onClick={() => setWorkspace('configuration')}
          >
            <MapPinned aria-hidden="true" size={20} />
            <span>
              <strong>{t('admin.deliveryOps.configurationWorkspace')}</strong>
              <small>{t('admin.deliveryOps.configurationWorkspaceHint')}</small>
            </span>
          </Button>
          <Button
            id="delivery-workspace-operations"
            type="button"
            variant={workspace === 'operations' ? 'admin' : 'ghost'}
            className="admin-delivery-workspace-nav__button"
            aria-current={workspace === 'operations' ? 'page' : undefined}
            aria-controls="delivery-operations-panel"
            onClick={() => setWorkspace('operations')}
          >
            <Truck aria-hidden="true" size={20} />
            <span>
              <strong>{t('admin.deliveryOps.operationsWorkspace')}</strong>
              <small>{t('admin.deliveryOps.operationsWorkspaceHint')}</small>
            </span>
          </Button>
          <Button
            id="delivery-workspace-tools"
            type="button"
            variant={workspace === 'tools' ? 'admin' : 'ghost'}
            className="admin-delivery-workspace-nav__button"
            aria-current={workspace === 'tools' ? 'page' : undefined}
            aria-controls="delivery-tools-panel"
            onClick={() => setWorkspace('tools')}
          >
            <FileCheck2 aria-hidden="true" size={20} />
            <span>
              <strong>{t('admin.deliveryOps.toolsWorkspace')}</strong>
              <small>{t('admin.deliveryOps.toolsWorkspaceHint')}</small>
            </span>
          </Button>
        </nav>
      </section>

      <div className="admin-stock-sections">
        <div
          id="delivery-operations-panel"
          className="admin-delivery-workspace"
          aria-labelledby="delivery-workspace-operations"
          hidden={workspace !== 'operations'}
        >
          {operationsHasError ? (
            <ErrorState
              compact
              title={t('admin.deliveryOps.operationsLoadErrorTitle')}
              body={t('admin.deliveryOps.operationsLoadErrorBody')}
              onRetry={() => void refresh()}
            />
          ) : null}
          <section className="admin-panel">
            <h2>
              <Truck aria-hidden="true" size={18} /> {t('admin.deliveryOps.inProgressTitle')}
            </h2>
            <p>{t('admin.deliveryOps.inProgressBody')}</p>
            {deliveries.isPending ? (
              <LoadingState label={t('common.loading')} tone="admin" />
            ) : null}
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
            <form ref={courierFormRef} className="admin-form-grid" onSubmit={createCourier}>
              <FormField
                name="code"
                label={t('admin.deliveryOps.code')}
                pattern="[A-Za-z0-9][A-Za-z0-9_-]+"
                minLength={2}
                maxLength={80}
                disabled={!canUpdateSensitive || courierCreation.isPending}
                error={
                  courierCreation.error instanceof ApiError &&
                  courierCreation.error.code === 'COURIER_CODE_CONFLICT'
                    ? t('admin.deliveryOps.courierCodeConflict')
                    : undefined
                }
                required
              />
              <FormField
                name="name"
                label={t('admin.deliveryOps.courierName')}
                minLength={2}
                maxLength={200}
                disabled={!canUpdateSensitive || courierCreation.isPending}
                required
              />
              <FormField
                name="contactName"
                label={t('admin.deliveryOps.contactName')}
                maxLength={160}
                disabled={!canUpdateSensitive || courierCreation.isPending}
              />
              <FormField
                name="phoneE164"
                label={t('admin.deliveryOps.phoneE164')}
                placeholder="+21612345678"
                pattern="\+[1-9][0-9]{7,14}"
                disabled={!canUpdateSensitive || courierCreation.isPending}
              />
              <FormField
                name="email"
                type="email"
                label={t('admin.deliveryOps.email')}
                maxLength={320}
                disabled={!canUpdateSensitive || courierCreation.isPending}
              />
              <FormField
                name="notes"
                label={t('admin.deliveryOps.notes')}
                maxLength={1000}
                disabled={!canUpdateSensitive || courierCreation.isPending}
              />
              <Button
                type="submit"
                variant="admin"
                loading={courierCreation.isPending}
                disabled={!canUpdateSensitive || courierCreation.isPending}
              >
                <Plus aria-hidden="true" size={17} /> {t('admin.deliveryOps.createCourier')}
              </Button>
            </form>
            {courierFeedback ? (
              <p className="form-banner form-banner--success" role="status" aria-live="polite">
                {courierFeedback}
              </p>
            ) : null}
            {courierCreation.error &&
            !(
              courierCreation.error instanceof ApiError &&
              courierCreation.error.code === 'COURIER_CODE_CONFLICT'
            ) ? (
              <p className="form-banner form-banner--error" role="alert">
                {courierCreation.error instanceof ApiError &&
                courierCreation.error.code === 'RECENT_AUTHENTICATION_REQUIRED'
                  ? t('admin.deliveryOps.recentAuthenticationRequired')
                  : courierCreation.error.message}
              </p>
            ) : null}
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
                  {courier.notes ? <p className="admin-courier-notes">{courier.notes}</p> : null}
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
              <ClipboardCheck aria-hidden="true" size={18} />{' '}
              {t('admin.deliveryOps.manifestsTitle')}
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
                disabled={
                  !canAssignSensitive || selectedDeliveryIds.length === 0 || action.isPending
                }
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
                  <Download aria-hidden="true" size={17} />{' '}
                  {t('admin.deliveryOps.downloadManifest')}
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
        </div>

        <div
          id="delivery-tools-panel"
          className="admin-delivery-workspace"
          aria-labelledby="delivery-workspace-tools"
          hidden={workspace !== 'tools'}
        >
          {toolsHaveError ? (
            <ErrorState
              compact
              title={t('admin.deliveryOps.toolsLoadErrorTitle')}
              body={t('admin.deliveryOps.toolsLoadErrorBody')}
              onRetry={() => void refresh()}
            />
          ) : null}
          <section className="admin-panel">
            <h2>
              <FileCheck2 aria-hidden="true" size={18} />{' '}
              {t('admin.deliveryOps.statusTransferTitle')}
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
                <p role="status">
                  {t('admin.deliveryOps.fileLoaded', { filename: importFilename })}
                </p>
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
        </div>

        <div
          id="delivery-configuration-panel"
          className="admin-delivery-workspace"
          aria-labelledby="delivery-workspace-configuration"
          hidden={workspace !== 'configuration'}
        >
          {configurationHasError ? (
            <ErrorState
              compact
              title={t('admin.deliveryOps.configurationLoadErrorTitle')}
              body={t('admin.deliveryOps.configurationLoadErrorBody')}
              onRetry={() => void refresh()}
            />
          ) : null}
          <section className="admin-delivery-guide" aria-labelledby="delivery-setup-title">
            <div className="admin-delivery-section__heading">
              <div>
                <span className="admin-kicker">{t('admin.deliveryOps.guidedSetup')}</span>
                <h2 id="delivery-setup-title">{t('admin.deliveryOps.setupTitle')}</h2>
                <p>{t('admin.deliveryOps.setupHint')}</p>
              </div>
            </div>
            <ol className="admin-delivery-stepper">
              <li>
                <button type="button" onClick={() => openConfigurationStep('delivery-zones')}>
                  <span className="admin-delivery-stepper__marker">1</span>
                  <span>
                    <strong>{t('admin.deliveryOps.stepZone')}</strong>
                    <small>{t('admin.deliveryOps.stepZoneHint')}</small>
                  </span>
                  <ChevronRight aria-hidden="true" size={18} />
                </button>
              </li>
              <li>
                <button type="button" onClick={() => openConfigurationStep('delivery-coverage')}>
                  <span className="admin-delivery-stepper__marker">2</span>
                  <span>
                    <strong>{t('admin.deliveryOps.stepCoverage')}</strong>
                    <small>{t('admin.deliveryOps.stepCoverageHint')}</small>
                  </span>
                  <ChevronRight aria-hidden="true" size={18} />
                </button>
              </li>
              <li>
                <button type="button" onClick={() => openConfigurationStep('delivery-rates')}>
                  <span className="admin-delivery-stepper__marker">3</span>
                  <span>
                    <strong>{t('admin.deliveryOps.stepRate')}</strong>
                    <small>{t('admin.deliveryOps.stepRateHint')}</small>
                  </span>
                  <ChevronRight aria-hidden="true" size={18} />
                </button>
              </li>
              <li>
                <button type="button" onClick={() => openConfigurationStep('delivery-zones')}>
                  <span className="admin-delivery-stepper__marker">4</span>
                  <span>
                    <strong>{t('admin.deliveryOps.stepActivation')}</strong>
                    <small>{t('admin.deliveryOps.stepActivationHint')}</small>
                  </span>
                  <ChevronRight aria-hidden="true" size={18} />
                </button>
              </li>
            </ol>
          </section>
          {loading ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
          <section id="delivery-zones" className="admin-panel admin-delivery-section">
            <h2>
              <MapPinned aria-hidden="true" size={18} /> {t('admin.deliveryOps.zonesTitle')}
            </h2>
            <p className="admin-delivery-section__intro">{t('admin.deliveryOps.zonesHint')}</p>
            <details className="admin-delivery-disclosure" open={zoneItems.length === 0}>
              <summary className="admin-delivery-disclosure__summary">
                <span>
                  <strong>{t('admin.deliveryOps.createZoneTitle')}</strong>
                  <small>{t('admin.deliveryOps.createZoneHint')}</small>
                </span>
                <ChevronRight aria-hidden="true" size={18} />
              </summary>
              <div className="admin-delivery-disclosure__content">
                <form
                  ref={zoneFormRef}
                  className="admin-form-grid"
                  onInput={() => clearSectionError('zone')}
                  onSubmit={createZone}
                >
                  <DeliveryZonePresetButtons
                    disabled={!canUpdateSensitive || action.isPending}
                    onApply={(preset) => {
                      if (zoneFormRef.current) applyDeliveryZonePreset(zoneFormRef.current, preset);
                    }}
                  />
                  <FormField
                    name="code"
                    label={t('admin.deliveryOps.configurationCode')}
                    hint={t('admin.deliveryOps.codeHint')}
                    pattern="[A-Z0-9]+(?:[_-][A-Z0-9]+)*"
                    maxLength={80}
                    autoCapitalize="characters"
                    spellCheck={false}
                    onInput={uppercaseCodeInput}
                    disabled={!canUpdateSensitive || action.isPending}
                    required
                  />
                  <FormField
                    name="nameFr"
                    label={t('admin.deliveryOps.nameFr')}
                    maxLength={160}
                    disabled={!canUpdateSensitive || action.isPending}
                    required
                  />
                  <FormField
                    name="nameAr"
                    label={t('admin.deliveryOps.nameAr')}
                    dir="rtl"
                    maxLength={160}
                    disabled={!canUpdateSensitive || action.isPending}
                    required
                  />
                  <FormField
                    name="priority"
                    type="number"
                    defaultValue={0}
                    min={-1_000_000}
                    max={1_000_000}
                    label={t('admin.deliveryOps.priority')}
                    disabled={!canUpdateSensitive || action.isPending}
                  />
                  <FormField
                    name="estimatedMinDays"
                    type="number"
                    min={0}
                    max={365}
                    label={t('admin.deliveryOps.estimatedMinDays')}
                    disabled={!canUpdateSensitive || action.isPending}
                  />
                  <FormField
                    name="estimatedMaxDays"
                    type="number"
                    min={0}
                    max={365}
                    label={t('admin.deliveryOps.estimatedMaxDays')}
                    disabled={!canUpdateSensitive || action.isPending}
                  />
                  <FormField
                    name="estimatedMinMinutes"
                    type="number"
                    min={1}
                    max={10_080}
                    label={t('admin.deliveryOps.estimatedMinMinutes')}
                    disabled={!canUpdateSensitive || action.isPending}
                  />
                  <FormField
                    name="estimatedMaxMinutes"
                    type="number"
                    min={1}
                    max={10_080}
                    label={t('admin.deliveryOps.estimatedMaxMinutes')}
                    disabled={!canUpdateSensitive || action.isPending}
                  />
                  <SelectField
                    name="paymentMethod"
                    label={t('admin.deliveryOps.paymentMethod')}
                    disabled={!canUpdateSensitive || action.isPending}
                  >
                    <option value="">—</option>
                    <option value="CASH_ON_DELIVERY">
                      {t('admin.deliveryOps.paymentMethods.CASH_ON_DELIVERY')}
                    </option>
                  </SelectField>
                  <SelectField
                    name="assignmentMode"
                    label={t('admin.deliveryOps.assignmentMode')}
                    disabled={!canUpdateSensitive || action.isPending}
                  >
                    <option value="">—</option>
                    <option value="MANUAL">{t('admin.deliveryOps.assignmentModes.MANUAL')}</option>
                  </SelectField>
                  <SelectField
                    name="driverCommunication"
                    label={t('admin.deliveryOps.driverCommunication')}
                    disabled={!canUpdateSensitive || action.isPending}
                  >
                    <option value="">—</option>
                    <option value="WHATSAPP">
                      {t('admin.deliveryOps.communicationChannels.WHATSAPP')}
                    </option>
                    <option value="PHONE">
                      {t('admin.deliveryOps.communicationChannels.PHONE')}
                    </option>
                  </SelectField>
                  <CheckboxField
                    name="phoneConfirmationRequired"
                    disabled={!canUpdateSensitive || action.isPending}
                    label={t('admin.deliveryOps.phoneConfirmationRequired')}
                  />
                  <CheckboxField
                    name="manualReviewRequired"
                    disabled={!canUpdateSensitive || action.isPending}
                    label={t('admin.deliveryOps.manualReviewRequired')}
                  />
                  <Button
                    type="submit"
                    variant="admin"
                    loading={action.isPending}
                    disabled={!canUpdateSensitive || action.isPending}
                  >
                    <Plus aria-hidden="true" size={17} />{' '}
                    {t('admin.deliveryOps.createInactiveZone')}
                  </Button>
                </form>
              </div>
            </details>
            {sectionFeedback('zone') ? (
              <p className="form-banner form-banner--success" role="status" aria-live="polite">
                {sectionFeedback('zone')}
              </p>
            ) : null}
            {sectionError('zone') ? (
              <DeliveryConfigurationError error={sectionError('zone')} />
            ) : null}
            <div className="admin-delivery-record-list">
              {zoneItems.map((zone) => {
                const coverageReady = zone.localityCount > 0;
                const rateReady = zone.activeRateCount > 0;
                const readyForActivation = coverageReady && rateReady;
                const titleId = `delivery-zone-${zone.id}-title`;
                const readinessId = `delivery-zone-${zone.id}-readiness`;
                return (
                  <article
                    className="admin-delivery-record admin-delivery-zone-card"
                    key={zone.id}
                    aria-labelledby={titleId}
                    data-status={zone.active ? 'active' : readyForActivation ? 'ready' : 'blocking'}
                  >
                    <header className="admin-delivery-record__heading">
                      <div>
                        <span className="admin-delivery-record__eyebrow">{zone.code}</span>
                        <h3 id={titleId}>{zone.nameFr}</h3>
                      </div>
                      <span
                        className="admin-delivery-status"
                        data-status={
                          zone.active ? 'active' : readyForActivation ? 'ready' : 'blocking'
                        }
                      >
                        {zone.active
                          ? t('admin.deliveryOps.statuses.ACTIVE')
                          : readyForActivation
                            ? t('admin.deliveryOps.readyToActivate')
                            : t('admin.deliveryOps.configurationIncomplete')}
                      </span>
                    </header>

                    <dl className="admin-delivery-facts">
                      <div>
                        <dt>{t('admin.deliveryOps.deliveryTime')}</dt>
                        <dd>
                          {zone.estimatedMinMinutes !== null && zone.estimatedMaxMinutes !== null
                            ? t('admin.deliveryOps.estimateMinutes', {
                                min: zone.estimatedMinMinutes,
                                max: zone.estimatedMaxMinutes,
                              })
                            : zone.estimatedMinDays !== null && zone.estimatedMaxDays !== null
                              ? t('admin.deliveryOps.estimateDays', {
                                  min: zone.estimatedMinDays,
                                  max: zone.estimatedMaxDays,
                                })
                              : t('common.notAvailable')}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('admin.deliveryOps.paymentMethod')}</dt>
                        <dd>
                          {zone.paymentMethod
                            ? t(`admin.deliveryOps.paymentMethods.${zone.paymentMethod}`)
                            : t('common.notAvailable')}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('admin.deliveryOps.assignmentMode')}</dt>
                        <dd>
                          {zone.assignmentMode
                            ? t(`admin.deliveryOps.assignmentModes.${zone.assignmentMode}`)
                            : t('common.notAvailable')}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('admin.deliveryOps.driverCommunication')}</dt>
                        <dd>
                          {zone.driverCommunication
                            ? t(
                                `admin.deliveryOps.communicationChannels.${zone.driverCommunication}`,
                              )
                            : t('common.notAvailable')}
                        </dd>
                      </div>
                    </dl>

                    <div className="admin-delivery-readiness" id={readinessId}>
                      <h4>{t('admin.deliveryOps.activationReadiness')}</h4>
                      <ul>
                        <li data-complete={coverageReady}>
                          {coverageReady ? (
                            <CheckCircle2 aria-hidden="true" size={18} />
                          ) : (
                            <AlertTriangle aria-hidden="true" size={18} />
                          )}
                          <span>
                            <strong>
                              {coverageReady
                                ? t('admin.deliveryOps.coverageReady')
                                : t('admin.deliveryOps.coverageMissing')}
                            </strong>
                            <small>
                              {t('admin.deliveryOps.coverageCount', {
                                count: zone.localityCount,
                              })}
                            </small>
                          </span>
                        </li>
                        <li data-complete={rateReady}>
                          {rateReady ? (
                            <CheckCircle2 aria-hidden="true" size={18} />
                          ) : (
                            <AlertTriangle aria-hidden="true" size={18} />
                          )}
                          <span>
                            <strong>
                              {rateReady
                                ? t('admin.deliveryOps.rateReady')
                                : t('admin.deliveryOps.rateMissing')}
                            </strong>
                            <small>
                              {t('admin.deliveryOps.activeRateCount', {
                                count: zone.activeRateCount,
                              })}
                            </small>
                          </span>
                        </li>
                      </ul>
                    </div>

                    <div className="admin-delivery-actions">
                      {!coverageReady ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => openConfigurationStep('delivery-coverage', zone.id)}
                        >
                          {t('admin.deliveryOps.configureCoverage')}
                          <ChevronRight aria-hidden="true" size={17} />
                        </Button>
                      ) : !rateReady ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => openConfigurationStep('delivery-rates', zone.id)}
                        >
                          {t('admin.deliveryOps.configureRate')}
                          <ChevronRight aria-hidden="true" size={17} />
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant={zone.active ? 'ghost' : 'admin'}
                        loading={action.isPending}
                        aria-label={t(
                          zone.active
                            ? 'admin.deliveryOps.deactivateZone'
                            : 'admin.deliveryOps.activateZone',
                          { code: zone.code },
                        )}
                        aria-describedby={
                          !zone.active && !readyForActivation ? readinessId : undefined
                        }
                        disabled={
                          !canUpdateSensitive ||
                          action.isPending ||
                          (!zone.active && !readyForActivation)
                        }
                        onClick={() =>
                          action.mutate({
                            run: () => adminDataClient.setDeliveryZoneActive(zone, !zone.active),
                            success: t('admin.deliveryOps.zoneUpdated'),
                            section: 'zone',
                          })
                        }
                      >
                        {zone.active
                          ? t('admin.deliveryOps.deactivate')
                          : t('admin.deliveryOps.activate')}
                      </Button>
                    </div>

                    <details className="admin-delivery-disclosure">
                      <summary className="admin-delivery-disclosure__summary">
                        <span>
                          <strong>{t('admin.deliveryOps.editZoneSettings')}</strong>
                          <small>{t('admin.deliveryOps.editZoneSettingsHint')}</small>
                        </span>
                        <ChevronRight aria-hidden="true" size={18} />
                      </summary>
                      <div className="admin-delivery-disclosure__content">
                        <DeliveryZoneEditor zone={zone} canUpdateSensitive={canUpdateSensitive} />
                      </div>
                    </details>
                  </article>
                );
              })}
            </div>
            <h3 id="delivery-coverage">{t('admin.deliveryOps.geographyTitle')}</h3>
            <p>{t('admin.deliveryOps.geographyHint')}</p>
            <form
              className="admin-form-grid"
              onInput={() => clearSectionError('geography')}
              onSubmit={linkGeography}
            >
              <SelectField
                name="zoneId"
                label={t('admin.deliveryOps.zone')}
                value={selectedGeographyZoneId}
                onChange={(event) => {
                  const nextZoneId = event.target.value;
                  const nextZone = zones.data?.items.find((zone) => zone.id === nextZoneId);
                  setSelectedGeographyZoneId(nextZoneId);
                  setGeographyScope(
                    nextZone?.code === 'BIZERTE_EXPRESS' ? 'DELEGATION' : 'GOVERNORATE',
                  );
                  setGovernorateId('');
                  setDelegationId('');
                  setLocalityId('');
                }}
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
              <SelectField
                name="scope"
                label={t('admin.deliveryOps.geographyScope')}
                value={geographyScope}
                onChange={(event) => {
                  const nextScope = event.target.value as DeliveryGeographyScope;
                  setGeographyScope(
                    isBizerteExpress && nextScope === 'GOVERNORATE' ? 'DELEGATION' : nextScope,
                  );
                  setGovernorateId('');
                  setDelegationId('');
                  setLocalityId('');
                }}
                disabled={!canUpdateSensitive || action.isPending}
                required
              >
                <option value="GOVERNORATE" disabled={isBizerteExpress}>
                  {t('admin.deliveryOps.scopeGovernorate')}
                </option>
                <option value="DELEGATION">{t('admin.deliveryOps.scopeDelegation')}</option>
                <option value="LOCALITY">{t('admin.deliveryOps.scopeLocality')}</option>
              </SelectField>
              {isBizerteExpress ? (
                <p className="field__hint" role="status">
                  {t('admin.deliveryOps.bizerteCoverageHint')}
                </p>
              ) : null}
              <SelectField
                name="governorateId"
                label={t('checkout.governorate')}
                value={governorateId}
                onChange={(event) => {
                  setGovernorateId(event.target.value);
                  setDelegationId('');
                  setLocalityId('');
                }}
                disabled={
                  !canUpdateSensitive ||
                  action.isPending ||
                  governorates.isPending ||
                  bizerteGovernorateUnavailable
                }
                required
              >
                <option value="">—</option>
                {geographyGovernorateOptions?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </SelectField>
              {geographyScope !== 'GOVERNORATE' ? (
                <SelectField
                  name="delegationId"
                  label={t('checkout.delegation')}
                  value={delegationId}
                  onChange={(event) => {
                    setDelegationId(event.target.value);
                    setLocalityId('');
                  }}
                  disabled={!canUpdateSensitive || action.isPending || !governorateId}
                  required
                >
                  <option value="">—</option>
                  {delegations.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </SelectField>
              ) : null}
              {geographyScope === 'LOCALITY' ? (
                <SelectField
                  name="localityId"
                  label={t('checkout.locality')}
                  value={localityId}
                  onChange={(event) => setLocalityId(event.target.value)}
                  disabled={!canUpdateSensitive || action.isPending || !delegationId}
                  required
                >
                  <option value="">—</option>
                  {localities.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </SelectField>
              ) : null}
              {selectedGeographyIsEmpty ? (
                <p className="form-banner form-banner--error" role="alert">
                  {t('admin.deliveryOps.geographyDataMissing')}
                </p>
              ) : null}
              {bizerteGovernorateUnavailable ? (
                <p className="form-banner form-banner--error" role="alert">
                  {t('admin.deliveryOps.bizerteGovernorateUnavailable')}
                </p>
              ) : null}
              {selectedGeographyOption ? (
                <p className="field__hint" role="status" aria-live="polite">
                  {selectedGeographyOption.supported
                    ? t('admin.deliveryOps.geographySupported')
                    : t('admin.deliveryOps.geographyUnsupported')}
                </p>
              ) : null}
              <Button
                type="submit"
                variant="admin"
                loading={action.isPending}
                disabled={
                  !canUpdateSensitive ||
                  action.isPending ||
                  !selectedGeographyId ||
                  selectedGeographyIsEmpty ||
                  bizerteGovernorateUnavailable ||
                  bizerteSelectionInvalid
                }
              >
                {t('admin.deliveryOps.addGeography')}
              </Button>
            </form>
            {sectionFeedback('geography') ? (
              <p className="form-banner form-banner--success" role="status" aria-live="polite">
                {sectionFeedback('geography')}
              </p>
            ) : null}
            {sectionError('geography') ? (
              <DeliveryConfigurationError error={sectionError('geography')} />
            ) : null}
          </section>

          <section id="delivery-rates" className="admin-panel admin-delivery-section">
            <h2>
              <Route aria-hidden="true" size={18} /> {t('admin.deliveryOps.ratesTitle')}
            </h2>
            <p className="admin-delivery-section__intro">{t('admin.deliveryOps.ratesHint')}</p>
            <details className="admin-delivery-disclosure" open={!rates.data?.items.length}>
              <summary className="admin-delivery-disclosure__summary">
                <span>
                  <strong>{t('admin.deliveryOps.createRateTitle')}</strong>
                  <small>{t('admin.deliveryOps.createRateHint')}</small>
                </span>
                <ChevronRight aria-hidden="true" size={18} />
              </summary>
              <div className="admin-delivery-disclosure__content">
                <form
                  ref={rateFormRef}
                  className="admin-form-grid"
                  onInput={() => clearSectionError('rate')}
                  onSubmit={createRate}
                >
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
                    maxLength={160}
                    disabled={!canUpdateSensitive || action.isPending}
                    required
                  />
                  <FormField
                    ref={createRateAmountRef}
                    name="feeTnd"
                    label={t('admin.deliveryOps.amountTnd')}
                    hint={t('admin.deliveryOps.amountTndHint')}
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={24}
                    spellCheck={false}
                    error={createRateAmountError || undefined}
                    disabled={!canUpdateSensitive || action.isPending}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      const nextParsed = parseDeliveryRateTnd(nextValue);
                      setCreateRateAmountTnd(nextValue);
                      if (createRateAmountError) {
                        setCreateRateAmountError(
                          nextParsed.error ? t(deliveryRateAmountErrorKeys[nextParsed.error]) : '',
                        );
                      }
                    }}
                    required
                  />
                  {parsedCreateRateAmount.error ? null : (
                    <p className="field__hint" aria-live="polite">
                      <Price millimes={parsedCreateRateAmount.feeMillimes} /> ·{' '}
                      {t('admin.deliveryOps.rateAmountPreview', {
                        millimes: parsedCreateRateAmount.feeMillimes,
                      })}
                    </p>
                  )}
                  <FormField
                    name="priority"
                    type="number"
                    defaultValue={0}
                    label={t('admin.deliveryOps.priority')}
                    disabled={!canUpdateSensitive || action.isPending}
                  />
                  <CheckboxField
                    name="express"
                    disabled={!canUpdateSensitive || action.isPending}
                    label={t('admin.deliveryOps.expressRate')}
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
              </div>
            </details>
            {sectionFeedback('rate') ? (
              <p className="form-banner form-banner--success" role="status" aria-live="polite">
                {sectionFeedback('rate')}
              </p>
            ) : null}
            {sectionError('rate') ? (
              <DeliveryConfigurationError error={sectionError('rate')} />
            ) : null}
            <div className="admin-delivery-record-list">
              {rates.data?.items.map((rate) => {
                const rateZone = zoneItems.find((zone) => zone.id === rate.deliveryZoneId);
                const titleId = `delivery-rate-${rate.id}-title`;
                return (
                  <article
                    className="admin-delivery-record"
                    key={rate.id}
                    aria-labelledby={titleId}
                  >
                    <header className="admin-delivery-record__heading">
                      <div>
                        <span className="admin-delivery-record__eyebrow">
                          {rateZone?.nameFr ?? t('admin.deliveryOps.zoneUnavailable')}
                        </span>
                        <h3 id={titleId}>{rate.name}</h3>
                      </div>
                      <span
                        className="admin-delivery-status"
                        data-status={rate.active ? 'active' : 'inactive'}
                      >
                        {rate.active
                          ? t('admin.deliveryOps.statuses.ACTIVE')
                          : t('admin.deliveryOps.inactive')}
                      </span>
                    </header>
                    <p className="admin-delivery-rate-amount">
                      <Price millimes={rate.feeMillimes} />
                      {rate.express ? <span>{t('admin.deliveryOps.express')}</span> : null}
                    </p>
                    <DeliveryRateEditor rate={rate} canUpdateSensitive={canUpdateSensitive} />
                    <div className="admin-delivery-actions">
                      <Button
                        type="button"
                        variant={rate.active ? 'ghost' : 'admin'}
                        loading={action.isPending}
                        disabled={!canUpdateSensitive || action.isPending}
                        onClick={() =>
                          action.mutate({
                            run: () => adminDataClient.setDeliveryRateActive(rate, !rate.active),
                            success: t('admin.deliveryOps.rateUpdated'),
                            section: 'rate',
                          })
                        }
                      >
                        {rate.active
                          ? t('admin.deliveryOps.deactivateRate', { name: rate.name })
                          : t('admin.deliveryOps.activateRate', { name: rate.name })}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="admin-panel admin-delivery-section">
            <h2>{t('admin.deliveryOps.pickupsTitle')}</h2>
            <p className="admin-delivery-section__intro">{t('admin.deliveryOps.pickupsHint')}</p>
            <details className="admin-delivery-disclosure">
              <summary className="admin-delivery-disclosure__summary">
                <span>
                  <strong>{t('admin.deliveryOps.createPickupTitle')}</strong>
                  <small>{t('admin.deliveryOps.createPickupHint')}</small>
                </span>
                <ChevronRight aria-hidden="true" size={18} />
              </summary>
              <div className="admin-delivery-disclosure__content">
                <form
                  className="admin-form-grid"
                  onInput={() => clearSectionError('pickup')}
                  onSubmit={createPickup}
                >
                  <FormField
                    name="code"
                    label={t('admin.deliveryOps.configurationCode')}
                    hint={t('admin.deliveryOps.codeHint')}
                    pattern="[A-Z0-9]+(?:[_-][A-Z0-9]+)*"
                    maxLength={80}
                    autoCapitalize="characters"
                    spellCheck={false}
                    onInput={uppercaseCodeInput}
                    disabled={!canUpdateSensitive || action.isPending}
                    required
                  />
                  <FormField
                    name="nameFr"
                    label={t('admin.deliveryOps.nameFr')}
                    maxLength={160}
                    disabled={!canUpdateSensitive || action.isPending}
                    required
                  />
                  <FormField
                    name="nameAr"
                    label={t('admin.deliveryOps.nameAr')}
                    dir="rtl"
                    maxLength={160}
                    disabled={!canUpdateSensitive || action.isPending}
                    required
                  />
                  <FormField
                    name="address"
                    label={t('admin.deliveryOps.address')}
                    minLength={3}
                    maxLength={500}
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
              </div>
            </details>
            {sectionFeedback('pickup') ? (
              <p className="form-banner form-banner--success" role="status" aria-live="polite">
                {sectionFeedback('pickup')}
              </p>
            ) : null}
            {sectionError('pickup') ? (
              <DeliveryConfigurationError error={sectionError('pickup')} />
            ) : null}
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
                      section: 'pickup',
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
      </div>
    </div>
  );
}
