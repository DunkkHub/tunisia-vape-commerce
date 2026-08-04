import { render, type RenderResult } from '@testing-library/react';
import { RouterProvider } from 'react-router/dom';
import { vi } from 'vitest';

import { AppProviders } from '../src/app/providers';
import { createAppRouter } from '../src/app/router';

export const statusPayload = {
  storeName: 'Boutique vérifiée',
  maintenanceMode: false,
  prelaunchMode: false,
  checkoutEnabled: true,
  googleLoginEnabled: false,
  minimumAge: 18,
  ageGateEnabled: true,
  checkoutAgeConfirmationRequired: true,
  termsAcceptanceRequired: true,
  privacyAcceptanceRequired: true,
  consentRecordingEnabled: true,
  ageGateRequired: false,
  ageConfirmed: true,
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function unauthorized() {
  return new Response(
    JSON.stringify({
      statusCode: 401,
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
    }),
    {
      status: 401,
      headers: { 'content-type': 'application/json' },
    },
  );
}

export function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function installDefaultFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
    if (url.includes('/auth/customer/session')) return Promise.resolve(unauthorized());
    if (url.includes('/auth/admin/session')) return Promise.resolve(unauthorized());
    if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
    return Promise.resolve(json({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function renderRoute(path: string): RenderResult {
  return render(
    <AppProviders>
      <RouterProvider router={createAppRouter([path])} />
    </AppProviders>,
  );
}
