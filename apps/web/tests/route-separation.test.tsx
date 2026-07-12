import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { installDefaultFetch, renderRoute, requestUrl } from './test-app';

describe('customer and administrator route separation', () => {
  let fetchMock: ReturnType<typeof installDefaultFetch>;

  beforeEach(() => {
    fetchMock = installDefaultFetch();
  });

  it('mounts only the customer auth client and storefront shell at /login', async () => {
    renderRoute('/login');
    expect(await screen.findByRole('heading', { name: 'Connexion client' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Panier' })).toBeVisible();
    expect(screen.queryByText('Centre des opérations')).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const urls = fetchMock.mock.calls.map(([input]) => requestUrl(input));
    expect(urls.some((url) => url.includes('/auth/customer/session'))).toBe(true);
    expect(urls.some((url) => url.includes('/auth/admin/session'))).toBe(false);
  });

  it('mounts only the admin auth client and secure shell at /admin/login', async () => {
    renderRoute('/admin/login');
    expect(await screen.findByRole('heading', { name: 'Accès administration' })).toBeVisible();
    expect(screen.getByText('Zone à accès restreint')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Panier' })).not.toBeInTheDocument();
    const urls = fetchMock.mock.calls.map(([input]) => requestUrl(input));
    expect(urls.some((url) => url.includes('/auth/admin/session'))).toBe(true);
    expect(urls.some((url) => url.includes('/auth/customer/session'))).toBe(false);
    expect(urls.some((url) => url.includes('/storefront/status'))).toBe(false);
  });

  it('redirects a missing admin session to the admin login, never the customer login', async () => {
    renderRoute('/admin/orders');
    expect(await screen.findByRole('heading', { name: 'Accès administration' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Connexion client' })).not.toBeInTheDocument();
  });
});
