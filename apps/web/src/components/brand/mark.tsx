import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function BrandMark({ storeName, admin = false }: { storeName?: string; admin?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link
      className={`brand-mark ${admin ? 'brand-mark--admin' : ''}`}
      to={admin ? '/admin' : '/'}
      aria-label={storeName ?? t('brand.fallback')}
    >
      <span className="brand-mark__symbol" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        <strong>{admin ? t('brand.admin') : (storeName ?? t('brand.fallback'))}</strong>
        <small>{admin ? t('brand.adminShort') : t('brand.signature')}</small>
      </span>
    </Link>
  );
}
