import { AlertTriangle, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from './button';

export function LoadingState({
  label,
  tone = 'store',
}: {
  label: string;
  tone?: 'store' | 'admin';
}) {
  return (
    <div className={`state state--loading state--${tone}`} role="status" aria-live="polite">
      <LoaderCircle className="spin" aria-hidden="true" size={24} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  onRetry,
  compact = false,
  title,
  body,
}: {
  onRetry?: () => void;
  compact?: boolean;
  title?: string;
  body?: string;
}) {
  const { t } = useTranslation();
  return (
    <section className={`state state--error ${compact ? 'state--compact' : ''}`} role="alert">
      <AlertTriangle aria-hidden="true" size={24} />
      <div>
        <h2>{title ?? t('common.errorTitle')}</h2>
        <p>{body ?? t('common.errorBody')}</p>
      </div>
      {onRetry ? (
        <Button type="button" variant="secondary" onClick={onRetry}>
          <RefreshCw aria-hidden="true" size={17} />
          {t('common.retry')}
        </Button>
      ) : null}
    </section>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="state state--empty">
      <Inbox aria-hidden="true" size={27} />
      <div>
        <h2>{title}</h2>
        {body ? <p>{body}</p> : null}
      </div>
      {action}
    </section>
  );
}
