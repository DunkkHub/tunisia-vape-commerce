import type { ConfigService } from '@nestjs/config';
import type { TokenPayload } from 'google-auth-library';
import { describe, expect, it } from 'vitest';
import type { Environment } from '../config/environment';
import {
  GoogleIdentityProvider,
  GoogleIdentityVerificationError,
  validateGoogleTokenPayload,
} from './google-identity.provider';

const now = 1_800_000_000;
const validPayload = (): TokenPayload => ({
  iss: 'https://accounts.google.com',
  aud: 'client.apps.googleusercontent.com',
  sub: 'stable-google-subject',
  email: 'Verified.Customer@Example.test',
  email_verified: true,
  name: 'Verified Customer',
  nonce: 'expected-nonce',
  iat: now - 10,
  exp: now + 300,
});

describe('Google ID token claim validation', () => {
  it('creates an authorization-code URL with PKCE, state, nonce and the exact callback', () => {
    const environment = {
      GOOGLE_OAUTH_ENABLED: true,
      GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'google-client-secret-for-tests',
      GOOGLE_CALLBACK_URL: 'https://store.example.tn/api/v1/auth/customer/google/callback',
    } as Environment;
    const config = {
      get: (key: keyof Environment) => environment[key],
    } as ConfigService<Environment, true>;
    const provider = new GoogleIdentityProvider(config);

    const authorizationUrl = new URL(
      provider.authorizationUrl({
        state: 'one-time-state',
        nonce: 'one-time-nonce',
        codeChallenge: 'pkce-code-challenge',
      }),
    );

    expect(provider.isEnabled()).toBe(true);
    expect(authorizationUrl.origin).toBe('https://accounts.google.com');
    expect(authorizationUrl.searchParams.get('response_type')).toBe('code');
    expect(authorizationUrl.searchParams.get('client_id')).toBe(environment.GOOGLE_CLIENT_ID);
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(environment.GOOGLE_CALLBACK_URL);
    expect(authorizationUrl.searchParams.get('access_type')).toBe('online');
    expect(authorizationUrl.searchParams.get('state')).toBe('one-time-state');
    expect(authorizationUrl.searchParams.get('nonce')).toBe('one-time-nonce');
    expect(authorizationUrl.searchParams.get('code_challenge')).toBe('pkce-code-challenge');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('scope')?.split(' ')).toEqual([
      'openid',
      'email',
      'profile',
    ]);
  });

  it('accepts a signed-ticket payload only for the configured audience, nonce and verified email', () => {
    expect(
      validateGoogleTokenPayload(validPayload(), {
        clientId: 'client.apps.googleusercontent.com',
        nonce: 'expected-nonce',
        nowSeconds: now,
      }),
    ).toEqual({
      subject: 'stable-google-subject',
      email: 'Verified.Customer@Example.test',
      emailNormalized: 'verified.customer@example.test',
      fullName: 'Verified Customer',
    });
  });

  it('strips control and bidirectional-override characters from the presentation name', () => {
    expect(
      validateGoogleTokenPayload(
        { ...validPayload(), name: 'Verified\u0000\u202e Customer' },
        {
          clientId: 'client.apps.googleusercontent.com',
          nonce: 'expected-nonce',
          nowSeconds: now,
        },
      ).fullName,
    ).toBe('Verified   Customer');
  });

  it.each([
    ['issuer', { iss: 'https://attacker.example' }],
    ['audience', { aud: 'other.apps.googleusercontent.com' }],
    ['authorized presenter', { azp: 'other.apps.googleusercontent.com' }],
    ['expiration', { exp: now }],
    ['issued-at time', { iat: now + 61 }],
    ['nonce', { nonce: 'replayed-nonce' }],
    ['verified email', { email_verified: false }],
    ['email', { email: 'not-an-email' }],
  ])('rejects an invalid %s claim', (_name, override) => {
    expect(() =>
      validateGoogleTokenPayload(
        { ...validPayload(), ...override },
        {
          clientId: 'client.apps.googleusercontent.com',
          nonce: 'expected-nonce',
          nowSeconds: now,
        },
      ),
    ).toThrow(GoogleIdentityVerificationError);
  });
});
