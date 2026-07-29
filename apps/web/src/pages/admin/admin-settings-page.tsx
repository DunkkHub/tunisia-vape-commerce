import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  Download,
  Info,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { adminDataClient } from '../../api/admin-data-client';
import { ApiError } from '../../api/http';
import type { AdminSettingRecord } from '../../api/types';
import {
  AdminWorkspaceNav,
  AdminWorkspacePanel,
  type AdminWorkspaceItem,
} from '../../components/admin/admin-workspace';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { FormField, SelectField } from '../../components/ui/form-field';
import { LocalDate } from '../../components/ui/price';

const formValue = (entry: FormDataEntryValue | null): string =>
  typeof entry === 'string' ? entry.trim() : '';

const parsedValue = (setting: AdminSettingRecord, raw: string): string | number | boolean => {
  if (setting.valueType === 'BOOLEAN') return raw === 'true';
  if (setting.valueType === 'INTEGER') return Number(raw);
  return raw;
};

const fixedSettingValues: Readonly<Record<string, string>> = {
  'store.currency': 'TND',
  'store.timezone': 'Africa/Tunis',
};

const localeSettingKeys = new Set([
  'store.default_locale',
  'notifications.operational_alert_locale',
]);

const settingErrorMessageKeys: Readonly<Record<string, string>> = {
  AUTHENTICATION_REQUIRED: 'admin.settingsPanel.errors.authenticationRequired',
  INSUFFICIENT_PERMISSION: 'admin.settingsPanel.errors.permissionDenied',
  RECENT_AUTHENTICATION_REQUIRED: 'admin.settingsPanel.errors.recentAuthenticationRequired',
  CSRF_VALIDATION_FAILED: 'admin.settingsPanel.errors.sessionVerificationFailed',
  INVALID_SETTING_VALUE: 'admin.settingsPanel.errors.invalidValue',
  SETTING_CHANGE_REASON_REQUIRED: 'admin.settingsPanel.errors.reasonRequired',
  SETTING_NOT_FOUND: 'admin.settingsPanel.errors.notFound',
  SETTING_NOT_MANAGEABLE: 'admin.settingsPanel.errors.notManageable',
  SETTING_TYPE_MISMATCH: 'admin.settingsPanel.errors.typeMismatch',
  VALIDATION_ERROR: 'admin.settingsPanel.errors.validation',
  VERSION_CONFLICT: 'admin.settingsPanel.errors.versionConflict',
};

type SettingFeedback = {
  settingId: string;
  kind: 'saved' | 'unchanged' | 'reason-required' | 'invalid-value' | 'error';
  error?: unknown;
};

const manageableSettingKeys = new Set([
  'checkout.enabled',
  'maintenance.mode',
  'prelaunch.mode',
  'store.name',
  'store.phone',
  'store.email',
  'store.address',
  'store.currency',
  'store.timezone',
  'store.default_locale',
  'notifications.admin_order_created.enabled',
  'notifications.customer_order_created.enabled',
  'notifications.customer_order_sms.enabled',
  'notifications.security_alert_email',
  'notifications.order_alert_email',
  'notifications.low_stock_alert_email',
  'notifications.operational_alert_locale',
  'minimum_purchase_age',
  'age_gate.entry.enabled',
  'age_gate.checkout.enabled',
  'consent.terms.required',
  'consent.privacy.required',
  'consent.recording.enabled',
  'delivery.age_verification_required',
]);

type SettingsWorkspace = 'store' | 'commerce' | 'notifications' | 'system';

const settingsWorkspaceFor = (key: string): SettingsWorkspace => {
  if (key.startsWith('store.')) return 'store';
  if (key.startsWith('notifications.')) return 'notifications';
  if (
    key === 'checkout.enabled' ||
    key === 'minimum_purchase_age' ||
    key.startsWith('age_gate.') ||
    key.startsWith('consent.') ||
    key === 'delivery.age_verification_required'
  ) {
    return 'commerce';
  }
  return 'system';
};

export function AdminSettingsPage() {
  const { t } = useTranslation();
  const [exportMessage, setExportMessage] = useState('');
  const [settingFeedback, setSettingFeedback] = useState<SettingFeedback | null>(null);
  const [workspace, setWorkspace] = useState<SettingsWorkspace>('store');
  const settings = useQuery({
    queryKey: ['admin', 'settings', 'operational'],
    queryFn: () => adminDataClient.settings(),
  });
  const update = useMutation({
    mutationFn: ({
      setting,
      value,
      reason,
    }: {
      setting: AdminSettingRecord;
      value: string | number | boolean;
      reason: string;
    }) => adminDataClient.updateSetting(setting, value, reason),
    onMutate: () => setSettingFeedback(null),
    onSuccess: async (_result, { setting }) => {
      setSettingFeedback({ settingId: setting.id, kind: 'saved' });
      await settings.refetch();
    },
    onError: (error, { setting }) => {
      if (error instanceof ApiError && error.code === 'SETTING_VALUE_UNCHANGED') {
        setSettingFeedback({ settingId: setting.id, kind: 'unchanged' });
        return;
      }
      setSettingFeedback({ settingId: setting.id, kind: 'error', error });
    },
  });
  const exportConfiguration = useMutation({
    mutationFn: () => adminDataClient.exportSettings(),
    onSuccess: (payload) => {
      const objectUrl = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'store-configuration.json';
      link.click();
      URL.revokeObjectURL(objectUrl);
      setExportMessage(t('admin.settingsPanel.exportReady'));
    },
  });
  const submit = (setting: AdminSettingRecord, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = formValue(form.get('value'));
    const reason = formValue(form.get('reason'));
    if (!reason) {
      setSettingFeedback({ settingId: setting.id, kind: 'reason-required' });
      return;
    }
    if (setting.valueType === 'INTEGER' && !/^\d+$/.test(raw)) {
      setSettingFeedback({ settingId: setting.id, kind: 'invalid-value' });
      return;
    }
    const value = parsedValue(setting, raw);
    if (value === setting.value) {
      setSettingFeedback({ settingId: setting.id, kind: 'unchanged' });
      return;
    }
    update.mutate({ setting, value, reason });
  };
  const workspaceItems: AdminWorkspaceItem<SettingsWorkspace>[] = [
    {
      id: 'store',
      label: t('admin.ui.settingsStore'),
      description: t('admin.ui.settingsStoreHint'),
      icon: Building2,
    },
    {
      id: 'commerce',
      label: t('admin.ui.settingsCommerce'),
      description: t('admin.ui.settingsCommerceHint'),
      icon: ShoppingCart,
    },
    {
      id: 'notifications',
      label: t('admin.ui.settingsNotifications'),
      description: t('admin.ui.settingsNotificationsHint'),
      icon: Bell,
    },
    {
      id: 'system',
      label: t('admin.ui.settingsSystem'),
      description: t('admin.ui.settingsSystemHint'),
      icon: Settings2,
    },
  ];
  const groupedSettings = new Map<SettingsWorkspace, AdminSettingRecord[]>([
    ['store', []],
    ['commerce', []],
    ['notifications', []],
    ['system', []],
  ]);
  for (const setting of settings.data?.items ?? []) {
    groupedSettings.get(settingsWorkspaceFor(setting.key))?.push(setting);
  }

  const settingForm = (setting: AdminSettingRecord) => {
    const supported =
      !setting.redacted && setting.valueType !== 'JSON' && manageableSettingKeys.has(setting.key);
    const fixedValue = fixedSettingValues[setting.key];
    const fixedValueAlreadyActive = fixedValue !== undefined && setting.value === fixedValue;
    const manageable = supported && !fixedValueAlreadyActive;
    const feedback = settingFeedback?.settingId === setting.id ? settingFeedback : null;
    const apiError = feedback?.error instanceof ApiError ? feedback.error : null;
    const errorMessageKey = apiError ? settingErrorMessageKeys[apiError.code] : undefined;
    const feedbackMessage =
      feedback?.kind === 'saved'
        ? t('admin.settingsPanel.saveSuccess')
        : feedback?.kind === 'unchanged'
          ? t('admin.settingsPanel.valueUnchanged')
          : feedback?.kind === 'reason-required'
            ? t('admin.settingsPanel.errors.reasonRequired')
            : feedback?.kind === 'invalid-value'
              ? t('admin.settingsPanel.errors.invalidValue')
              : feedback?.kind === 'error'
                ? errorMessageKey
                  ? t(errorMessageKey)
                  : apiError?.message || t('admin.settingsPanel.errors.fallback')
                : null;
    const feedbackIsError =
      feedback?.kind === 'reason-required' ||
      feedback?.kind === 'invalid-value' ||
      feedback?.kind === 'error';
    const valueHint =
      setting.key === 'store.phone'
        ? t('admin.settingsPanel.hints.phone')
        : setting.key === 'store.email' || setting.key.endsWith('_email')
          ? t('admin.settingsPanel.hints.email')
          : undefined;
    return (
      <form
        className="admin-panel admin-setting-card"
        key={`${setting.id}:${setting.version}`}
        onSubmit={(event) => submit(setting, event)}
      >
        <h2>{setting.key}</h2>
        <p>{setting.description}</p>
        <small>
          {t('admin.settingsPanel.metadata', {
            scope: setting.scope,
            version: setting.version,
          })}{' '}
          <LocalDate value={setting.updatedAt} />
        </small>
        {setting.legallyReviewed ? (
          <p className="form-banner form-banner--success">
            <ShieldCheck aria-hidden="true" size={17} />
            {t('admin.settingsPanel.reviewRecorded')}
          </p>
        ) : null}
        {fixedValueAlreadyActive ? (
          <p className="form-banner form-banner--success" role="status">
            <CheckCircle2 aria-hidden="true" size={17} />
            {t('admin.settingsPanel.fixedValueActive', { value: fixedValue })}
          </p>
        ) : null}
        {!supported ? (
          <p className="form-banner">{t('admin.settingsPanel.notManageable')}</p>
        ) : null}
        {setting.valueType === 'BOOLEAN' ? (
          <SelectField
            name="value"
            label={t('admin.settingsPanel.value')}
            defaultValue={String(setting.value)}
            disabled={!manageable}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </SelectField>
        ) : localeSettingKeys.has(setting.key) ? (
          <SelectField
            name="value"
            label={t('admin.settingsPanel.value')}
            defaultValue={String(setting.value)}
            disabled={!manageable}
          >
            <option value="fr">fr</option>
            <option value="ar">ar</option>
          </SelectField>
        ) : (
          <FormField
            name="value"
            label={t('admin.settingsPanel.value')}
            type={
              setting.valueType === 'INTEGER'
                ? 'number'
                : setting.key === 'store.phone'
                  ? 'tel'
                  : setting.key === 'store.email' || setting.key.endsWith('_email')
                    ? 'email'
                    : 'text'
            }
            defaultValue={
              typeof setting.value === 'string' || typeof setting.value === 'number'
                ? setting.value
                : ''
            }
            disabled={!manageable}
            hint={valueHint}
          />
        )}
        <FormField
          name="reason"
          label={t('admin.settingsPanel.reason')}
          maxLength={500}
          required
          disabled={!manageable}
        />
        {feedbackMessage ? (
          <div
            className={`form-banner ${feedbackIsError ? 'form-banner--error' : 'form-banner--success'}`}
            role={feedbackIsError ? 'alert' : 'status'}
          >
            {feedbackIsError ? (
              <AlertTriangle aria-hidden="true" size={17} />
            ) : feedback?.kind === 'unchanged' ? (
              <Info aria-hidden="true" size={17} />
            ) : (
              <CheckCircle2 aria-hidden="true" size={17} />
            )}
            <span>
              {feedbackMessage}
              {apiError?.requestId ? (
                <small className="admin-setting-feedback__reference">
                  {t('admin.settingsPanel.requestReference', { requestId: apiError.requestId })}
                </small>
              ) : null}
            </span>
          </div>
        ) : null}
        <Button
          type="submit"
          variant="admin"
          loading={update.isPending && update.variables?.setting.id === setting.id}
          disabled={!manageable || update.isPending}
        >
          <Save aria-hidden="true" size={17} />
          {t('common.save')}
        </Button>
      </form>
    );
  };

  return (
    <div className="admin-page">
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">{t('brand.adminShort')}</span>
          <h1>{t('admin.settings')}</h1>
          <p>{t('admin.settingsPanel.subtitle')}</p>
        </div>
        <div className="admin-heading-actions">
          <Button
            type="button"
            variant="ghost"
            loading={exportConfiguration.isPending}
            disabled={exportConfiguration.isPending}
            onClick={() => {
              setExportMessage('');
              exportConfiguration.mutate();
            }}
          >
            <Download aria-hidden="true" size={18} />
            {t('admin.settingsPanel.export')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSettingFeedback(null);
              void settings.refetch();
            }}
            disabled={settings.isFetching}
          >
            <RefreshCw aria-hidden="true" size={18} />
            {t('admin.refresh')}
          </Button>
        </div>
      </header>
      {exportMessage ? (
        <p className="form-banner form-banner--success" role="status">
          {exportMessage}
        </p>
      ) : null}
      {settings.isPending ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
      {settings.isError ? <ErrorState onRetry={() => void settings.refetch()} /> : null}
      {settings.data?.items.length === 0 ? <EmptyState title={t('admin.emptyResource')} /> : null}
      {settings.data?.items.length ? (
        <>
          <AdminWorkspaceNav
            label={t('admin.ui.workspaceLabel')}
            value={workspace}
            items={workspaceItems}
            onChange={setWorkspace}
          />
          {workspaceItems.map((item) => (
            <AdminWorkspacePanel key={item.id} id={item.id} value={workspace}>
              <div className="admin-settings-grid">
                {groupedSettings.get(item.id)?.map(settingForm)}
              </div>
            </AdminWorkspacePanel>
          ))}
        </>
      ) : null}
      {exportConfiguration.isError ? <ErrorState compact /> : null}
    </div>
  );
}
