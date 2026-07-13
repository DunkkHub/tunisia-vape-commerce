import { useMutation, useQuery } from '@tanstack/react-query';
import { RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { type FormEvent } from 'react';
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

export function AdminSettingsPage() {
  const { t } = useTranslation();
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
          <p>{t('admin.resourceSubtitle')}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void settings.refetch()}
          disabled={settings.isFetching}
        >
          <RefreshCw aria-hidden="true" size={18} />
          {t('admin.refresh')}
        </Button>
      </header>
      {settings.isPending ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
      {settings.isError ? <ErrorState onRetry={() => void settings.refetch()} /> : null}
      {settings.data?.items.length === 0 ? <EmptyState title={t('admin.emptyResource')} /> : null}
      <div className="admin-stock-sections">
        {settings.data?.items.map((setting) => {
          const manageable = !setting.redacted && setting.valueType !== 'JSON';
          return (
            <form
              className="admin-panel"
              key={setting.id}
              onSubmit={(event) => submit(setting, event)}
            >
              <h2>{setting.key}</h2>
              <p>{setting.description}</p>
              <small>
                {setting.scope} · version {setting.version} ·{' '}
                <LocalDate value={setting.updatedAt} />
              </small>
              {setting.legallyReviewed ? (
                <p className="form-banner form-banner--success">
                  <ShieldCheck aria-hidden="true" size={17} /> Revue enregistrée
                </p>
              ) : null}
              {setting.valueType === 'BOOLEAN' ? (
                <SelectField
                  name="value"
                  label="Valeur"
                  defaultValue={String(setting.value)}
                  disabled={!manageable}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </SelectField>
              ) : (
                <FormField
                  name="value"
                  label="Valeur"
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
                label="Motif obligatoire de la modification"
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
                Enregistrer
              </Button>
            </form>
          );
        })}
      </div>
      {update.isError ? <ErrorState compact /> : null}
    </div>
  );
}
