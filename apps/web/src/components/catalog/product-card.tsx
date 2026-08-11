import { ArrowUpRight, Plus, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ProductSummary } from '../../api/types';
import { Price } from '../ui/price';

export function ProductCard({
  product,
  variant = 'default',
}: {
  product: ProductSummary;
  variant?: 'default' | 'featured';
}) {
  const { t, i18n } = useTranslation();
  const numberFormatter = new Intl.NumberFormat(i18n.resolvedLanguage === 'ar' ? 'ar-TN' : 'fr-TN');
  const price = product.promotionalPriceMillimes ?? product.priceMillimes;
  const nicotineStrengths =
    product.nicotineStrengthsMg ??
    (product.nicotineStrengthMg === null || product.nicotineStrengthMg === undefined
      ? []
      : [product.nicotineStrengthMg]);
  const availability =
    product.availableQuantity <= 0
      ? t('catalog.unavailable')
      : product.lowStock
        ? t('catalog.lowStock')
        : t('catalog.stockAvailable');

  return (
    <article
      className={`product-card ${variant === 'featured' ? 'product-card--featured' : ''}`}
      data-product-type={product.productType}
    >
      <Link
        to={`/products/${product.slug}`}
        aria-label={t('catalog.openProduct', { name: product.name })}
        className="product-card__media"
      >
        {product.primaryImage ? (
          <img
            src={product.primaryImage.renditions?.card ?? product.primaryImage.url}
            srcSet={
              product.primaryImage.renditions
                ? `${product.primaryImage.renditions.thumbnail} 160w, ${product.primaryImage.renditions.card} 720w, ${product.primaryImage.renditions.detail} 1200w`
                : undefined
            }
            sizes="(max-width: 640px) 92vw, (max-width: 1100px) 44vw, 320px"
            alt={
              product.primaryImage.altText ?? t('product.imageAltFallback', { name: product.name })
            }
            width={product.primaryImage.width ?? 720}
            height={product.primaryImage.height ?? 720}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="product-card__placeholder" aria-hidden="true">
            <i />
            <i />
          </span>
        )}
        <span
          className={`availability ${product.availableQuantity <= 0 ? 'availability--out' : ''}`}
        >
          {availability}
        </span>
      </Link>
      <div className="product-card__body">
        <div className="product-card__meta">
          <span>
            {product.brandName ?? t('brand.fallback')} ·{' '}
            {product.flavor ?? t(`admin.productTypes.${product.productType}`)}
          </span>
          {product.ageRestricted ? (
            <ShieldCheck aria-label={t('catalog.warning')} size={16} />
          ) : null}
        </div>
        <h3>
          <Link to={`/products/${product.slug}`}>{product.name}</Link>
        </h3>
        {product.shortDescription ? <p>{product.shortDescription}</p> : null}
        {product.puffCount || nicotineStrengths.length > 0 || product.selectableFlavorCount ? (
          <ul className="product-card__specs" aria-label={t('catalog.characteristics')}>
            {product.puffCount ? (
              <li>
                {t('catalog.puffCountValue', {
                  count: numberFormatter.format(product.puffCount),
                })}
              </li>
            ) : null}
            {nicotineStrengths.length > 0 ? (
              <li>
                {t('catalog.nicotineStrengthValue', {
                  strength: nicotineStrengths.join(' / '),
                })}
              </li>
            ) : null}
            {product.selectableFlavorCount ? (
              <li>
                {t('catalog.selectableFlavorCount', {
                  count: product.selectableFlavorCount,
                })}
              </li>
            ) : null}
          </ul>
        ) : null}
        <div className="product-card__foot">
          <Price millimes={price} />
          <Link
            className="round-link"
            to={`/products/${product.slug}`}
            aria-label={t('catalog.openProduct', { name: product.name })}
          >
            {variant === 'featured' ? (
              <Plus aria-hidden="true" size={20} />
            ) : (
              <ArrowUpRight aria-hidden="true" size={19} />
            )}
          </Link>
        </div>
      </div>
    </article>
  );
}
