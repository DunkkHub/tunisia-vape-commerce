import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { beginGoogleCustomerAuthentication } from '../src/pages/store/customer-google-auth-utils';
import { json, renderRoute, requestUrl, statusPayload, unauthorized } from './test-app';

const customerSession = {
  user: {
    id: 'customer-google-1',
    email: 'amel@example.tn',
    phone: '+21620123456',
    fullName: 'Amel Ben Salah',
    emailVerified: true,
  },
  expiresAt: '2030-01-01T00:00:00.000Z',
};

function requestJsonBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body.');
  return JSON.parse(init.body) as unknown;
}

function installGoogleFetch(onboarding?: {
  mode: 'CREATE' | 'LINK';
  email: string;
  fullName: string;
  locale: 'fr' | 'ar';
  expiresInSeconds: number;
}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes('/storefront/status')) {
      return Promise.resolve(json({ ...statusPayload, googleLoginEnabled: true }));
    }
    if (url.includes('/auth/customer/session')) return Promise.resolve(unauthorized());
    if (url.includes('/auth/admin/session')) return Promise.resolve(unauthorized());
    if (url.includes('/auth/customer/google/onboarding') && onboarding) {
      return Promise.resolve(json(onboarding));
    }
    if (url.includes('/auth/customer/google/complete') && init?.method === 'POST') {
      return Promise.resolve(json(customerSession));
    }
    if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
    return Promise.resolve(json({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('customer Google authentication', () => {
  it('keeps the Google control hidden when the storefront flag is disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL): Promise<Response> => {
        const url = requestUrl(input);
        if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
        if (url.includes('/auth/customer/session')) return Promise.resolve(unauthorized());
        if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
        return Promise.resolve(json({}));
      }),
    );

    renderRoute('/login');

    expect(await screen.findByRole('heading', { name: 'Connexion client' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continuer avec Google' })).not.toBeInTheDocument();
  });

  it.each(['/login', '/register'])(
    'shows Google only on the enabled customer surface %s',
    async (path) => {
      installGoogleFetch();

      renderRoute(path);

      expect(
        await screen.findByRole('button', { name: 'Continuer avec Google' }, { timeout: 10_000 }),
      ).toBeVisible();
    },
  );

  it('never adds a Google customer control to the administrator login', async () => {
    installGoogleFetch();

    renderRoute('/admin/login');

    expect(
      await screen.findByRole('heading', { name: 'Accès administration' }, { timeout: 15_000 }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /Google/i })).not.toBeInTheDocument();
  }, 30_000);

  it('starts the customer-only flow and redirects only to the trusted Google origin', async () => {
    const redirect = vi.fn();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      void input;
      void init;
      return Promise.resolve(
        json({
          authorizationUrl:
            'https://accounts.google.com/o/oauth2/v2/auth?client_id=customer-client',
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await beginGoogleCustomerAuthentication(
      { intent: 'LOGIN', returnTo: '/admin', locale: 'fr' },
      redirect,
    );

    expect(redirect).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=customer-client',
    );
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(requestUrl(input as RequestInfo | URL)).toContain('/auth/customer/google/start');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', cache: 'no-store' });
    expect(new Headers(init?.headers).get('X-Client-Context')).toBe('customer');
    expect(requestJsonBody(init)).toEqual({
      intent: 'LOGIN',
      returnTo: '/account',
      locale: 'fr',
    });
  });

  it('rejects an authorization URL outside the exact Google origin', async () => {
    const redirect = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          json({
            authorizationUrl: 'https://accounts.google.com.attacker.example/oauth',
          }),
        ),
      ),
    );

    await expect(
      beginGoogleCustomerAuthentication(
        { intent: 'REGISTER', returnTo: '/account', locale: 'fr' },
        redirect,
      ),
    ).rejects.toThrow('not trusted');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('maps an untrusted callback reason to a fixed safe message', async () => {
    installGoogleFetch();

    renderRoute('/login?oauthError=attacker-controlled-message');

    expect(
      await screen.findByText('La connexion Google n’a pas pu être terminée. Recommencez.'),
    ).toBeVisible();
    expect(screen.queryByText('attacker-controlled-message')).not.toBeInTheDocument();
  });

  it('completes CREATE onboarding with the required customer profile and consents', async () => {
    const fetchMock = installGoogleFetch({
      mode: 'CREATE',
      email: 'amel@example.tn',
      fullName: 'Amel Ben Salah',
      locale: 'fr',
      expiresInSeconds: 600,
    });
    const user = userEvent.setup();

    renderRoute('/register/google');

    expect(await screen.findByRole('heading', { name: 'Finaliser votre compte' })).toBeVisible();
    expect(screen.getByText('amel@example.tn')).toBeVisible();
    expect(screen.getByLabelText('Nom complet')).toHaveValue('Amel Ben Salah');
    await user.type(screen.getByLabelText('Téléphone tunisien'), '+21620123456');
    await user.click(screen.getByLabelText(/âge minimum requis/));
    await user.click(screen.getByLabelText(/conditions générales/));
    await user.click(screen.getByRole('button', { name: 'Créer mon compte client' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestUrl(input).includes('/auth/customer/google/complete'),
        ),
      ).toBe(true);
    });
    const completeCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).includes('/auth/customer/google/complete'),
    );
    expect(requestJsonBody(completeCall?.[1])).toEqual({
      fullName: 'Amel Ben Salah',
      phone: '+21620123456',
      adultConfirmed: true,
      termsAccepted: true,
      locale: 'fr',
    });
    expect(new Headers(completeCall?.[1]?.headers).get('X-Client-Context')).toBe('customer');
  });

  it('completes LINK onboarding with the current customer password only', async () => {
    const fetchMock = installGoogleFetch({
      mode: 'LINK',
      email: 'amel@example.tn',
      fullName: 'Amel Ben Salah',
      locale: 'fr',
      expiresInSeconds: 600,
    });
    const user = userEvent.setup();

    renderRoute('/register/google');

    expect(
      await screen.findByRole('heading', { name: 'Associer votre compte existant' }),
    ).toBeVisible();
    expect(screen.queryByLabelText('Nom complet')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Téléphone tunisien')).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText('Mot de passe actuel du compte client'),
      'correct-password',
    );
    await user.click(screen.getByRole('button', { name: 'Associer Google et me connecter' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestUrl(input).includes('/auth/customer/google/complete'),
        ),
      ).toBe(true);
    });
    const completeCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).includes('/auth/customer/google/complete'),
    );
    expect(requestJsonBody(completeCall?.[1])).toEqual({
      currentPassword: 'correct-password',
    });
  });
});
