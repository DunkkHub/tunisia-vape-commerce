import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { json, renderRoute, requestUrl, statusPayload, unauthorized } from './test-app';

describe('separate authentication forms', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
        if (url.includes('/auth/customer/session')) return Promise.resolve(unauthorized());
        if (url.includes('/auth/admin/session')) return Promise.resolve(unauthorized());
        if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
        if (url.includes('/auth/admin/login') && init?.method === 'POST')
          return Promise.resolve(json({ state: 'TOTP_REQUIRED', challengeId: 'challenge-1' }));
        if (url.includes('/auth/admin/totp') && init?.method === 'POST')
          return Promise.resolve(
            json({
              user: {
                id: 'admin-1',
                email: 'ops@example.tn',
                name: 'Ops Lead',
                roles: ['Administrator'],
                permissions: ['orders.read'],
              },
              expiresAt: '2030-01-01T00:00:00.000Z',
            }),
          );
        if (url.includes('/admin/dashboard'))
          return Promise.resolve(
            json({
              ordersCreated: 0,
              ordersDelivered: 0,
              codExpectedMillimes: 0,
              codRemittedMillimes: 0,
              lowStockCount: 0,
              deliveryFailureCount: 0,
            }),
          );
        return Promise.resolve(json({}));
      }),
    );
  });

  it('shows inline validation on the customer login form', async () => {
    const user = userEvent.setup();
    renderRoute('/login');
    await screen.findByRole('heading', { name: 'Connexion client' });
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findAllByText('Ce champ est obligatoire.')).toHaveLength(2);
  });

  it('requires password first and then a six-digit TOTP for staff', async () => {
    const user = userEvent.setup();
    renderRoute('/admin/login');
    await user.type(await screen.findByLabelText('E-mail professionnel'), 'ops@example.tn');
    await user.type(
      screen.getByLabelText('Mot de passe administrateur'),
      'correct horse battery staple',
    );
    await user.click(screen.getByRole('button', { name: 'Continuer vers la vérification' }));
    expect(await screen.findByRole('heading', { name: 'Code d’authentification' })).toBeVisible();
    await user.type(screen.getByLabelText('Code à 6 chiffres'), '123');
    await user.click(screen.getByRole('button', { name: 'Vérifier et ouvrir la session' }));
    expect(
      await screen.findByText('Saisissez les 6 chiffres de votre application d’authentification.'),
    ).toBeVisible();
    await user.clear(screen.getByLabelText('Code à 6 chiffres'));
    await user.type(screen.getByLabelText('Code à 6 chiffres'), '123456');
    await user.click(screen.getByRole('button', { name: 'Vérifier et ouvrir la session' }));
    expect(await screen.findByRole('heading', { name: 'Vue opérationnelle' })).toBeVisible();

    const fetchMock = vi.mocked(fetch);
    const totpCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).includes('/auth/admin/totp'),
    );
    expect(totpCall?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
    });
    expect(typeof totpCall?.[1]?.body === 'string' ? totpCall[1].body : '').toContain(
      '"challengeId":"challenge-1"',
    );
  });

  it('never persists the transient admin challenge in browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const user = userEvent.setup();
    renderRoute('/admin/login');
    await user.type(await screen.findByLabelText('E-mail professionnel'), 'ops@example.tn');
    await user.type(
      screen.getByLabelText('Mot de passe administrateur'),
      'correct horse battery staple',
    );
    await user.click(screen.getByRole('button', { name: 'Continuer vers la vérification' }));
    await screen.findByRole('heading', { name: 'Code d’authentification' });
    await waitFor(() => expect(setItem).not.toHaveBeenCalled());
    setItem.mockRestore();
  });
});
