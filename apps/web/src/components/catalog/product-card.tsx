import { ArrowUpRight, Plus, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { ProductSummary } from '../../api/types';
import { Price } from '../ui/price';

export function ProductCard({
  product,
  variant = 'default',
}: {
  product: ProductSummary;
  variant?: 'default' | 'featured';
}) {
  const { t } = useTranslation();
  const price = product.promotionalPriceMillimes ?? product.priceMillimes;
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
            src={product.primaryImage.url}
            alt={
              product.primaryImage.altText ?? t('product.imageAltFallback', { name: product.name })
            }
            width={product.primaryImage.width ?? 720}
            height={product.primaryImage.height ?? 720}
            loading="lazy"
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
