import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { json, renderRoute, requestUrl, statusPayload, unauthorized } from './test-app';

const customerSession = {
  user: {
    id: 'customer-1',
    email: 'client@example.tn',
    phone: '+21620123456',
    fullName: 'Amel Ben Salah',
    emailVerified: true,
  },
  expiresAt: '2030-01-01T00:00:00.000Z',
};

const currentSession = {
  id: 'session-current',
  createdAt: '2026-07-18T08:00:00.000Z',
  authenticatedAt: '2026-07-18T08:00:00.000Z',
  lastSeenAt: '2026-07-20T10:30:00.000Z',
  idleExpiresAt: '2026-07-20T11:00:00.000Z',
  absoluteExpiresAt: '2026-08-18T08:00:00.000Z',
  ipAddress: '10.0.0.1',
  userAgent: 'Firefox 128 / Windows',
  twoFactorVerified: false,
  current: true,
};

const otherSession = {
  ...currentSession,
  id: 'session-other',
  ipAddress: '10.0.0.2',
  userAgent: 'Safari / iPhone',
  current: false,
};

function noContent() {
  return new Response(null, { status: 204 });
}

describe('customer account security', () => {
  beforeEach(() => {
    document.cookie = 'vape_customer_csrf=customer-csrf; Path=/';
  });

  it('consumes a password-reset token without persisting or displaying it', async () => {
    const token = 'single-use-reset-token'.padEnd(32, 'x');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
        if (url.includes('/auth/customer/session')) return Promise.resolve(unauthorized());
        if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
        if (url.endsWith('/auth/customer/password-reset/confirm') && init?.method === 'POST')
          return Promise.resolve(noContent());
        return Promise.resolve(json({}));
      }),
    );

    const user = userEvent.setup();
    renderRoute(`/password-reset/confirm?token=${token}`);
    await screen.findByRole('heading', { name: 'Choisir un nouveau mot de passe' });
    expect(screen.queryByText(token)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Nouveau mot de passe'), 'weak');
    await user.type(screen.getByLabelText('Confirmer le nouveau mot de passe'), 'different');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le nouveau mot de passe' }));
    expect(
      await screen.findByText(
        'Utilisez 12 à 128 caractères avec une minuscule, une majuscule, un chiffre et un caractère spécial.',
      ),
    ).toBeVisible();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([input]) => requestUrl(input).endsWith('/password-reset/confirm')),
    ).toBe(false);
    await user.clear(screen.getByLabelText('Nouveau mot de passe'));
    await user.clear(screen.getByLabelText('Confirmer le nouveau mot de passe'));
    await user.type(screen.getByLabelText('Nouveau mot de passe'), 'Secure-password1!');
    await user.type(
      screen.getByLabelText('Confirmer le nouveau mot de passe'),
      'Secure-password1!',
    );
    await user.click(screen.getByRole('button', { name: 'Enregistrer le nouveau mot de passe' }));

    expect(await screen.findByRole('heading', { name: 'Mot de passe mis à jour' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/login');
    const confirmCall = vi
      .mocked(fetch)
      .mock.calls.find(([input]) => requestUrl(input).endsWith('/password-reset/confirm'));
    expect(confirmCall?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
    });
    const confirmBody = confirmCall?.[1]?.body;
    expect(JSON.parse(typeof confirmBody === 'string' ? confirmBody : '')).toEqual({
      token,
      newPassword: 'Secure-password1!',
    });
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('defaults missing confirmation flags to required and hides disabled confirmations', async () => {
    const statuses = [
      statusPayload,
      {
        ...statusPayload,
        ageGateEnabled: false,
        termsAcceptanceRequired: false,
        checkoutAgeConfirmationRequired: false,
        privacyAcceptanceRequired: false,
        consentRecordingEnabled: false,
      },
    ];
    let statusIndex = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        if (url.includes('/storefront/status'))
          return Promise.resolve(json(statuses[Math.min(statusIndex, statuses.length - 1)]));
        if (url.includes('/auth/customer/session')) return Promise.resolve(unauthorized());
        if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
        if (url.includes('/auth/customer/register') && init?.method === 'POST')
          return Promise.resolve(json(customerSession));
        return Promise.resolve(json({}));
      }),
    );

    const firstRender = renderRoute('/register');
    expect(await screen.findByText('Je confirme avoir l’âge minimum requis.')).toBeVisible();
    expect(
      screen.getByText('J’accepte les conditions générales et la politique de confidentialité.'),
    ).toBeVisible();
    firstRender.unmount();

    statusIndex = 1;
    const user = userEvent.setup();
    renderRoute('/register');
    await screen.findByRole('heading', { name: 'Créer votre compte' });
    expect(screen.queryByText('Je confirme avoir l’âge minimum requis.')).not.toBeInTheDocument();
    expect(
      screen.queryByText('J’accepte les conditions générales et la politique de confidentialité.'),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Nom complet'), 'Amel Ben Salah');
    await user.type(screen.getByLabelText('Adresse e-mail'), 'client@example.tn');
    await user.type(screen.getByLabelText('Téléphone tunisien'), '+21620123456');
    await user.type(screen.getByLabelText('Mot de passe'), 'Secure-password1!');
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'Secure-password1!');
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    await waitFor(() => {
      const registerCall = vi
        .mocked(fetch)
        .mock.calls.find(([input]) => requestUrl(input).includes('/auth/customer/register'));
      const registerBody = registerCall?.[1]?.body;
      expect(JSON.parse(typeof registerBody === 'string' ? registerBody : '')).toMatchObject({
        adultConfirmed: false,
        termsAccepted: false,
      });
    });
  });

  it('lists sessions with RTL-safe identifiers and revokes one after confirmation', async () => {
    let activeSessions = [currentSession, otherSession];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
        if (url.endsWith('/auth/customer/sessions/session-other') && init?.method === 'DELETE') {
          activeSessions = activeSessions.filter((session) => session.id !== 'session-other');
          return Promise.resolve(noContent());
        }
        if (url.endsWith('/auth/customer/sessions'))
          return Promise.resolve(json({ data: activeSessions }));
        if (url.endsWith('/auth/customer/session')) return Promise.resolve(json(customerSession));
        if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
        return Promise.resolve(json({}));
      }),
    );

    const user = userEvent.setup();
    renderRoute('/account/security');
    await screen.findByRole('heading', { name: 'Sécurité et sessions' });
    const ip = screen.getByText('10.0.0.2');
    expect(ip.tagName).toBe('BDI');
    expect(ip).toHaveAttribute('dir', 'ltr');

    await user.click(screen.getByRole('button', { name: 'Fermer cette session' }));
    let dialog = await screen.findByRole('dialog', { name: 'Fermer cette session ?' });
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(
      screen.queryByRole('dialog', { name: 'Fermer cette session ?' }),
    ).not.toBeInTheDocument();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([input]) => requestUrl(input).endsWith('/sessions/session-other')),
    ).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Fermer cette session' }));
    dialog = await screen.findByRole('dialog', { name: 'Fermer cette session ?' });
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer la fermeture' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'La session sélectionnée a été fermée.',
    );
    await waitFor(() => expect(screen.queryByText('10.0.0.2')).not.toBeInTheDocument());
    const revokeCall = vi
      .mocked(fetch)
      .mock.calls.find(([input]) => requestUrl(input).endsWith('/sessions/session-other'));
    expect(revokeCall?.[1]).toMatchObject({ method: 'DELETE' });
    expect(new Headers(revokeCall?.[1]?.headers).get('X-CSRF-Token')).toBe('customer-csrf');
  });

  it('revokes every session and safely clears the local customer login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
        if (url.endsWith('/auth/customer/sessions/revoke-all') && init?.method === 'POST')
          return Promise.resolve(noContent());
        if (url.endsWith('/auth/customer/sessions'))
          return Promise.resolve(json({ data: [currentSession, otherSession] }));
        if (url.endsWith('/auth/customer/session')) return Promise.resolve(json(customerSession));
        if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
        return Promise.resolve(json({}));
      }),
    );

    const user = userEvent.setup();
    renderRoute('/account/security');
    await screen.findByRole('heading', { name: 'Sécurité et sessions' });
    await user.click(screen.getByRole('button', { name: 'Fermer toutes les sessions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fermer toutes les sessions ?' });
    await user.click(within(dialog).getByRole('button', { name: 'Fermer toutes les sessions' }));

    expect(await screen.findByRole('heading', { name: 'Connexion client' })).toBeVisible();
    const revokeAllCall = vi
      .mocked(fetch)
      .mock.calls.find(([input]) => requestUrl(input).endsWith('/sessions/revoke-all'));
    expect(revokeAllCall?.[1]).toMatchObject({ method: 'POST' });
    expect(new Headers(revokeAllCall?.[1]?.headers).get('X-CSRF-Token')).toBe('customer-csrf');
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([input]) => requestUrl(input).endsWith('/auth/customer/logout')),
    ).toBe(false);
  });
});
