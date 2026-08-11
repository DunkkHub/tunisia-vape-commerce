import { RefreshCw, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/ui/button';
import { FormField, SelectField } from '../../components/ui/form-field';
import {
  DEFAULT_MEDIA_EDIT_SETTINGS,
  mediaEditSettingsAreOriginal,
  processMediaFile,
  type MediaCropAspect,
  type MediaEditSettings,
  type MediaOutputType,
} from './product-media-editor-utils';

export type MediaEditorStatus = 'original' | 'processing' | 'edited' | 'error';

interface AdminProductMediaEditorProps {
  file: File;
  idPrefix: string;
  disabled?: boolean;
  onOutput: (file: File, status: Exclude<MediaEditorStatus, 'processing' | 'error'>) => void;
  onStatusChange?: (status: MediaEditorStatus) => void;
}

const fileIdentity = (file: File): string =>
  `${file.name}:${file.type}:${file.size}:${file.lastModified}`;

const parsedLimit = (value: string): number | null => {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
};

export function AdminProductMediaEditor(props: AdminProductMediaEditorProps) {
  return <MediaEditorSession key={fileIdentity(props.file)} {...props} />;
}

function MediaEditorSession({
  file,
  idPrefix,
  disabled = false,
  onOutput,
  onStatusChange,
}: AdminProductMediaEditorProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<MediaEditSettings>(DEFAULT_MEDIA_EDIT_SETTINGS);
  const [preview, setPreview] = useState(() => ({
    file,
    url: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null,
  }));
  const [status, setStatus] = useState<MediaEditorStatus>('original');
  const [retryNonce, setRetryNonce] = useState(0);
  const outputRef = useRef(onOutput);
  const statusRef = useRef(onStatusChange);
  const previewUrlRef = useRef(preview.url);

  useEffect(() => {
    outputRef.current = onOutput;
    statusRef.current = onStatusChange;
  }, [onOutput, onStatusChange]);

  const showPreview = useCallback((nextFile: File) => {
    const nextUrl =
      typeof URL.createObjectURL === 'function' ? URL.createObjectURL(nextFile) : null;
    const previousUrl = previewUrlRef.current;
    previewUrlRef.current = nextUrl;
    setPreview({ file: nextFile, url: nextUrl });
    if (previousUrl && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(previousUrl);
    }
  }, []);

  useEffect(
    () => () => {
      const activeUrl = previewUrlRef.current;
      if (activeUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(activeUrl);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    if (mediaEditSettingsAreOriginal(settings)) return undefined;

    const timer = window.setTimeout(() => {
      void processMediaFile(file, settings)
        .then((output) => {
          if (cancelled) return;
          showPreview(output);
          setStatus('edited');
          statusRef.current?.('edited');
          outputRef.current(output, 'edited');
        })
        .catch(() => {
          if (cancelled) return;
          setStatus('error');
          statusRef.current?.('error');
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [file, retryNonce, settings, showPreview]);

  const markProcessing = () => {
    setStatus('processing');
    statusRef.current?.('processing');
  };

  const applySettings = (nextSettings: MediaEditSettings) => {
    setSettings(nextSettings);
    if (mediaEditSettingsAreOriginal(nextSettings)) {
      showPreview(file);
      setStatus('original');
      statusRef.current?.('original');
      outputRef.current(file, 'original');
      return;
    }
    markProcessing();
  };

  const updateSetting = <Key extends keyof MediaEditSettings>(
    key: Key,
    value: MediaEditSettings[Key],
  ) => {
    applySettings({ ...settings, [key]: value });
  };

  const rotate = (direction: -1 | 1) => {
    applySettings({
      ...settings,
      rotation: ((settings.rotation + direction * 90 + 360) % 360) as MediaEditSettings['rotation'],
    });
  };

  const restoreOriginal = () => {
    applySettings(DEFAULT_MEDIA_EDIT_SETTINGS);
    setRetryNonce((current) => current + 1);
  };

  return (
    <div className="admin-media-editor">
      {preview.url ? (
        <figure className="admin-media-preview">
          <img src={preview.url} alt={t('admin.media.previewAlt')} />
          <figcaption>
            <strong>{preview.file.name}</strong>
            <span>
              {preview.file.type || t('admin.media.unknownType')} ·{' '}
              {Math.ceil(preview.file.size / 1024)} KB
            </span>
            <span className={`admin-media-editor__status admin-media-editor__status--${status}`}>
              {t(`admin.media.editor.status.${status}`)}
            </span>
          </figcaption>
        </figure>
      ) : null}

      <details className="admin-media-editor__details">
        <summary>{t('admin.media.editor.title')}</summary>
        <p className="admin-media-editor__hint">{t('admin.media.editor.description')}</p>
        <div className="admin-media-editor__controls">
          <SelectField
            id={`${idPrefix}-crop`}
            label={t('admin.media.editor.cropAspect')}
            value={settings.cropAspect}
            disabled={disabled}
            onChange={(event) =>
              updateSetting('cropAspect', event.currentTarget.value as MediaCropAspect)
            }
          >
            <option value="original">{t('admin.media.editor.aspectOriginal')}</option>
            <option value="1:1">1:1</option>
            <option value="4:5">4:5</option>
            <option value="16:9">16:9</option>
          </SelectField>
          <div
            className="admin-media-editor__rotation"
            role="group"
            aria-label={t('admin.media.editor.rotation')}
          >
            <Button type="button" variant="ghost" disabled={disabled} onClick={() => rotate(-1)}>
              <RotateCcw aria-hidden="true" size={17} />
              {t('admin.media.editor.rotateLeft')}
            </Button>
            <Button type="button" variant="ghost" disabled={disabled} onClick={() => rotate(1)}>
              <RotateCw aria-hidden="true" size={17} />
              {t('admin.media.editor.rotateRight')}
            </Button>
          </div>
          <label className="admin-media-editor__range" htmlFor={`${idPrefix}-focus-x`}>
            <span>{t('admin.media.editor.focusX', { value: settings.focusX })}</span>
            <input
              id={`${idPrefix}-focus-x`}
              type="range"
              min={0}
              max={100}
              value={settings.focusX}
              disabled={disabled || settings.cropAspect === 'original'}
              onChange={(event) => updateSetting('focusX', Number(event.currentTarget.value))}
            />
          </label>
          <label className="admin-media-editor__range" htmlFor={`${idPrefix}-focus-y`}>
            <span>{t('admin.media.editor.focusY', { value: settings.focusY })}</span>
            <input
              id={`${idPrefix}-focus-y`}
              type="range"
              min={0}
              max={100}
              value={settings.focusY}
              disabled={disabled || settings.cropAspect === 'original'}
              onChange={(event) => updateSetting('focusY', Number(event.currentTarget.value))}
            />
          </label>
          <FormField
            id={`${idPrefix}-max-width`}
            type="number"
            min={64}
            max={12000}
            step={1}
            label={t('admin.media.editor.maxWidth')}
            placeholder={t('admin.media.editor.noLimit')}
            value={settings.maxWidth ?? ''}
            disabled={disabled}
            onChange={(event) => updateSetting('maxWidth', parsedLimit(event.currentTarget.value))}
          />
          <FormField
            id={`${idPrefix}-max-height`}
            type="number"
            min={64}
            max={12000}
            step={1}
            label={t('admin.media.editor.maxHeight')}
            placeholder={t('admin.media.editor.noLimit')}
            value={settings.maxHeight ?? ''}
            disabled={disabled}
            onChange={(event) => updateSetting('maxHeight', parsedLimit(event.currentTarget.value))}
          />
          <SelectField
            id={`${idPrefix}-format`}
            label={t('admin.media.editor.outputFormat')}
            value={settings.outputType}
            disabled={disabled}
            onChange={(event) =>
              updateSetting('outputType', event.currentTarget.value as MediaOutputType)
            }
          >
            <option value="image/webp">WebP</option>
            <option value="image/jpeg">JPEG</option>
            <option value="image/png">PNG</option>
          </SelectField>
          <label className="admin-media-editor__range" htmlFor={`${idPrefix}-quality`}>
            <span>{t('admin.media.editor.quality', { value: settings.quality })}</span>
            <input
              id={`${idPrefix}-quality`}
              type="range"
              min={40}
              max={100}
              value={settings.quality}
              disabled={disabled || settings.outputType === 'image/png'}
              onChange={(event) => updateSetting('quality', Number(event.currentTarget.value))}
            />
          </label>
        </div>
        <div className="admin-media-editor__actions">
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || mediaEditSettingsAreOriginal(settings)}
            onClick={restoreOriginal}
          >
            <Undo2 aria-hidden="true" size={17} />
            {t('admin.media.editor.restoreOriginal')}
          </Button>
          {status === 'error' ? (
            <Button
              type="button"
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                markProcessing();
                setRetryNonce((current) => current + 1);
              }}
            >
              <RefreshCw aria-hidden="true" size={17} />
              {t('common.retry')}
            </Button>
          ) : null}
        </div>
        {status === 'processing' ? (
          <p className="admin-media-editor__notice" role="status" aria-live="polite">
            {t('admin.media.editor.processing')}
          </p>
        ) : null}
        {status === 'error' ? (
          <p className="field__error" role="alert">
            {t('admin.media.editor.error')}
          </p>
        ) : null}
      </details>
    </div>
  );
}
