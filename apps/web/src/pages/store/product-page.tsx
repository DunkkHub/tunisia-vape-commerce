import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Heart, Minus, Plus, ShieldAlert, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import { ApiError } from '../../api/http';
import { storefrontClient } from '../../api/storefront-client';
import { useCustomerAuth } from '../../auth/customer-auth-context';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { Price } from '../../components/ui/price';

export function ProductPage() {
  const { slug = '' } = useParams();
  const { t } = useTranslation();
  const { user, isLoading: authLoading } = useCustomerAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  const productQuery = useQuery({
    queryKey: ['product', slug],
    queryFn: () => storefrontClient.product(slug),
    retry: false,
  });
  const [variantId, setVariantId] = useState('');
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const product = productQuery.data;
  const wishlistQuery = useQuery({
    queryKey: ['customer', 'wishlist'],
    queryFn: storefrontClient.wishlist,
    enabled: Boolean(user) && !authLoading,
  });

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
  const galleryImages = useMemo(() => {
    if (!product) return [];

    const images = [...product.images];
    if (product.primaryImage) images.push(product.primaryImage);
    if (selectedVariant?.image) images.unshift(selectedVariant.image);

    return images.filter(
      (image, index, candidates) =>
        candidates.findIndex((candidate) => candidate.id === image.id) === index,
    );
  }, [product, selectedVariant]);
  const selectedGalleryImage = galleryImages.find((image) => image.id === selectedImageId);
  const activeImage =
    selectedGalleryImage ??
    selectedVariant?.image ??
    product?.images[0] ??
    product?.primaryImage ??
    null;
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
  const savedToWishlist =
    product !== undefined &&
    wishlistQuery.data?.items.some((wishlistProduct) => wishlistProduct.id === product.id) === true;
  const wishlistMutation = useMutation({
    mutationFn: async () => {
      if (!product || !activeVariantId) throw new Error(t('product.selectVariant'));
      if (!savedToWishlist) return storefrontClient.addWishlistItem(activeVariantId);
      const variantIds = [
        activeVariantId,
        ...product.variants
          .map((variant) => variant.id)
          .filter((candidate) => candidate !== activeVariantId),
      ];
      for (const candidate of variantIds) {
        try {
          return await storefrontClient.removeWishlistItem(candidate);
        } catch (error) {
          if (error instanceof ApiError && error.code === 'WISHLIST_ITEM_NOT_FOUND') continue;
          throw error;
        }
      }
      return { variantId: '', productId: product.id, saved: false as const };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customer', 'wishlist'] });
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
          {activeImage ? (
            <img
              className="product-gallery__main"
              src={activeImage.renditions?.detail ?? activeImage.url}
              srcSet={
                activeImage.renditions
                  ? `${activeImage.renditions.card} 720w, ${activeImage.renditions.detail} 1200w, ${activeImage.renditions.highResolution} 1920w`
                  : undefined
              }
              sizes="(max-width: 860px) 94vw, 50vw"
              alt={activeImage.altText ?? t('product.imageAltFallback', { name: product.name })}
              width={activeImage.width ?? 900}
              height={activeImage.height ?? 900}
              decoding="async"
            />
          ) : (
            <span className="product-gallery__placeholder" aria-hidden="true">
              <i />
              <i />
            </span>
          )}
          {galleryImages.length > 1 ? (
            <div
              className="product-thumbs"
              role="group"
              aria-label={t('product.imageAltFallback', { name: product.name })}
            >
              {galleryImages.slice(0, 5).map((image, index) => {
                const imageLabel =
                  image.altText ?? t('product.imageAltFallback', { name: product.name });
                return (
                  <button
                    key={image.id}
                    className="product-thumb"
                    type="button"
                    aria-label={`${imageLabel} (${index + 1}/${Math.min(galleryImages.length, 5)})`}
                    aria-pressed={image.id === activeImage?.id}
                    onClick={() => setSelectedImageId(image.id)}
                  >
                    <img
                      src={image.renditions?.thumbnail ?? image.url}
                      alt=""
                      width={image.width ?? 120}
                      height={image.height ?? 120}
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                );
              })}
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
                      onChange={() => {
                        setVariantId(variant.id);
                        setSelectedImageId(null);
                      }}
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
              disabled={available <= 0 || !activeVariantId || authLoading}
              loading={addMutation.isPending}
              onClick={() => {
                if (!user) {
                  void navigate('/login', { state: { from: location.pathname } });
                  return;
                }
                addMutation.mutate();
              }}
            >
              {addMutation.isSuccess ? <Check aria-hidden="true" size={18} /> : null}
              {t(!user ? 'auth.login' : addMutation.isPending ? 'product.adding' : 'product.add')}
            </Button>
          </div>
          <Button
            className="product-wishlist-button"
            type="button"
            variant="secondary"
            aria-pressed={user ? savedToWishlist : false}
            disabled={authLoading || !activeVariantId || (Boolean(user) && wishlistQuery.isPending)}
            loading={wishlistMutation.isPending}
            onClick={() => {
              if (!user) {
                void navigate('/login', { state: { from: location.pathname } });
                return;
              }
              wishlistMutation.mutate();
            }}
          >
            <Heart aria-hidden="true" size={18} fill={savedToWishlist ? 'currentColor' : 'none'} />
            {t(
              !user
                ? 'product.loginToWishlist'
                : savedToWishlist
                  ? 'product.removeWishlist'
                  : 'product.addWishlist',
            )}
          </Button>
          {addMutation.isSuccess ? (
            <p className="form-banner form-banner--success" role="status">
              {t('product.added')}
            </p>
          ) : null}
          {addMutation.isError ? <ErrorState compact /> : null}
          {wishlistMutation.isSuccess ? (
            <p className="form-banner form-banner--success" role="status">
              {t(wishlistMutation.data.saved ? 'product.wishlistAdded' : 'product.wishlistRemoved')}
            </p>
          ) : null}
          {wishlistMutation.isError ? (
            <p className="form-banner form-banner--error" role="alert">
              {t('product.wishlistError')}
            </p>
          ) : null}
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
