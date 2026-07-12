import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import { json, renderRoute, requestUrl, statusPayload, unauthorized } from './test-app';

it('does not mount catalog, home, or cart queries before age confirmation', async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes('/storefront/status')) {
      return Promise.resolve(
        json({ ...statusPayload, ageGateRequired: true, ageConfirmed: false }),
      );
    }
    if (url.includes('/auth/customer/session')) return Promise.resolve(unauthorized());
    if (url.includes('/compliance/age-gate') && init?.method === 'POST')
      return Promise.resolve(new Response(null, { status: 204 }));
    if (url.includes('/storefront/home'))
      return Promise.resolve(json({ featured: [], categories: [] }));
    if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
    return Promise.resolve(json({}));
  });
  vi.stubGlobal('fetch', fetchMock);

  renderRoute('/');
  expect(await screen.findByRole('heading', { name: 'Confirmez votre âge' })).toBeVisible();
  let urls = fetchMock.mock.calls.map(([input]) => requestUrl(input));
  expect(urls.some((url) => url.includes('/storefront/home'))).toBe(false);
  expect(urls.some((url) => url.includes('/cart/summary'))).toBe(false);

  await userEvent.click(screen.getByRole('button', { name: 'Je confirme avoir 18 ans ou plus' }));
  expect(
    await screen.findByRole('heading', { name: 'Une sélection claire, livrée avec maîtrise.' }),
  ).toBeVisible();
  urls = fetchMock.mock.calls.map(([input]) => requestUrl(input));
  expect(urls.some((url) => url.includes('/storefront/home'))).toBe(true);
  expect(urls.some((url) => url.includes('/cart/summary'))).toBe(true);
});
