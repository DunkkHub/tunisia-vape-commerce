import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, ShieldCheck, ShoppingBag, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { storefrontClient } from '../../api/storefront-client';
import { useStorefrontStatus } from '../../components/compliance/storefront-status-context';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback';
import { Price } from '../../components/ui/price';

export function CartPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const status = useStorefrontStatus();
  const cartQuery = useQuery({ queryKey: ['cart'], queryFn: storefrontClient.cart });
  const updateMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      storefrontClient.updateCartItem(itemId, quantity),
    onSuccess: (cart) => {
      queryClient.setQueryData(['cart'], cart);
      queryClient.setQueryData(['cart', 'summary'], { itemCount: cart.itemCount });
    },
  });
  const removeMutation = useMutation({
    mutationFn: storefrontClient.removeCartItem,
    onSuccess: (cart) => {
      queryClient.setQueryData(['cart'], cart);
      queryClient.setQueryData(['cart', 'summary'], { itemCount: cart.itemCount });
    },
  });

  return (
    <div className="cart-page container page-pad">
      <header className="page-heading">
        <span className="eyebrow">{t('cart.eyebrow')}</span>
        <h1>{t('cart.title')}</h1>
      </header>
      {cartQuery.isPending ? <LoadingState label={t('common.loading')} /> : null}
      {cartQuery.isError ? <ErrorState onRetry={() => void cartQuery.refetch()} /> : null}
      {cartQuery.data && cartQuery.data.items.length === 0 ? (
        <EmptyState
          title={t('cart.emptyTitle')}
          body={t('cart.emptyBody')}
          action={
            <Button asChild>
              <Link to="/catalog">{t('cart.browse')}</Link>
            </Button>
          }
        />
      ) : null}
      {cartQuery.data && cartQuery.data.items.length > 0 ? (
        <div className="cart-layout">
          <section className="cart-items" aria-label={t('cart.title')}>
            {cartQuery.data.items.map((item) => {
              const name = item.variant
                ? `${item.product.name} · ${item.variant.name}`
                : item.product.name;
              return (
                <article className="cart-item" key={item.id}>
                  <Link to={`/products/${item.product.slug}`} className="cart-item__image">
                    {item.product.primaryImage ? (
                      <img
                        src={item.product.primaryImage.url}
                        alt={item.product.primaryImage.altText ?? name}
                        width={160}
                        height={160}
                      />
                    ) : (
                      <ShoppingBag aria-hidden="true" />
                    )}
                  </Link>
                  <div className="cart-item__info">
                    <h2>
                      <Link to={`/products/${item.product.slug}`}>{name}</Link>
                    </h2>
                    <Price millimes={item.unitPriceMillimes} />
                  </div>
                  <div className="quantity-control">
                    <button
                      type="button"
                      aria-label={`${t('product.quantity')} -`}
                      disabled={item.quantity <= 1 || updateMutation.isPending}
                      onClick={() =>
                        updateMutation.mutate({ itemId: item.id, quantity: item.quantity - 1 })
                      }
                    >
                      <Minus aria-hidden="true" size={16} />
                    </button>
                    <output aria-label={t('product.quantity')}>{item.quantity}</output>
                    <button
                      type="button"
                      aria-label={`${t('product.quantity')} +`}
                      disabled={
                        updateMutation.isPending || item.quantity >= item.product.availableQuantity
                      }
                      onClick={() =>
                        updateMutation.mutate({ itemId: item.id, quantity: item.quantity + 1 })
                      }
                    >
                      <Plus aria-hidden="true" size={16} />
                    </button>
                  </div>
                  <Price className="cart-item__total" millimes={item.lineTotalMillimes} />
                  <button
                    className="remove-button"
                    type="button"
                    aria-label={`${t('common.remove')} ${name}`}
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(item.id)}
                  >
                    <Trash2 aria-hidden="true" size={18} />
                  </button>
                </article>
              );
            })}
          </section>
          <aside className="cart-summary">
            <h2>{t('checkout.summary')}</h2>
            <dl>
              <div>
                <dt>{t('cart.subtotal')}</dt>
                <dd>
                  <Price millimes={cartQuery.data.subtotalMillimes} />
                </dd>
              </div>
              <div>
                <dt>{t('nav.delivery')}</dt>
                <dd>{t('cart.deliveryPending')}</dd>
              </div>
            </dl>
            <p>
              <ShieldCheck aria-hidden="true" size={18} />
              {t('cart.totalAuthoritative')}
            </p>
            {status.checkoutEnabled ? (
              <Button asChild>
                <Link to="/checkout">{t('cart.checkout')}</Link>
              </Button>
            ) : (
              <Button type="button" disabled>
                {t('cart.checkout')}
              </Button>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
