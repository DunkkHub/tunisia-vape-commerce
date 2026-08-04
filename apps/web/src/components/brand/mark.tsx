import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function BrandMark({ storeName, admin = false }: { storeName?: string; admin?: boolean }) {
  const { t } = useTranslation();
  const resolvedStoreName = storeName?.trim() || t('brand.fallback');

  return (
    <Link
      className={`brand-mark ${admin ? 'brand-mark--admin' : ''}`}
      to={admin ? '/admin' : '/'}
      aria-label={admin ? t('brand.admin') : resolvedStoreName}
    >
      <span className="brand-mark__symbol" aria-hidden="true">
        {admin ? (
          <>
            <i />
            <i />
            <i />
          </>
        ) : (
          <svg viewBox="0 0 64 32" focusable="false">
            <path d="M4 23c8-1 12-8 20-10 8-2 14 2 21 3 5 1 10 0 15-2-4 6-11 10-19 10-7 0-12-3-18-2-6 1-11 4-19 1Z" />
            <path d="M22 11c6-7 15-8 24-5l-7 4" />
            <path d="m45 16 10 2-8 3" />
          </svg>
        )}
      </span>
      <span>
        <strong>{admin ? t('brand.admin') : resolvedStoreName}</strong>
        <small>{admin ? t('brand.adminShort') : t('brand.signature')}</small>
      </span>
    </Link>
  );
}
