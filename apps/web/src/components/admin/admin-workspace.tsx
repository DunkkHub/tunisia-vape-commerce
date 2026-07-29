import { ChevronDown, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface AdminWorkspaceItem<T extends string> {
  id: T;
  label: string;
  description: string;
  icon: LucideIcon;
}

export function AdminWorkspaceNav<T extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: T;
  items: AdminWorkspaceItem<T>[];
  onChange: (value: T) => void;
}) {
  const selectAt = (index: number) => {
    const normalizedIndex = (index + items.length) % items.length;
    const next = items[normalizedIndex];
    if (!next) return;
    onChange(next.id);
    globalThis.document?.getElementById(`admin-workspace-tab-${next.id}`)?.focus();
  };

  return (
    <nav className="admin-workspace-nav" aria-label={label}>
      <div className="admin-workspace-nav__items" role="tablist" aria-label={label}>
        {items.map(({ id, label: itemLabel, description, icon: Icon }, index) => (
          <button
            key={id}
            id={`admin-workspace-tab-${id}`}
            className="admin-workspace-nav__button"
            type="button"
            role="tab"
            aria-selected={value === id}
            aria-controls={`admin-workspace-panel-${id}`}
            tabIndex={value === id ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(event) => {
              const rtl = globalThis.document?.documentElement.dir === 'rtl';
              if (event.key === 'Home') {
                event.preventDefault();
                selectAt(0);
              } else if (event.key === 'End') {
                event.preventDefault();
                selectAt(items.length - 1);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                selectAt(index + 1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                selectAt(index - 1);
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                selectAt(index + (rtl ? -1 : 1));
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                selectAt(index + (rtl ? 1 : -1));
              }
            }}
          >
            <Icon aria-hidden="true" size={20} />
            <span>
              <strong>{itemLabel}</strong>
              <small>{description}</small>
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

export function AdminWorkspacePanel<T extends string>({
  id,
  value,
  children,
}: {
  id: T;
  value: T;
  children: ReactNode;
}) {
  return (
    <div
      id={`admin-workspace-panel-${id}`}
      className="admin-workspace-panel"
      role="tabpanel"
      aria-labelledby={`admin-workspace-tab-${id}`}
      hidden={value !== id}
    >
      {children}
    </div>
  );
}

export function AdminDisclosure({
  title,
  description,
  children,
  defaultOpen = false,
  className = '',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details className={`admin-disclosure ${className}`.trim()} open={defaultOpen || undefined}>
      <summary className="admin-disclosure__summary">
        <span>
          <strong role="heading" aria-level={2}>
            {title}
          </strong>
          {description ? <small>{description}</small> : null}
        </span>
        <ChevronDown aria-hidden="true" size={19} />
      </summary>
      <div className="admin-disclosure__content">{children}</div>
    </details>
  );
}
