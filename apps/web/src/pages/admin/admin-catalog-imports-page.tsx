import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Download,
  FileJson,
  FileSpreadsheet,
  History,
  Images,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { adminDataClient } from '../../api/admin-data-client';
import { ApiError } from '../../api/http';
import type {
  AdminCatalogImportBatch,
  AdminCatalogMediaImportReport,
  AdminCatalogImportPreviewPayload,
  AdminCatalogImportRow,
  AdminCatalogImportStatus,
  AdminCsvDownload,
} from '../../api/types';
import { useAdminAuth } from '../../auth/admin-auth-context';
import { AdminDisclosure } from '../../components/admin/admin-workspace';
import { Button } from '../../components/ui/button';
import { CheckboxField, FormField, SelectField } from '../../components/ui/form-field';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { LocalDate } from '../../components/ui/price';

const HISTORY_PAGE_SIZE = 20;
const ROW_DISPLAY_LIMIT = 100;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const IMPORT_KEY_PATTERN = '[A-Za-z0-9][A-Za-z0-9._:\\-]{2,99}';

type ConfirmationAction = 'apply' | 'media' | 'rollback';

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function downloadCsv(download: AdminCsvDownload): void {
  const blob = new Blob([download.content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = download.filename;
  anchor.rel = 'noopener';
  anchor.click();
  URL.revokeObjectURL(url);
}

function isRollbackCandidate(batch: AdminCatalogImportBatch): boolean {
  return !batch.dryRun && (batch.status === 'APPLIED' || batch.status === 'APPLIED_WITH_WARNINGS');
}

function isMediaImportCandidate(batch: AdminCatalogImportBatch): boolean {
  return !batch.dryRun && (batch.status === 'APPLIED' || batch.status === 'APPLIED_WITH_WARNINGS');
}

function safeResultValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }
  const serialized = JSON.stringify(value);
  if (!serialized) return '—';
  return serialized.length > 160 ? `${serialized.slice(0, 157)}…` : serialized;
}

function errorLabel(error: Error | null, t: (key: string) => string): string | null {
  if (!error) return null;
  if (error instanceof ApiError && error.code === 'RECENT_AUTHENTICATION_REQUIRED') {
    return t('admin.imports.recentAuthenticationRequired');
  }
  return t('admin.imports.actionError');
}

function ImportStatus({ status }: { status: AdminCatalogImportStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`admin-import-status admin-import-status--${status.toLowerCase()}`}>
      {t(`admin.imports.statuses.${status}`)}
    </span>
  );
}

function BatchFacts({ batch }: { batch: AdminCatalogImportBatch }) {
  const { t } = useTranslation();
  const facts = [
    [t('admin.imports.importKey'), batch.importKey],
    [t('admin.imports.formatLabel'), t(`admin.imports.formats.${batch.format}`)],
    [t('admin.imports.sourceLabel'), t(`admin.imports.sources.${batch.source}`)],
    [
      t('admin.imports.modeLabel'),
      t(batch.dryRun ? 'admin.imports.dryRun' : 'admin.imports.appliedMode'),
    ],
    [t('admin.imports.rows'), String(batch.rowCount)],
    [t('admin.imports.appliedRows'), String(batch.appliedCount)],
  ] as const;
  return (
    <dl className="admin-import-facts">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ImportOptions({ batch }: { batch: AdminCatalogImportBatch }) {
  const { t } = useTranslation();
  const options = [
    ['partialMode', batch.partialMode],
    ['overridePrice', batch.overridePrice],
    ['overrideStatus', batch.overrideStatus],
    ['overrideImages', batch.overrideImages],
  ] as const;
  return (
    <ul className="admin-import-option-list" aria-label={t('admin.imports.optionsTitle')}>
      {options.map(([key, enabled]) => (
        <li key={key} className={enabled ? 'is-enabled' : ''}>
          {enabled ? (
            <CheckCircle2 aria-hidden="true" size={16} />
          ) : (
            <X aria-hidden="true" size={16} />
          )}
          <span>{t(`admin.imports.options.${key}`)}</span>
        </li>
      ))}
    </ul>
  );
}

function ResultSummary({ batch }: { batch: AdminCatalogImportBatch }) {
  const { t } = useTranslation();
  const entries = Object.entries(batch.result).slice(0, 12);
  if (entries.length === 0) return null;
  return (
    <section className="admin-import-results" aria-labelledby="import-result-title">
      <h3 id="import-result-title">{t('admin.imports.resultTitle')}</h3>
      <dl>
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt>{t(`admin.imports.results.${key}`, { defaultValue: key })}</dt>
            <dd>{safeResultValue(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function mediaReportFromBatch(
  batch: AdminCatalogImportBatch,
): AdminCatalogMediaImportReport | null {
  const value = batch.result.media;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<AdminCatalogMediaImportReport>;
  if (
    !Array.isArray(candidate.successful) ||
    !Array.isArray(candidate.missing) ||
    !Array.isArray(candidate.rejected) ||
    !Array.isArray(candidate.duplicates) ||
    !Array.isArray(candidate.productsRequiringManualReview)
  ) {
    return null;
  }
  return candidate as AdminCatalogMediaImportReport;
}

function MediaImportReport({ batch }: { batch: AdminCatalogImportBatch }) {
  const { t } = useTranslation();
  const report = mediaReportFromBatch(batch);
  if (!report) return null;
  const sections = [
    ['successful', report.successful],
    ['missing', report.missing],
    ['rejected', report.rejected],
    ['duplicates', report.duplicates],
  ] as const;
  return (
    <section className="admin-import-media-report" aria-labelledby="catalog-media-report-title">
      <h3 id="catalog-media-report-title">{t('admin.imports.mediaReport.title')}</h3>
      <p>{t('admin.imports.mediaReport.body')}</p>
      <div className="admin-import-media-report__groups">
        {sections.map(([key, items]) => (
          <section key={key} aria-labelledby={`catalog-media-${key}`}>
            <h4 id={`catalog-media-${key}`}>
              {t(`admin.imports.mediaReport.${key}`)} <span>({items.length})</span>
            </h4>
            {items.length === 0 ? (
              <p className="admin-import-no-issues">{t('admin.imports.mediaReport.none')}</p>
            ) : (
              <ul className="admin-import-media-items">
                {items.slice(0, ROW_DISPLAY_LIMIT).map((item, index) => {
                  const owner = typeof item.owner === 'string' ? item.owner : 'IMAGE';
                  const productKey = typeof item.productKey === 'string' ? item.productKey : '—';
                  const variantKey = typeof item.variantKey === 'string' ? item.variantKey : null;
                  const code = typeof item.code === 'string' ? item.code : null;
                  const sourceUrl = typeof item.sourceUrl === 'string' ? item.sourceUrl : null;
                  return (
                    <li key={`${key}-${productKey}-${variantKey ?? ''}-${index}`}>
                      <strong>{owner}</strong>
                      <span>{productKey}</span>
                      {variantKey ? <span>{variantKey}</span> : null}
                      {code ? <code>{code}</code> : null}
                      {sourceUrl ? <small>{sourceUrl}</small> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
      <div className="admin-import-media-review">
        <h4>{t('admin.imports.mediaReport.manualReview')}</h4>
        {report.productsRequiringManualReview.length === 0 ? (
          <p className="admin-import-no-issues">{t('admin.imports.mediaReport.none')}</p>
        ) : (
          <ul>
            {report.productsRequiringManualReview.map((productKey) => (
              <li key={productKey}>{productKey}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function RowIssues({ row }: { row: AdminCatalogImportRow }) {
  const { t } = useTranslation();
  if (!Array.isArray(row.issues) || row.issues.length === 0) {
    return <span className="admin-import-no-issues">{t('admin.imports.noIssues')}</span>;
  }
  return (
    <ul className="admin-import-issues">
      {row.issues.slice(0, 5).map((issue, index) => (
        <li key={`${issue.code}-${issue.field ?? ''}-${index}`}>
          <strong>{issue.code}</strong>
          {issue.field ? <span>{issue.field}</span> : null}
          <p>{issue.message}</p>
        </li>
      ))}
    </ul>
  );
}

function RowReport({ batch }: { batch: AdminCatalogImportBatch }) {
  const { t } = useTranslation();
  const rows = batch.rows ?? [];
  if (rows.length === 0) return null;
  const visibleRows = rows.slice(0, ROW_DISPLAY_LIMIT);
  return (
    <section className="admin-import-row-report" aria-labelledby="import-row-report-title">
      <div className="admin-panel__heading">
        <div>
          <h3 id="import-row-report-title">{t('admin.imports.rowReportTitle')}</h3>
          <p>
            {t('admin.imports.rowsShown', {
              shown: visibleRows.length,
              total: rows.length,
            })}
          </p>
        </div>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table admin-import-row-table">
          <thead>
            <tr>
              <th scope="col">{t('admin.imports.rowNumber')}</th>
              <th scope="col">{t('common.status')}</th>
              <th scope="col">{t('admin.imports.identity')}</th>
              <th scope="col">{t('admin.imports.action')}</th>
              <th scope="col">{t('admin.imports.issues')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id}>
                <td>{row.rowNumber}</td>
                <td>{t(`admin.imports.rowStatuses.${row.status}`)}</td>
                <td className="admin-import-identity">{row.stableIdentity}</td>
                <td>{row.action}</td>
                <td>
                  <RowIssues row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ConfirmationDialog({
  action,
  batch,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  action: ConfirmationAction;
  batch: AdminCatalogImportBatch;
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const [confirmationError, setConfirmationError] = useState(false);
  const phrase =
    action === 'apply'
      ? 'APPLY_CATALOG_IMPORT'
      : action === 'media'
        ? 'IMPORT_CATALOG_MEDIA'
        : 'ROLLBACK_CATALOG_IMPORT';
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const confirmation = formString(new FormData(event.currentTarget), 'confirmation');
    if (confirmation !== phrase) {
      setConfirmationError(true);
      return;
    }
    setConfirmationError(false);
    onConfirm();
  };
  return (
    <Dialog.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="admin-dialog__overlay" />
        <Dialog.Content
          className="admin-dialog"
          aria-describedby="catalog-import-confirmation-description"
        >
          <Dialog.Title>{t(`admin.imports.confirmation.${action}Title`)}</Dialog.Title>
          <Dialog.Description id="catalog-import-confirmation-description">
            {t(
              action === 'media' && batch.overrideImages
                ? 'admin.imports.confirmation.mediaOverrideDescription'
                : `admin.imports.confirmation.${action}Description`,
              { key: batch.importKey },
            )}
          </Dialog.Description>
          <Dialog.Close asChild>
            <button className="admin-dialog__close" type="button" aria-label={t('common.close')}>
              <X aria-hidden="true" size={18} />
            </button>
          </Dialog.Close>
          <form onSubmit={submit}>
            <FormField
              name="confirmation"
              label={t('admin.imports.confirmation.typePhrase', { phrase })}
              error={confirmationError ? t('admin.imports.confirmation.phraseMismatch') : undefined}
              autoComplete="off"
              required
            />
            {errorLabel(error, t) ? (
              <p className="admin-action-error" role="alert">
                {errorLabel(error, t)}
              </p>
            ) : null}
            <div className="admin-dialog__actions">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost">
                  {t('common.cancel')}
                </Button>
              </Dialog.Close>
              <Button
                type="submit"
                variant={action === 'rollback' ? 'danger' : 'admin'}
                loading={pending}
              >
                {t(`admin.imports.${action}`)}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function BatchDetail({
  batch,
  onApply,
  onMedia,
  onRollback,
}: {
  batch: AdminCatalogImportBatch;
  onApply: () => void;
  onMedia: () => void;
  onRollback: () => void;
}) {
  const { t } = useTranslation();
  const canApply =
    batch.dryRun && batch.status === 'PREVIEW_VALID' && batch.result.canApply !== false;
  return (
    <article className="admin-import-detail">
      <div className="admin-import-detail__heading">
        <div>
          <span className="admin-kicker">{t('admin.imports.batchReceipt')}</span>
          <h2>{batch.importKey}</h2>
        </div>
        <ImportStatus status={batch.status} />
      </div>
      <BatchFacts batch={batch} />
      <ImportOptions batch={batch} />
      {canApply || isMediaImportCandidate(batch) || isRollbackCandidate(batch) ? (
        <div className="admin-import-detail__actions">
          {canApply ? (
            <Button type="button" variant="admin" onClick={onApply}>
              <CheckCircle2 aria-hidden="true" size={18} />
              {t('admin.imports.apply')}
            </Button>
          ) : null}
          {isMediaImportCandidate(batch) ? (
            <Button type="button" variant="admin" onClick={onMedia}>
              <Images aria-hidden="true" size={18} />
              {t('admin.imports.media')}
            </Button>
          ) : null}
          {isRollbackCandidate(batch) ? (
            <Button type="button" variant="danger" onClick={onRollback}>
              <RotateCcw aria-hidden="true" size={18} />
              {t('admin.imports.rollback')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <ResultSummary batch={batch} />
      <MediaImportReport batch={batch} />
      <RowReport batch={batch} />
    </article>
  );
}

function QueryContent({
  pending,
  error,
  empty,
  retry,
  children,
}: {
  pending: boolean;
  error: Error | null;
  empty: boolean;
  retry: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (pending) return <LoadingState label={t('common.loading')} tone="admin" />;
  if (error instanceof ApiError && error.status === 403) {
    return <EmptyState title={t('admin.accessDenied')} />;
  }
  if (error) return <ErrorState onRetry={retry} />;
  if (empty) {
    return (
      <EmptyState
        title={t('admin.imports.historyEmptyTitle')}
        body={t('admin.imports.historyEmptyBody')}
      />
    );
  }
  return children;
}

function AuthorizedCatalogImportsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [format, setFormat] = useState<AdminCatalogImportPreviewPayload['format']>('CSV');
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [confirmation, setConfirmation] = useState<{
    action: ConfirmationAction;
    batch: AdminCatalogImportBatch;
  } | null>(null);

  const history = useQuery({
    queryKey: ['admin', 'catalog-imports', page],
    queryFn: () => adminDataClient.catalogImportHistory(page, HISTORY_PAGE_SIZE),
    placeholderData: (previous) => previous,
  });
  const detail = useQuery({
    queryKey: ['admin', 'catalog-import', selectedId],
    queryFn: () => adminDataClient.catalogImport(selectedId!),
    enabled: Boolean(selectedId),
  });

  const rememberBatch = (batch: AdminCatalogImportBatch) => {
    queryClient.setQueryData(['admin', 'catalog-import', batch.id], batch);
    setSelectedId(batch.id);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'catalog-imports'] });
  };

  const preview = useMutation({
    mutationFn: (payload: AdminCatalogImportPreviewPayload) =>
      adminDataClient.previewCatalogImport(payload, setUploadProgress),
    onMutate: () => {
      setFileError(null);
      setUploadProgress(0);
    },
    onSuccess: rememberBatch,
  });
  const wotofoPreview = useMutation({
    mutationFn: (importKey: string) => adminDataClient.previewOfficialWotofoCatalog(importKey),
    onSuccess: rememberBatch,
  });
  const template = useMutation({
    mutationFn: () => adminDataClient.downloadCatalogImportTemplate(),
    onSuccess: downloadCsv,
  });
  const apply = useMutation({
    mutationFn: (id: string) => adminDataClient.applyCatalogImport(id),
    onSuccess: (batch) => {
      rememberBatch(batch);
      setConfirmation(null);
    },
  });
  const rollback = useMutation({
    mutationFn: (id: string) => adminDataClient.rollbackCatalogImport(id),
    onSuccess: (batch) => {
      rememberBatch(batch);
      setConfirmation(null);
    },
  });
  const media = useMutation({
    mutationFn: (id: string) => adminDataClient.importCatalogMedia(id),
    onSuccess: ({ batch, report }) => {
      rememberBatch({ ...batch, result: { ...batch.result, media: report } });
      setConfirmation(null);
    },
  });

  const submitFile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fileControl = event.currentTarget.elements.namedItem('file');
    const candidate =
      fileControl instanceof HTMLInputElement ? fileControl.files?.item(0) : undefined;
    if (!candidate || candidate.size === 0) {
      setFileError(t('admin.imports.fileRequired'));
      return;
    }
    if (candidate.size > MAX_IMPORT_BYTES) {
      setFileError(t('admin.imports.fileTooLarge'));
      return;
    }
    const expectedExtension = format === 'CSV' ? '.csv' : '.json';
    if (!candidate.name.toLowerCase().endsWith(expectedExtension)) {
      setFileError(t('admin.imports.fileFormatMismatch'));
      return;
    }
    preview.mutate({
      file: candidate,
      importKey: formString(form, 'importKey'),
      format,
      partialMode: form.get('partialMode') === 'on',
      overridePrice: form.get('overridePrice') === 'on',
      overrideStatus: form.get('overrideStatus') === 'on',
      overrideImages: form.get('overrideImages') === 'on',
    });
  };

  const submitWotofo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    wotofoPreview.mutate(formString(new FormData(event.currentTarget), 'wotofoImportKey'));
  };

  const displayedBatch = detail.data;
  const actionError = template.error;

  return (
    <div className="admin-page admin-catalog-imports">
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">{t('brand.adminShort')}</span>
          <h1>{t('admin.imports.title')}</h1>
          <p>{t('admin.imports.subtitle')}</p>
        </div>
        <div className="admin-heading-actions">
          <Button asChild variant="ghost">
            <Link to="/admin/catalog">{t('admin.imports.backToCatalog')}</Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            loading={template.isPending}
            onClick={() => template.mutate()}
          >
            <Download aria-hidden="true" size={18} />
            {t('admin.imports.downloadTemplate')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('admin.refresh')}
            onClick={() => void history.refetch()}
          >
            <RefreshCw aria-hidden="true" size={18} />
          </Button>
        </div>
      </header>

      {template.isSuccess ? (
        <p className="admin-action-success" role="status">
          {t('admin.imports.templateDownloaded')}
        </p>
      ) : null}
      {errorLabel(actionError, t) ? (
        <p className="admin-action-error" role="alert">
          {errorLabel(actionError, t)}
        </p>
      ) : null}

      <div className="admin-import-entry-grid">
        <section className="admin-import-card" aria-labelledby="file-import-title">
          <div className="admin-import-card__heading">
            <FileSpreadsheet aria-hidden="true" size={24} />
            <div>
              <h2 id="file-import-title">{t('admin.imports.fileTitle')}</h2>
              <p>{t('admin.imports.fileBody')}</p>
            </div>
          </div>
          <form onSubmit={submitFile}>
            <FormField
              name="importKey"
              label={t('admin.imports.importKey')}
              hint={t('admin.imports.importKeyHint')}
              minLength={3}
              maxLength={100}
              pattern={IMPORT_KEY_PATTERN}
              required
              autoComplete="off"
            />
            <SelectField
              name="format"
              label={t('admin.imports.formatLabel')}
              value={format}
              onChange={(event) => setFormat(event.currentTarget.value as 'CSV' | 'JSON')}
            >
              <option value="CSV">{t('admin.imports.formats.CSV')}</option>
              <option value="JSON">{t('admin.imports.formats.JSON')}</option>
            </SelectField>
            <div className={`field ${fileError ? 'field--error' : ''}`}>
              <label htmlFor="catalog-import-file">{t('admin.imports.fileLabel')}</label>
              <input
                id="catalog-import-file"
                name="file"
                type="file"
                accept={format === 'CSV' ? '.csv,text/csv' : '.json,application/json'}
                aria-invalid={Boolean(fileError)}
                aria-describedby="catalog-import-file-hint"
                required
                onChange={() => setFileError(null)}
              />
              <p id="catalog-import-file-hint" className="field__hint">
                {t('admin.imports.fileHint')}
              </p>
              {fileError ? (
                <p className="field__error" role="alert">
                  {fileError}
                </p>
              ) : null}
            </div>
            <fieldset className="admin-import-options">
              <legend>{t('admin.imports.optionsTitle')}</legend>
              <CheckboxField name="partialMode" label={t('admin.imports.partialMode')} />
              <CheckboxField name="overridePrice" label={t('admin.imports.overridePrice')} />
              <CheckboxField name="overrideStatus" label={t('admin.imports.overrideStatus')} />
              <CheckboxField name="overrideImages" label={t('admin.imports.overrideImages')} />
            </fieldset>
            {preview.error ? (
              <p className="admin-action-error" role="alert">
                {errorLabel(preview.error, t)}
              </p>
            ) : null}
            {preview.isPending ? (
              <div className="admin-import-progress">
                <label htmlFor="catalog-import-progress">{t('admin.imports.uploadProgress')}</label>
                <progress id="catalog-import-progress" max={100} value={uploadProgress}>
                  {uploadProgress}%
                </progress>
                <span>{uploadProgress}%</span>
              </div>
            ) : null}
            <Button type="submit" variant="admin" loading={preview.isPending}>
              <FileJson aria-hidden="true" size={18} />
              {t('admin.imports.previewFile')}
            </Button>
          </form>
        </section>

        <AdminDisclosure
          className="admin-import-advanced"
          title={t('admin.imports.wotofoTitle')}
          description={t('admin.imports.wotofoBody')}
        >
          <section className="admin-import-card" aria-label={t('admin.imports.wotofoTitle')}>
            <form onSubmit={submitWotofo}>
              <FormField
                name="wotofoImportKey"
                label={t('admin.imports.importKey')}
                hint={t('admin.imports.wotofoImportKeyHint')}
                minLength={3}
                maxLength={100}
                pattern={IMPORT_KEY_PATTERN}
                required
                autoComplete="off"
              />
              <div className="admin-import-safety-note">
                <ShieldAlert aria-hidden="true" size={19} />
                <p>{t('admin.imports.wotofoSafety')}</p>
              </div>
              {wotofoPreview.error ? (
                <p className="admin-action-error" role="alert">
                  {errorLabel(wotofoPreview.error, t)}
                </p>
              ) : null}
              <Button type="submit" variant="admin" loading={wotofoPreview.isPending}>
                {t('admin.imports.previewWotofo')}
              </Button>
            </form>
          </section>
        </AdminDisclosure>
      </div>

      <section className="admin-import-section" aria-labelledby="current-import-title">
        <div className="admin-panel__heading">
          <div>
            <h2 id="current-import-title">{t('admin.imports.currentTitle')}</h2>
            <p>{t('admin.imports.currentBody')}</p>
          </div>
        </div>
        {!selectedId ? (
          <EmptyState
            title={t('admin.imports.noSelectionTitle')}
            body={t('admin.imports.noSelectionBody')}
          />
        ) : detail.isPending ? (
          <LoadingState label={t('common.loading')} tone="admin" />
        ) : detail.isError ? (
          <ErrorState onRetry={() => void detail.refetch()} />
        ) : displayedBatch ? (
          <BatchDetail
            batch={displayedBatch}
            onApply={() => setConfirmation({ action: 'apply', batch: displayedBatch })}
            onMedia={() => setConfirmation({ action: 'media', batch: displayedBatch })}
            onRollback={() => setConfirmation({ action: 'rollback', batch: displayedBatch })}
          />
        ) : null}
      </section>

      <section className="admin-import-section" aria-labelledby="import-history-title">
        <div className="admin-panel__heading">
          <div>
            <h2 id="import-history-title">
              <History aria-hidden="true" size={20} /> {t('admin.imports.historyTitle')}
            </h2>
            <p>{t('admin.imports.historyBody')}</p>
          </div>
        </div>
        <QueryContent
          pending={history.isPending}
          error={history.error}
          empty={Boolean(history.data && history.data.items.length === 0)}
          retry={() => void history.refetch()}
        >
          {history.data ? (
            <>
              <div className="admin-table-wrap">
                <table className="admin-table admin-import-history-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('admin.imports.importKey')}</th>
                      <th scope="col">{t('admin.imports.sourceLabel')}</th>
                      <th scope="col">{t('common.status')}</th>
                      <th scope="col">{t('admin.imports.rows')}</th>
                      <th scope="col">{t('admin.imports.createdAt')}</th>
                      <th scope="col">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.data.items.map((batch) => (
                      <tr key={batch.id}>
                        <td>
                          <strong>{batch.importKey}</strong>
                          <small>
                            {t(batch.dryRun ? 'admin.imports.dryRun' : 'admin.imports.appliedMode')}
                          </small>
                        </td>
                        <td>{t(`admin.imports.sources.${batch.source}`)}</td>
                        <td>
                          <ImportStatus status={batch.status} />
                        </td>
                        <td>{batch.rowCount}</td>
                        <td>
                          <LocalDate value={batch.createdAt} />
                        </td>
                        <td>
                          <Button
                            type="button"
                            variant="ghost"
                            aria-pressed={selectedId === batch.id}
                            onClick={() => setSelectedId(batch.id)}
                          >
                            {t('admin.imports.viewDetails')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {history.data.totalPages > 1 ? (
                <nav className="admin-pagination" aria-label={t('common.pagination')}>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={page <= 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  >
                    {t('common.previous')}
                  </Button>
                  <span>
                    {t('common.pageOf', {
                      page: history.data.page,
                      pages: history.data.totalPages,
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={page >= history.data.totalPages}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    {t('common.next')}
                  </Button>
                </nav>
              ) : null}
            </>
          ) : null}
        </QueryContent>
      </section>

      {confirmation ? (
        <ConfirmationDialog
          action={confirmation.action}
          batch={confirmation.batch}
          pending={
            confirmation.action === 'apply'
              ? apply.isPending
              : confirmation.action === 'media'
                ? media.isPending
                : rollback.isPending
          }
          error={
            confirmation.action === 'apply'
              ? apply.error
              : confirmation.action === 'media'
                ? media.error
                : rollback.error
          }
          onClose={() => {
            apply.reset();
            media.reset();
            rollback.reset();
            setConfirmation(null);
          }}
          onConfirm={() => {
            if (confirmation.action === 'apply') apply.mutate(confirmation.batch.id);
            else if (confirmation.action === 'media') media.mutate(confirmation.batch.id);
            else rollback.mutate(confirmation.batch.id);
          }}
        />
      ) : null}
    </div>
  );
}

export function AdminCatalogImportsPage() {
  const { t } = useTranslation();
  const { user } = useAdminAuth();
  if (!user?.permissions.includes('catalog.import')) {
    return (
      <div className="admin-page">
        <EmptyState title={t('admin.accessDenied')} />
      </div>
    );
  }
  return <AuthorizedCatalogImportsPage />;
}
