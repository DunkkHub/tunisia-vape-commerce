import { RefreshCw } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/ui/button';
import { AdminProductMediaEditor, type MediaEditorStatus } from './admin-product-media-editor';

export function AdminProductMediaReplacement({
  imageId,
  resetToken,
  ...props
}: {
  imageId: string;
  disabled: boolean;
  pending: boolean;
  progress: number | null;
  failed: boolean;
  resetToken: number;
  onReplace: (file: File) => void;
}) {
  return (
    <AdminProductMediaReplacementSession
      key={`${imageId}:${resetToken}`}
      imageId={imageId}
      {...props}
    />
  );
}

function AdminProductMediaReplacementSession({
  imageId,
  disabled,
  pending,
  progress,
  failed,
  onReplace,
}: {
  imageId: string;
  disabled: boolean;
  pending: boolean;
  progress: number | null;
  failed: boolean;
  onReplace: (file: File) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [outputFile, setOutputFile] = useState<File | null>(null);
  const [editorStatus, setEditorStatus] = useState<MediaEditorStatus>('original');
  const locked = disabled || pending;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (outputFile && editorStatus !== 'processing' && editorStatus !== 'error') {
      onReplace(outputFile);
    }
  };

  return (
    <form className="admin-media-replace" onSubmit={submit}>
      <label htmlFor={`replace-${imageId}`}>{t('admin.media.replace')}</label>
      <input
        ref={inputRef}
        id={`replace-${imageId}`}
        name="file"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        disabled={locked}
        onChange={(event) => {
          const file = event.currentTarget.files?.item(0) ?? null;
          setOriginalFile(file);
          setOutputFile(file);
          setEditorStatus('original');
        }}
        required
      />
      {originalFile ? (
        <AdminProductMediaEditor
          file={originalFile}
          idPrefix={`replace-${imageId}`}
          disabled={locked}
          onOutput={(file, status) => {
            setOutputFile(file);
            setEditorStatus(status);
          }}
          onStatusChange={setEditorStatus}
        />
      ) : null}
      <Button
        type="submit"
        variant="ghost"
        loading={pending}
        disabled={
          locked || !outputFile || editorStatus === 'processing' || editorStatus === 'error'
        }
      >
        {failed ? <RefreshCw aria-hidden="true" size={17} /> : null}
        {failed ? t('common.retry') : t('admin.media.replace')}
      </Button>
      {pending && progress !== null ? (
        <div className="admin-media-progress" aria-live="polite">
          <span>{t('admin.media.replaceProgress', { percent: progress })}</span>
          <progress aria-label={t('admin.media.replaceProgressLabel')} max={100} value={progress} />
        </div>
      ) : null}
      {failed ? (
        <p className="field__error" role="alert">
          {t('admin.media.batch.replaceFailed')}
        </p>
      ) : null}
    </form>
  );
}
