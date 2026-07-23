import { screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { json, renderRoute, requestUrl, statusPayload, unauthorized } from './test-app';

const featuredProduct = {
  id: 'product-1',
  name: 'Jet Menthe',
  slug: 'jet-menthe',
  shortDescription: 'Une référence publiée issue du catalogue.',
  brandName: 'Marque test',
  brandSlug: 'marque-test',
  productType: 'DISPOSABLE',
  flavor: 'Menthe fraîche',
  puffCount: 15_000,
  nicotineStrengthMg: 20,
  nicotineStrengthsMg: [20],
  selectableFlavorCount: 12,
  priceMillimes: 99_000,
  promotionalPriceMillimes: null,
  availableQuantity: 12,
  lowStock: false,
  ageRestricted: true,
  primaryImage: {
    id: 'image-1',
    url: 'https://images.test/jet-menthe.webp',
    altText: 'Vue studio du Jet Menthe',
    width: 720,
    height: 720,
  },
};

function installHomeFetch({ empty = false }: { empty?: boolean } = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes('/storefront/status')) {
      return Promise.resolve(
        json({
          ...statusPayload,
          storeName: 'PUFFJET',
          checkoutEnabled: false,
        }),
      );
    }
    if (url.includes('/auth/customer/session')) return Promise.resolve(unauthorized());
    if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 2 }));
    if (url.includes('/storefront/home')) {
      return Promise.resolve(
        json({
          featured: empty ? [] : [featuredProduct],
          categories: empty
            ? []
            : [{ id: 'category-1', name: 'Jetables', slug: 'jetables', productCount: 1 }],
        }),
      );
    }
    if (url.includes('/catalog/facets')) {
      return Promise.resolve(
        json({
          brands: [],
          productTypes: ['DISPOSABLE'],
          flavors: empty
            ? []
            : [
                {
                  value: 'cool-mint',
                  nameFr: 'Menthe fraîche',
                  nameAr: 'نعناع بارد',
                  productCount: 1,
                },
              ],
          puffCounts: [],
          nicotineStrengthsMg: [],
          priceRange: { minimumMillimes: 99_000, maximumMillimes: 99_000 },
          truncated: {
            brands: false,
            flavors: false,
            puffCounts: false,
            nicotineStrengths: false,
          },
        }),
      );
    }
    return Promise.resolve(json({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  document.documentElement.lang = 'fr';
});

it('renders the neon landing structure with only API-derived commerce data', async () => {
  const fetchMock = installHomeFetch();
  const { container } = renderRoute('/');

  expect(
    await screen.findByRole('heading', {
      name: 'Le futur du puff jetable, rapide et premium en Tunisie.',
    }),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: 'Puffs' })).toHaveAttribute(
    'href',
    '/catalog?productType=DISPOSABLE',
  );
  expect(screen.getByRole('link', { name: 'Saveurs' })).toHaveAttribute('href', '/catalog');
  expect(screen.getByRole('link', { name: 'Nouveautés' })).toHaveAttribute(
    'href',
    '/catalog?sort=newest',
  );
  expect(screen.getByRole('link', { name: 'Explorer le catalogue' })).toHaveAttribute(
    'href',
    '/catalog',
  );
  expect(await screen.findByRole('link', { name: /Menthe fraîche/ })).toHaveAttribute(
    'href',
    '/catalog?flavor=cool-mint',
  );
  expect(await screen.findByRole('heading', { name: 'Jet Menthe' })).toBeVisible();
  expect(screen.getByAltText('Vue studio du Jet Menthe')).toHaveAttribute(
    'src',
    'https://images.test/jet-menthe.webp',
  );
  expect(container.querySelector('data[value="99000"]')).toBeInTheDocument();
  expect(screen.getByText(/15.?000 bouffées/i)).toBeVisible();
  expect(screen.getByText('20 mg de nicotine')).toBeVisible();
  expect(screen.getByText('12 saveurs au choix')).toBeVisible();
  expect(screen.queryByText('À partir de')).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Voir Jet Menthe' })).toHaveLength(2);
  expect(screen.getByRole('link', { name: 'Panier' })).toHaveTextContent('0');
  expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).includes('/cart/summary'))).toBe(
    false,
  );

  expect(screen.queryByText(/24.?48h/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/6000 Puffs/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/5% Nicotine/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Commander/i })).not.toBeInTheDocument();
  expect(container.querySelector('a[href="/checkout"]')).not.toBeInTheDocument();
});

it('shows an honest designed empty state instead of demonstration products', async () => {
  installHomeFetch({ empty: true });
  renderRoute('/');

  expect(
    await screen.findByRole('heading', {
      name: 'Aucun produit mis en avant n’est publié actuellement.',
    }),
  ).toBeVisible();
  expect(screen.getByText(/références publiées et réellement disponibles/i)).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Jet Menthe' })).not.toBeInTheDocument();
  expect(screen.queryByText(/99.?DT/i)).not.toBeInTheDocument();
});
