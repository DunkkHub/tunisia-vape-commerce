import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Minus, Plus, ShieldAlert, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { storefrontClient } from '../../api/storefront-client';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { Price } from '../../components/ui/price';

export function ProductPage() {
  const { slug = '' } = useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  const productQuery = useQuery({
    queryKey: ['product', slug],
    queryFn: () => storefrontClient.product(slug),
    retry: false,
  });
  const [variantId, setVariantId] = useState('');
  const product = productQuery.data;

  const defaultVariantId =
    product?.variants.find((variant) => variant.availableQuantity > 0)?.id ??
    product?.variants[0]?.id ??
    '';
  const activeVariantId = product?.variants.some((variant) => variant.id === variantId)
    ? variantId
    : defaultVariantId;
  const selectedVariant = useMemo(
    () => product?.variants.find((variant) => variant.id === activeVariantId),
    [activeVariantId, product],
  );
  const available = selectedVariant?.availableQuantity ?? product?.availableQuantity ?? 0;
  const price =
    selectedVariant?.promotionalPriceMillimes ??
    selectedVariant?.priceMillimes ??
    product?.promotionalPriceMillimes ??
    product?.priceMillimes ??
    0;
  const addMutation = useMutation({
    mutationFn: () => {
      if (!activeVariantId) throw new Error(t('product.selectVariant'));
      return storefrontClient.addToCart(activeVariantId, quantity);
    },
    onSuccess: (cart) => {
      queryClient.setQueryData(['cart'], cart);
      queryClient.setQueryData(['cart', 'summary'], { itemCount: cart.itemCount });
    },
  });

  if (productQuery.isPending) return <LoadingState label={t('common.loading')} />;
  if (productQuery.isError || !product)
    return (
      <div className="container page-pad">
        <EmptyState
          title={t('product.notFoundTitle')}
          body={t('product.notFoundBody')}
          action={
            <Button asChild variant="secondary">
              <Link to="/catalog">{t('product.back')}</Link>
            </Button>
          }
        />
      </div>
    );

  return (
    <article className="product-page container page-pad">
      <Link className="back-link" to="/catalog">
        <ArrowLeft aria-hidden="true" size={17} />
        {t('product.back')}
      </Link>
      <div className="product-detail">
        <div className="product-gallery">
          {product.images[0] ? (
            <img
              src={product.images[0].url}
              alt={
                product.images[0].altText ?? t('product.imageAltFallback', { name: product.name })
              }
              width={900}
              height={900}
            />
          ) : (
            <span className="product-gallery__placeholder" aria-hidden="true">
              <i />
              <i />
            </span>
          )}
          {product.images.length > 1 ? (
            <div className="product-thumbs">
              {product.images.slice(1, 5).map((image) => (
                <img
                  key={image.id}
                  src={image.url}
                  alt={image.altText ?? ''}
                  width={120}
                  height={120}
                  loading="lazy"
                />
              ))}
            </div>
          ) : null}
        </div>
        <div className="product-info">
          <span className="eyebrow">{product.brandName ?? t('brand.fallback')}</span>
          <h1>{product.name}</h1>
          <span className="product-sku">{t('product.sku', { sku: product.sku })}</span>
          <Price className="product-price" millimes={price} />
          {product.shortDescription ? (
            <p className="product-lede">{product.shortDescription}</p>
          ) : null}
          {product.warningText ? (
            <div className="warning-box">
              <ShieldAlert aria-hidden="true" />
              <div>
                <strong>{t('product.warnings')}</strong>
                <p>{product.warningText}</p>
              </div>
            </div>
          ) : null}
          {product.variants.length > 0 ? (
            <fieldset className="variant-picker">
              <legend>{t('product.variant')}</legend>
              <div>
                {product.variants.map((variant) => (
                  <label
                    key={variant.id}
                    className={variant.id === activeVariantId ? 'selected' : ''}
                  >
                    <input
                      type="radio"
                      name="variant"
                      value={variant.id}
                      checked={variant.id === activeVariantId}
                      disabled={variant.availableQuantity <= 0}
                      onChange={() => setVariantId(variant.id)}
                    />
                    <span>{variant.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="product-buy-row">
            <div className="quantity-control" aria-label={t('product.quantity')}>
              <button
                type="button"
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                aria-label={`${t('product.quantity')} -`}
              >
                <Minus aria-hidden="true" size={17} />
              </button>
              <output>{quantity}</output>
              <button
                type="button"
                onClick={() => setQuantity((value) => Math.min(available, value + 1))}
                disabled={quantity >= available}
                aria-label={`${t('product.quantity')} +`}
              >
                <Plus aria-hidden="true" size={17} />
              </button>
            </div>
            <Button
              type="button"
              disabled={available <= 0 || !activeVariantId}
              loading={addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isSuccess ? <Check aria-hidden="true" size={18} /> : null}
              {t(addMutation.isPending ? 'product.adding' : 'product.add')}
            </Button>
          </div>
          {addMutation.isSuccess ? (
            <p className="form-banner form-banner--success" role="status">
              {t('product.added')}
            </p>
          ) : null}
          {addMutation.isError ? <ErrorState compact /> : null}
          <div className="delivery-note">
            <Truck aria-hidden="true" size={20} />
            <span>{t('product.delivery')}</span>
          </div>
        </div>
      </div>
      <section className="product-description">
        <h2>{t('product.description')}</h2>
        {product.description ? <p>{product.description}</p> : null}
        {product.attributes.length > 0 ? (
          <dl>
            {product.attributes.map((attribute) => (
              <div key={`${attribute.name}-${attribute.value}`}>
                <dt>{attribute.name}</dt>
                <dd>{attribute.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>
    </article>
  );
}
