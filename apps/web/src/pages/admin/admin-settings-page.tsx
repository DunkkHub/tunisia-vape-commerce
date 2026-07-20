import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { adminDataClient } from '../../api/admin-data-client';
import type { AdminSettingRecord } from '../../api/types';
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

export function AdminSettingsPage() {
  const { t } = useTranslation();
  const [exportMessage, setExportMessage] = useState('');
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
    onSuccess: () => void settings.refetch(),
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
    if (!reason || (setting.valueType === 'INTEGER' && !/^\d+$/.test(raw))) return;
    update.mutate({ setting, value: parsedValue(setting, raw), reason });
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
            onClick={() => void settings.refetch()}
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
      <div className="admin-stock-sections">
        {settings.data?.items.map((setting) => {
          const manageable =
            !setting.redacted &&
            setting.valueType !== 'JSON' &&
            manageableSettingKeys.has(setting.key);
          return (
            <form
              className="admin-panel"
              key={setting.id}
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
              {!manageable ? (
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
              ) : (
                <FormField
                  name="value"
                  label={t('admin.settingsPanel.value')}
                  type={setting.valueType === 'INTEGER' ? 'number' : 'text'}
                  defaultValue={
                    typeof setting.value === 'string' || typeof setting.value === 'number'
                      ? setting.value
                      : ''
                  }
                  disabled={!manageable}
                />
              )}
              <FormField
                name="reason"
                label={t('admin.settingsPanel.reason')}
                maxLength={500}
                required
                disabled={!manageable}
              />
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
        })}
      </div>
      {update.isError || exportConfiguration.isError ? <ErrorState compact /> : null}
    </div>
  );
}
