import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { json, renderRoute, requestUrl, statusPayload, unauthorized } from './test-app';

afterEach(() => vi.unstubAllEnvs());

it('does not mount catalog, home, or cart queries before age confirmation', async () => {
  vi.stubEnv('VITE_STOREFRONT_DESIGN_PREVIEW', 'true');
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes('/storefront/status')) {
      return Promise.resolve(
        json({
          ...statusPayload,
          prelaunchMode: true,
          ageGateRequired: true,
          ageConfirmed: false,
        }),
      );
    }
    if (url.includes('/auth/customer/session')) return Promise.resolve(unauthorized());
    if (url.includes('/compliance/age-gate') && init?.method === 'POST')
      return Promise.resolve(new Response(null, { status: 204 }));
    if (url.includes('/storefront/home'))
      return Promise.resolve(json({ featured: [], categories: [] }));
    if (url.includes('/catalog/facets'))
      return Promise.resolve(
        json({
          brands: [],
          productTypes: [],
          flavors: [],
          priceRange: { minimumMillimes: null, maximumMillimes: null },
          truncated: { brands: false, flavors: false },
        }),
      );
    if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
    return Promise.resolve(json({}));
  });
  vi.stubGlobal('fetch', fetchMock);

  renderRoute('/');
  expect(await screen.findByRole('heading', { name: 'Confirmez votre âge' })).toBeVisible();
  let urls = fetchMock.mock.calls.map(([input]) => requestUrl(input));
  expect(urls.some((url) => url.includes('/storefront/home'))).toBe(false);
  expect(urls.some((url) => url.includes('/catalog/facets'))).toBe(false);
  expect(urls.some((url) => url.includes('/cart/summary'))).toBe(false);

  await userEvent.click(screen.getByRole('button', { name: 'Je confirme avoir 18 ans ou plus' }));
  expect(
    await screen.findByRole('heading', {
      name: 'Le futur du puff jetable, rapide et premium en Tunisie.',
    }),
  ).toBeVisible();
  expect(screen.getByText(/Aperçu local uniquement/i)).toBeVisible();
  urls = fetchMock.mock.calls.map(([input]) => requestUrl(input));
  expect(urls.some((url) => url.includes('/storefront/home'))).toBe(true);
  expect(urls.some((url) => url.includes('/catalog/facets'))).toBe(true);
  expect(urls.some((url) => url.includes('/cart/summary'))).toBe(true);
});

it('keeps prelaunch blocking when the local preview switch is disabled', async () => {
  vi.stubEnv('VITE_STOREFRONT_DESIGN_PREVIEW', 'false');
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes('/storefront/status')) {
      return Promise.resolve(json({ ...statusPayload, prelaunchMode: true }));
    }
    if (url.includes('/auth/customer/session')) return Promise.resolve(unauthorized());
    if (url.includes('/storefront/home'))
      return Promise.resolve(json({ featured: [], categories: [] }));
    if (url.includes('/catalog/facets')) return Promise.resolve(json({}));
    if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
    return Promise.resolve(json({}));
  });
  vi.stubGlobal('fetch', fetchMock);

  renderRoute('/');
  expect(
    await screen.findByRole('heading', { name: 'Une boutique tunisienne pensée avec exigence.' }),
  ).toBeVisible();

  const urls = fetchMock.mock.calls.map(([input]) => requestUrl(input));
  expect(urls.some((url) => url.includes('/storefront/home'))).toBe(false);
  expect(urls.some((url) => url.includes('/catalog/facets'))).toBe(false);
  expect(urls.some((url) => url.includes('/cart/summary'))).toBe(false);
});

it('never uses local preview when the minimum-age policy is unconfigured', async () => {
  vi.stubEnv('VITE_STOREFRONT_DESIGN_PREVIEW', 'true');
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes('/storefront/status')) {
      return Promise.resolve(
        json({
          ...statusPayload,
          prelaunchMode: true,
          minimumAge: 0,
          ageGateRequired: false,
          ageConfirmed: false,
        }),
      );
    }
    if (url.includes('/auth/customer/session')) return Promise.resolve(unauthorized());
    return Promise.resolve(json({}));
  });
  vi.stubGlobal('fetch', fetchMock);

  renderRoute('/');
  expect(
    await screen.findByRole('heading', { name: 'Une boutique tunisienne pensée avec exigence.' }),
  ).toBeVisible();
  expect(
    fetchMock.mock.calls.some(([input]) => requestUrl(input).includes('/storefront/home')),
  ).toBe(false);
});
