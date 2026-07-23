import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProductDetail } from '../src/api/types';
import { json, renderRoute, requestUrl, statusPayload, unauthorized } from './test-app';

const product: ProductDetail = {
  id: 'product-1',
  name: 'Puff test',
  slug: 'puff-test',
  shortDescription: 'Description courte',
  brandName: 'PUFFJET',
  brandSlug: 'puffjet',
  productType: 'DISPOSABLE',
  flavor: 'Berry',
  priceMillimes: 12_000,
  promotionalPriceMillimes: null,
  availableQuantity: 8,
  lowStock: false,
  ageRestricted: true,
  primaryImage: {
    id: 'product-primary',
    url: '/media/product-primary.webp',
    altText: 'Produit vu de face',
    width: 800,
    height: 800,
  },
  description: 'Description complète',
  sku: 'PUFF-TEST',
  images: [
    {
      id: 'product-primary',
      url: '/media/product-primary.webp',
      altText: 'Produit vu de face',
      width: 800,
      height: 800,
    },
    {
      id: 'product-side',
      url: '/media/product-side.webp',
      altText: 'Produit vu de côté',
      width: 1_200,
      height: 800,
    },
  ],
  variants: [
    {
      id: 'variant-violet',
      name: 'Violet',
      sku: 'PUFF-TEST-VIOLET',
      priceMillimes: 12_000,
      promotionalPriceMillimes: null,
      availableQuantity: 5,
      image: {
        id: 'variant-violet-image',
        url: '/media/variant-violet.webp',
        altText: 'Variante violette',
        width: 600,
        height: 900,
      },
    },
    {
      id: 'variant-mint',
      name: 'Menthe',
      sku: 'PUFF-TEST-MINT',
      priceMillimes: 11_000,
      promotionalPriceMillimes: null,
      availableQuantity: 3,
      image: null,
    },
  ],
  warningText: null,
  attributes: [],
};

describe('storefront product media gallery', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL): Promise<Response> => {
        const url = requestUrl(input);
        if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
        if (url.includes('/auth/customer/session')) return Promise.resolve(unauthorized());
        if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
        if (url.includes('/products/puff-test')) return Promise.resolve(json(product));
        return Promise.resolve(json({}));
      }),
    );
  });

  it('uses variant media first and lets keyboard users select a gallery image', async () => {
    const user = userEvent.setup();
    renderRoute('/products/puff-test');

    const variantImage = await screen.findByRole('img', { name: 'Variante violette' });
    expect(variantImage).toHaveAttribute('src', '/media/variant-violet.webp');
    expect(variantImage).toHaveAttribute('width', '600');
    expect(variantImage).toHaveAttribute('height', '900');

    const sideThumbnail = screen.getByRole('button', { name: /Produit vu de côté/ });
    expect(sideThumbnail).toHaveAttribute('aria-pressed', 'false');
    expect(sideThumbnail.querySelector('img')).toHaveAttribute('loading', 'lazy');

    sideThumbnail.focus();
    await user.keyboard('{Enter}');

    expect(sideThumbnail).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'Produit vu de côté' })).toHaveAttribute(
      'src',
      '/media/product-side.webp',
    );
  });

  it('returns to the product primary image when a newly selected variant has no image', async () => {
    const user = userEvent.setup();
    renderRoute('/products/puff-test');

    await screen.findByRole('img', { name: 'Variante violette' });
    await user.click(screen.getByRole('button', { name: /Produit vu de côté/ }));
    await user.click(screen.getByRole('radio', { name: 'Menthe' }));

    expect(screen.getByRole('img', { name: 'Produit vu de face' })).toHaveAttribute(
      'src',
      '/media/product-primary.webp',
    );
  });
});
