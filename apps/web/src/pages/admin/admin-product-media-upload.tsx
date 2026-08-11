import { ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { adminDataClient } from '../../api/admin-data-client';
import { ApiError } from '../../api/http';
import type { AdminProductVariantRead } from '../../api/types';
import { Button } from '../../components/ui/button';
import { CheckboxField, FormField, SelectField } from '../../components/ui/form-field';
import { AdminProductMediaEditor, type MediaEditorStatus } from './admin-product-media-editor';

type UploadStatus = 'ready' | 'uploading' | 'uploaded' | 'error';

interface UploadDraft {
  id: string;
  originalFile: File;
  outputFile: File;
  altTextFr: string;
  altTextAr: string;
  editorStatus: MediaEditorStatus;
  uploadStatus: UploadStatus;
  progress: number;
  error: string | null;
}

const acceptedMediaTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
let uploadDraftSequence = 0;

const nextDraftId = (): string => {
  uploadDraftSequence += 1;
  return `product-media-upload-${uploadDraftSequence}`;
};

const safeUploadError = (error: unknown, fallback: string, duplicate: string): string => {
  if (error instanceof ApiError && error.code === 'PRODUCT_IMAGE_DUPLICATE') return duplicate;
  if (error instanceof ApiError && error.message.trim()) return error.message;
  return fallback;
};

export function AdminProductMediaUpload({
  productId,
  productVersion,
  variants,
  disabled,
  onBusyChange,
  onRefresh,
  onUploaded,
}: {
  productId: string;
  productVersion: number;
  variants: AdminProductVariantRead[];
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
  onUploaded: (message: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<UploadDraft[]>([]);
  const [variantId, setVariantId] = useState('');
  const [makePrimary, setMakePrimary] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [batchVersion, setBatchVersion] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);

  const updateDraft = (id: string, update: Partial<UploadDraft>) => {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...update } : draft)),
    );
  };

  const selectFiles = (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    const accepted = selected.filter((file) => acceptedMediaTypes.has(file.type)).slice(0, 20);
    const rejectedCount = selected.length - accepted.length;
    setSelectionError(
      selected.length > 20
        ? t('admin.media.batch.tooMany')
        : rejectedCount > 0
          ? t('admin.media.batch.unsupported')
          : null,
    );
    setBatchVersion(null);
    setDrafts(
      accepted.map((file) => ({
        id: nextDraftId(),
        originalFile: file,
        outputFile: file,
        altTextFr: '',
        altTextAr: '',
        editorStatus: 'original',
        uploadStatus: 'ready',
        progress: 0,
        error: null,
      })),
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (uploading) return;
    const pending = drafts.filter((draft) => draft.uploadStatus !== 'uploaded');
    if (!pending.length) return;

    const variantVersion = variantId
      ? variants.find((variant) => variant.id === variantId)?.version
      : productVersion;
    let ownerVersion = Math.max(batchVersion ?? 0, variantVersion ?? 0);
    if (ownerVersion <= 0) {
      setSelectionError(t('admin.media.batch.ownerUnavailable'));
      return;
    }

    setSelectionError(null);
    setUploading(true);
    onBusyChange(true);
    try {
      for (const draft of pending) {
        updateDraft(draft.id, { uploadStatus: 'uploading', progress: 0, error: null });
        try {
          const uploaded = await adminDataClient.uploadProductImage(
            productId,
            {
              file: draft.outputFile,
              expectedOwnerVersion: ownerVersion,
              ...(variantId ? { variantId } : {}),
              altTextFr: draft.altTextFr.trim(),
              altTextAr: draft.altTextAr.trim(),
              isPrimary: makePrimary && drafts[0]?.id === draft.id,
            },
            (progress) => updateDraft(draft.id, { progress }),
          );
          ownerVersion = uploaded.ownerVersion;
          setBatchVersion(ownerVersion);
          updateDraft(draft.id, { uploadStatus: 'uploaded', progress: 100 });
        } catch (error) {
          updateDraft(draft.id, {
            uploadStatus: 'error',
            error: safeUploadError(
              error,
              t('admin.media.batch.uploadFailed'),
              t('admin.media.duplicate'),
            ),
          });
          throw error;
        }
      }

      await onUploaded(
        drafts.length === 1 ? t('admin.media.uploaded') : t('admin.media.batch.uploaded'),
      );
      setDrafts([]);
      setBatchVersion(null);
      setMakePrimary(false);
      if (inputRef.current) inputRef.current.value = '';
    } catch {
      // The failed item remains staged. Confirmed uploads are not repeated on retry.
      await onRefresh();
    } finally {
      setUploading(false);
      onBusyChange(false);
    }
  };

  const formInvalid = drafts.some(
    (draft) =>
      !draft.altTextFr.trim() ||
      !draft.altTextAr.trim() ||
      draft.editorStatus === 'processing' ||
      draft.editorStatus === 'error',
  );
  const ownerLocked = uploading || drafts.some((draft) => draft.uploadStatus === 'uploaded');
  const hasRetry = drafts.some((draft) => draft.uploadStatus === 'error');

  return (
    <form className="admin-media-upload" onSubmit={(event) => void submit(event)}>
      <div className="admin-form-grid">
        <div className="field">
          <label htmlFor="product-image-file">{t('admin.media.file')}</label>
          <input
            ref={inputRef}
            id="product-image-file"
            name="file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            disabled={disabled || uploading}
            onChange={(event) => selectFiles(event.currentTarget.files)}
            required={drafts.length === 0}
          />
          <small>{t('admin.media.batch.allowedTypes')}</small>
        </div>
        <SelectField
          name="variantId"
          label={t('admin.media.owner')}
          value={variantId}
          disabled={disabled || ownerLocked}
          onChange={(event) => {
            setVariantId(event.currentTarget.value);
            setBatchVersion(null);
          }}
        >
          <option value="">{t('admin.media.productOwner')}</option>
          {variants
            .filter((variant) => !variant.archivedAt)
            .map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.nameFr} · {variant.sku}
              </option>
            ))}
        </SelectField>
      </div>

      {selectionError ? (
        <p className="field__error" role="alert">
          {selectionError}
        </p>
      ) : null}

      {drafts.length ? (
        <div className="admin-media-batch" aria-labelledby="admin-media-batch-title">
          <div className="admin-media-batch__heading">
            <div>
              <h3 id="admin-media-batch-title">{t('admin.media.batch.title')}</h3>
              <p>{t('admin.media.batch.count', { count: drafts.length })}</p>
            </div>
          </div>
          {drafts.map((draft, index) => {
            const itemDisabled = disabled || uploading || draft.uploadStatus === 'uploaded';
            return (
              <article className="admin-media-batch__item" key={draft.id}>
                <header className="admin-media-batch__item-heading">
                  <strong>{t('admin.media.batch.item', { index: index + 1 })}</strong>
                  {draft.uploadStatus !== 'uploaded' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={disabled || uploading}
                      aria-label={t('admin.media.batch.remove', { name: draft.originalFile.name })}
                      onClick={() =>
                        setDrafts((current) => current.filter((item) => item.id !== draft.id))
                      }
                    >
                      <Trash2 aria-hidden="true" size={16} />
                      {t('admin.media.batch.removeShort')}
                    </Button>
                  ) : null}
                </header>
                <AdminProductMediaEditor
                  file={draft.originalFile}
                  idPrefix={draft.id}
                  disabled={itemDisabled}
                  onOutput={(file, editorStatus) =>
                    updateDraft(draft.id, {
                      outputFile: file,
                      editorStatus,
                      error: null,
                      ...(draft.uploadStatus === 'error' ? { uploadStatus: 'ready' } : {}),
                    })
                  }
                  onStatusChange={(editorStatus) => updateDraft(draft.id, { editorStatus })}
                />
                <div className="admin-form-grid">
                  <FormField
                    id={`${draft.id}-alt-fr`}
                    label={t('admin.media.altFr')}
                    maxLength={300}
                    value={draft.altTextFr}
                    disabled={itemDisabled}
                    required
                    onChange={(event) =>
                      updateDraft(draft.id, { altTextFr: event.currentTarget.value, error: null })
                    }
                  />
                  <FormField
                    id={`${draft.id}-alt-ar`}
                    label={t('admin.media.altAr')}
                    maxLength={300}
                    dir="rtl"
                    value={draft.altTextAr}
                    disabled={itemDisabled}
                    required
                    onChange={(event) =>
                      updateDraft(draft.id, { altTextAr: event.currentTarget.value, error: null })
                    }
                  />
                </div>
                {draft.uploadStatus === 'uploading' || draft.uploadStatus === 'uploaded' ? (
                  <div className="admin-media-progress" aria-live="polite">
                    <span>{t('admin.media.uploadProgress', { percent: draft.progress })}</span>
                    <progress
                      aria-label={t('admin.media.uploadProgressLabel')}
                      max={100}
                      value={draft.progress}
                    />
                  </div>
                ) : null}
                {draft.error ? (
                  <p className="field__error" role="alert">
                    {draft.error}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      <CheckboxField
        name="isPrimary"
        label={t('admin.media.batch.makeFirstPrimary')}
        checked={makePrimary}
        disabled={disabled || ownerLocked || drafts.length === 0}
        onChange={(event) => setMakePrimary(event.currentTarget.checked)}
      />
      <div className="admin-media-upload__actions">
        <Button
          type="submit"
          variant="admin"
          loading={uploading}
          disabled={disabled || drafts.length === 0 || formInvalid}
        >
          {hasRetry ? (
            <RefreshCw aria-hidden="true" size={17} />
          ) : (
            <ImagePlus aria-hidden="true" size={17} />
          )}
          {hasRetry ? t('admin.media.batch.retry') : t('admin.media.upload')}
        </Button>
        <span className="admin-media-upload__security-note">
          {t('admin.media.batch.serverValidation')}
        </span>
      </div>
    </form>
  );
}
