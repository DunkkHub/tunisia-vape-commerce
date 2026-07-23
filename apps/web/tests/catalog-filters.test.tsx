import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { changeLocale } from '../src/i18n';
import { json, renderRoute, requestUrl, statusPayload, unauthorized } from './test-app';

beforeEach(() => {
  document.documentElement.lang = 'fr';
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
      if (url.includes('/auth/customer/session')) return Promise.resolve(unauthorized());
      if (url.includes('/auth/admin/session')) return Promise.resolve(unauthorized());
      if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
      if (url.includes('/catalog/facets')) {
        return Promise.resolve(
          json({
            brands: [{ id: 'brand-1', name: 'Marque test', slug: 'marque-test' }],
            productTypes: ['E_LIQUID'],
            flavors: [
              {
                value: 'cool-mint',
                nameFr: 'Menthe fraîche',
                nameAr: 'نعناع بارد',
                productCount: 2,
              },
            ],
            puffCounts: [{ value: 15_000, productCount: 2 }],
            nicotineStrengthsMg: [{ value: 20, productCount: 2 }],
            priceRange: { minimumMillimes: 10_000, maximumMillimes: 25_000 },
            truncated: {
              brands: false,
              flavors: false,
              puffCounts: false,
              nicotineStrengths: false,
            },
          }),
        );
      }
      if (url.includes('/products?')) {
        return Promise.resolve(json({ items: [], total: 0, page: 1, pageSize: 12, totalPages: 0 }));
      }
      return Promise.resolve(json({}));
    }),
  );
});

it('renders the server-provided Arabic flavor label while retaining its stable slug', async () => {
  await changeLocale('ar');
  renderRoute('/catalog');

  expect(await screen.findByRole('option', { name: 'نعناع بارد (2)' })).toHaveValue('cool-mint');
});

it('combines type, localized flavor, puff, nicotine, and price filters in the URL', async () => {
  const user = userEvent.setup();
  renderRoute('/catalog');

  await screen.findByRole('heading', { name: 'Trouver votre produit' });
  await screen.findByRole('option', { name: 'Marque test' });
  await user.selectOptions(screen.getByLabelText('Marque'), 'marque-test');
  await user.selectOptions(screen.getByLabelText('Type de produit'), 'E_LIQUID');
  await user.selectOptions(screen.getByLabelText('Saveur'), 'cool-mint');
  await user.selectOptions(screen.getByLabelText('Nombre de bouffées'), '15000');
  await user.selectOptions(screen.getByLabelText('Dosage de nicotine'), '20');
  await user.type(screen.getByLabelText('Prix minimum (TND)'), '10.500');
  await user.type(screen.getByLabelText('Prix maximum (TND)'), '20');
  await user.click(screen.getByRole('button', { name: 'Appliquer' }));

  await waitFor(() => {
    const productUrls = vi
      .mocked(fetch)
      .mock.calls.map(([input]) => requestUrl(input))
      .filter((url) => url.includes('/products?'));
    const matched = productUrls.some((url) => {
      const query = new URL(url, 'http://local.test').searchParams;
      return (
        query.get('brand') === 'marque-test' &&
        query.get('productType') === 'E_LIQUID' &&
        query.get('flavor') === 'cool-mint' &&
        query.get('puffCount') === '15000' &&
        query.get('nicotineStrengthMg') === '20' &&
        query.get('minPriceMillimes') === '10500' &&
        query.get('maxPriceMillimes') === '20000'
      );
    });
    expect(matched).toBe(true);
  });
});
