import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { RedisService } from '../cache/redis.service';
import { CryptoService } from '../common/security/crypto.service';
import type { Environment } from '../config/environment';
import {
  GoogleOAuthStateError,
  GoogleOAuthStateService,
  type GoogleOnboardingClaim,
  type GoogleOnboardingRecord,
} from './google-oauth-state.service';

type RedisClientStub = {
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  getdel: ReturnType<typeof vi.fn>;
  ttl: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

const environment = {
  NODE_ENV: 'test',
  FIELD_ENCRYPTION_KEY: 'oauth-state-test-field-encryption-key-material',
  GOOGLE_OAUTH_STATE_TTL_SECONDS: 300,
} as Environment;

const config = {
  get: vi.fn((key: keyof Environment) => environment[key]),
} as unknown as ConfigService<Environment, true>;

const response = () =>
  ({ cookie: vi.fn(), clearCookie: vi.fn() }) as unknown as Response & {
    cookie: ReturnType<typeof vi.fn>;
    clearCookie: ReturnType<typeof vi.fn>;
  };

const requestWithCookies = (cookies: Record<string, unknown>) =>
  ({ cookies }) as unknown as Request;

const onboardingRecord = (overrides: Partial<GoogleOnboardingRecord> = {}) => ({
  mode: 'CREATE' as const,
  subjectHash: 'a'.repeat(64),
  email: 'customer@example.test',
  emailNormalized: 'customer@example.test',
  fullName: 'Customer Name',
  returnTo: '/account',
  locale: 'fr' as const,
  attempts: 0,
  ...overrides,
});

const setup = (overrides: Partial<RedisClientStub> = {}) => {
  const client: RedisClientStub = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    getdel: vi.fn().mockResolvedValue(null),
    ttl: vi.fn().mockResolvedValue(300),
    eval: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
    ...overrides,
  };
  const redis = {
    connect: vi.fn().mockResolvedValue(undefined),
    client,
  } as unknown as RedisService;
  const crypto = new CryptoService(config);
  const service = new GoogleOAuthStateService(redis, crypto, config);
  return { service, redis, client, crypto };
};

const onboardingClaim = (
  overrides: Partial<GoogleOnboardingClaim> = {},
): GoogleOnboardingClaim => ({
  tokenHash: 'b'.repeat(64),
  lockKey: `auth:google:onboarding:${'b'.repeat(64)}:lock`,
  lockValue: 'lock-owner-value-that-is-long-enough',
  ttlSeconds: 240,
  record: onboardingRecord(),
  ...overrides,
});

describe('GoogleOAuthStateService', () => {
  it('stores encrypted authorization state with a hashed browser binding and PKCE challenge', async () => {
    const { service, client, crypto } = setup();
    const state = 'state-secret-value-that-must-not-be-stored';
    const binding = 'binding-secret-value-that-must-not-be-stored';
    const nonce = 'nonce-value-that-is-at-least-thirty-two-characters';
    const codeVerifier = 'v'.repeat(86);
    vi.spyOn(crypto, 'randomToken')
      .mockReturnValueOnce(state)
      .mockReturnValueOnce(binding)
      .mockReturnValueOnce(nonce)
      .mockReturnValueOnce(codeVerifier);
    const browser = response();

    const result = await service.createAuthorization(
      { returnTo: '/account/security', intent: 'LOGIN', locale: 'fr' },
      browser,
    );

    expect(result).toEqual({
      state,
      nonce,
      codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    });
    // Vitest records arbitrary Redis arguments as `any`; assertions below validate every field.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const [key, encrypted, expiryMode, ttl, uniquenessMode] = client.set.mock.calls[0] ?? [];
    expect(key).toBe(`auth:google:state:${crypto.hashToken(state)}`);
    expect(key).not.toContain(state);
    expect(encrypted).not.toContain(binding);
    expect(encrypted).not.toContain(nonce);
    expect(encrypted).not.toContain(codeVerifier);
    expect([expiryMode, ttl, uniquenessMode]).toEqual(['EX', 300, 'NX']);
    expect(JSON.parse(crypto.decrypt(encrypted as string))).toEqual({
      returnTo: '/account/security',
      intent: 'LOGIN',
      locale: 'fr',
      bindingHash: crypto.hashToken(binding),
      nonce,
      codeVerifier,
    });
    expect(browser.cookie).toHaveBeenCalledWith(
      'vape_customer_google_state',
      binding,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', maxAge: 300_000 }),
    );
  });

  it('consumes authorization state exactly once with GETDEL and validates the browser binding', async () => {
    const { service, client, crypto } = setup();
    const state = 'one-time-google-state';
    const binding = 'browser-binding-secret-that-is-long-enough';
    const encrypted = crypto.encrypt(
      JSON.stringify({
        bindingHash: crypto.hashToken(binding),
        nonce: 'nonce-value-that-is-at-least-thirty-two-characters',
        codeVerifier: 'v'.repeat(86),
        returnTo: '/account',
        intent: 'LOGIN',
        locale: 'fr',
      }),
    );
    client.getdel.mockResolvedValueOnce(encrypted).mockResolvedValueOnce(null);
    const browser = response();
    const request = requestWithCookies({ vape_customer_google_state: binding });

    await expect(service.consumeAuthorization(state, request, browser)).resolves.toMatchObject({
      returnTo: '/account',
      bindingHash: crypto.hashToken(binding),
    });
    await expect(service.consumeAuthorization(state, request, browser)).rejects.toBeInstanceOf(
      GoogleOAuthStateError,
    );
    expect(client.getdel).toHaveBeenCalledTimes(2);
    expect(client.get).not.toHaveBeenCalled();
    expect(browser.clearCookie).toHaveBeenCalledWith(
      'vape_customer_google_state',
      expect.objectContaining({ path: '/', sameSite: 'lax' }),
    );
  });

  it('burns a mismatched authorization state and returns only a generic safe error', async () => {
    const { service, client, crypto } = setup();
    const encrypted = crypto.encrypt(
      JSON.stringify({
        bindingHash: crypto.hashToken('expected-browser-binding-secret-value'),
        nonce: 'nonce-value-that-is-at-least-thirty-two-characters',
        codeVerifier: 'v'.repeat(86),
        returnTo: '/account',
        intent: 'LOGIN',
        locale: 'fr',
      }),
    );
    client.getdel.mockResolvedValue(encrypted);

    const error = await service
      .consumeAuthorization(
        'state-that-will-be-consumed',
        requestWithCookies({
          vape_customer_google_state: 'different-browser-binding-secret-value',
        }),
        response(),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GoogleOAuthStateError);
    expect((error as Error).message).toBe('The Google authentication state is invalid or expired.');
    expect((error as Error).message).not.toContain('state-that-will-be-consumed');
    expect((error as Error).message).not.toContain('different-browser-binding');
    expect(client.getdel).toHaveBeenCalledOnce();
  });

  it.each(['/admin', '/admin/users', '/api/v1/orders'])(
    'rejects a customer OAuth state that targets the protected path %s',
    async (returnTo) => {
      const { service, client, crypto } = setup();
      const binding = 'browser-binding-secret-that-is-long-enough';
      client.getdel.mockResolvedValue(
        crypto.encrypt(
          JSON.stringify({
            bindingHash: crypto.hashToken(binding),
            nonce: 'nonce-value-that-is-at-least-thirty-two-characters',
            codeVerifier: 'v'.repeat(86),
            returnTo,
            intent: 'LOGIN',
            locale: 'fr',
          }),
        ),
      );

      await expect(
        service.consumeAuthorization(
          'unsafe-return-state',
          requestWithCookies({ vape_customer_google_state: binding }),
          response(),
        ),
      ).rejects.toBeInstanceOf(GoogleOAuthStateError);
    },
  );

  it('classifies malformed encrypted records as invalid state and Redis failures as unavailable', async () => {
    const malformed = setup({ getdel: vi.fn().mockResolvedValue('not-an-encrypted-record') });
    await expect(
      malformed.service.consumeAuthorization(
        'malformed-state',
        requestWithCookies({
          vape_customer_google_state: 'browser-binding-secret-that-is-long-enough',
        }),
        response(),
      ),
    ).rejects.toBeInstanceOf(GoogleOAuthStateError);

    const unavailable = setup({ getdel: vi.fn().mockRejectedValue(new Error('redis details')) });
    await expect(
      unavailable.service.consumeAuthorization(
        'unavailable-state',
        requestWithCookies({
          vape_customer_google_state: 'browser-binding-secret-that-is-long-enough',
        }),
        response(),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTHENTICATION_DEPENDENCY_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      },
    });
  });

  it('stores encrypted short-lived onboarding state under only the token hash', async () => {
    const { service, client, crypto } = setup();
    const token = 'onboarding-cookie-secret-that-is-not-stored';
    vi.spyOn(crypto, 'randomToken').mockReturnValue(token);
    const browser = response();
    const record = onboardingRecord();
    const createRecord = {
      mode: record.mode,
      subjectHash: record.subjectHash,
      email: record.email,
      emailNormalized: record.emailNormalized,
      fullName: record.fullName,
      returnTo: record.returnTo,
      locale: record.locale,
    };

    await service.createOnboarding(createRecord, browser);

    // Vitest records arbitrary Redis arguments as `any`; assertions below validate every field.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const [key, encrypted, expiryMode, ttl, uniquenessMode] = client.set.mock.calls[0] ?? [];
    expect(key).toBe(`auth:google:onboarding:${crypto.hashToken(token)}`);
    expect(key).not.toContain(token);
    expect(encrypted).not.toContain(record.email);
    expect(encrypted).not.toContain(record.subjectHash);
    expect([expiryMode, ttl, uniquenessMode]).toEqual(['EX', 300, 'NX']);
    expect(JSON.parse(crypto.decrypt(encrypted as string))).toEqual(record);
    expect(browser.cookie).toHaveBeenCalledWith(
      'vape_customer_google_onboarding',
      token,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', maxAge: 300_000 }),
    );
  });

  it('releases an acquired lock when onboarding state is malformed', async () => {
    const { service, client, crypto } = setup({
      get: vi.fn().mockResolvedValue('malformed-encrypted-record'),
      ttl: vi.fn().mockResolvedValue(200),
    });
    const token = 'onboarding-cookie-secret-that-is-long-enough';
    const lockValue = 'lock-owner-secret-that-is-long-enough';
    vi.spyOn(crypto, 'randomToken').mockReturnValue(lockValue);

    await expect(
      service.claimOnboarding(requestWithCookies({ vape_customer_google_onboarding: token })),
    ).rejects.toBeInstanceOf(GoogleOAuthStateError);

    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get',KEYS[1])==ARGV[1]"),
      1,
      `auth:google:onboarding:${crypto.hashToken(token)}:lock`,
      lockValue,
    );
  });

  it('finishes onboarding atomically only while owning the lock and clears the cookie', async () => {
    const { service, client } = setup({ eval: vi.fn().mockResolvedValue(1) });
    const claim = onboardingClaim();
    const browser = response();

    await expect(service.finishOnboarding(claim, browser)).resolves.toBeUndefined();

    expect(client.eval).toHaveBeenCalledWith(
      expect.stringMatching(/exists[\s\S]*del/),
      2,
      `auth:google:onboarding:${claim.tokenHash}`,
      claim.lockKey,
      claim.lockValue,
    );
    expect(client.del).not.toHaveBeenCalled();
    expect(browser.clearCookie).toHaveBeenCalledWith(
      'vape_customer_google_onboarding',
      expect.objectContaining({ path: '/', sameSite: 'lax' }),
    );
  });

  it('does not finish state after losing lock ownership and still removes the browser cookie', async () => {
    const { service, client } = setup({ eval: vi.fn().mockResolvedValue(0) });
    const browser = response();

    await expect(service.finishOnboarding(onboardingClaim(), browser)).rejects.toBeInstanceOf(
      GoogleOAuthStateError,
    );
    expect(client.del).not.toHaveBeenCalled();
    expect(browser.clearCookie).toHaveBeenCalledOnce();
  });

  it('updates failed-link attempts atomically without extending the record TTL', async () => {
    const { service, client, crypto } = setup({ eval: vi.fn().mockResolvedValue(1) });
    const claim = onboardingClaim({ record: onboardingRecord({ mode: 'LINK', attempts: 2 }) });

    await service.recordFailedLink(claim, response());

    // Vitest records arbitrary Redis arguments as `any`; assertions below validate every field.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const [script, keyCount, stateKey, lockKey, lockValue, operation, encrypted] =
      client.eval.mock.calls[0] ?? [];
    expect(script).toContain('KEEPTTL');
    expect([keyCount, stateKey, lockKey, lockValue, operation]).toEqual([
      2,
      `auth:google:onboarding:${claim.tokenHash}`,
      claim.lockKey,
      claim.lockValue,
      'UPDATE',
    ]);
    expect(encrypted).not.toContain(claim.record.email);
    expect(JSON.parse(crypto.decrypt(encrypted as string))).toEqual({
      ...claim.record,
      attempts: 3,
    });
    expect(client.set).not.toHaveBeenCalled();
    expect(client.del).not.toHaveBeenCalled();
  });

  it('atomically exhausts failed-link state and clears the onboarding cookie', async () => {
    const { service, client } = setup({ eval: vi.fn().mockResolvedValue(1) });
    const claim = onboardingClaim({ record: onboardingRecord({ mode: 'LINK', attempts: 4 }) });
    const browser = response();

    await service.recordFailedLink(claim, browser);

    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("ARGV[2] == 'DELETE'"),
      2,
      `auth:google:onboarding:${claim.tokenHash}`,
      claim.lockKey,
      claim.lockValue,
      'DELETE',
      '',
    );
    expect(client.del).not.toHaveBeenCalled();
    expect(browser.clearCookie).toHaveBeenCalledOnce();
  });
});
