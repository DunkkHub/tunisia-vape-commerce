import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../common/security/crypto.service';
import type { Environment } from '../config/environment';
import type { PrismaService } from '../database/prisma.service';
import type { AuthEventService } from './auth-event.service';
import type { CustomerAuthService } from './customer-auth.service';
import type { DistributedAuthThrottleService } from './distributed-auth-throttle.service';
import {
  GoogleCustomerAuthService,
  GoogleOAuthFlowError,
  isSafeCustomerReturnPath,
} from './google-customer-auth.service';
import type { GoogleIdentityProvider, VerifiedGoogleIdentity } from './google-identity.provider';
import type { GoogleOAuthStateService, GoogleOnboardingClaim } from './google-oauth-state.service';
import type { SessionService } from './session.service';

const verifyPassword = vi.hoisted(() => vi.fn());

vi.mock('argon2', () => ({
  argon2id: 2,
  default: {
    hash: vi.fn().mockResolvedValue('unused-password-hash'),
    verify: verifyPassword,
  },
}));

const googleIdentity: VerifiedGoogleIdentity = {
  subject: 'stable-google-subject',
  email: 'Verified.Customer@Example.test',
  emailNormalized: 'verified.customer@example.test',
  fullName: 'Verified Customer',
};

const request = () =>
  ({
    cookies: {},
    get: vi.fn().mockReturnValue('vitest'),
    ip: '127.0.0.1',
    socket: {},
    requestId: 'google-customer-auth-request',
  }) as unknown as Request;

const response = () => ({ cookie: vi.fn(), clearCookie: vi.fn() }) as unknown as Response;

const onboardingClaim = (
  overrides: Partial<GoogleOnboardingClaim['record']> = {},
): GoogleOnboardingClaim => ({
  tokenHash: 'a'.repeat(64),
  lockKey: `auth:google:onboarding:${'a'.repeat(64)}:lock`,
  lockValue: 'onboarding-lock-owner',
  ttlSeconds: 300,
  record: {
    mode: 'LINK',
    subjectHash: 'google-subject-hash',
    email: googleIdentity.email,
    emailNormalized: googleIdentity.emailNormalized,
    fullName: googleIdentity.fullName,
    customerId: 'customer-profile-1',
    returnTo: '/account',
    locale: 'fr',
    attempts: 0,
    ...overrides,
  },
});

const setup = (enabled = true) => {
  const transaction = {
    customerExternalIdentity: {
      create: vi.fn().mockResolvedValue({ id: 'google-identity-1' }),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'customer-user-1',
        emailVerifiedAt: null,
        customerProfile: { id: 'customer-profile-1', suspendedAt: null },
      }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    customerExternalIdentity: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    customerProfile: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn((operation: unknown) => {
      if (Array.isArray(operation)) return Promise.all(operation);
      if (typeof operation === 'function') {
        return Promise.resolve((operation as (value: typeof transaction) => unknown)(transaction));
      }
      return Promise.reject(new Error('Unexpected transaction operation.'));
    }),
  };
  const provider = {
    isEnabled: vi.fn().mockReturnValue(enabled),
    authorizationUrl: vi.fn().mockReturnValue('https://accounts.google.test/authorize'),
    exchange: vi.fn().mockResolvedValue(googleIdentity),
  };
  const state = {
    createAuthorization: vi.fn().mockResolvedValue({
      state: 'authorization-state',
      nonce: 'authorization-nonce',
      codeChallenge: 'pkce-challenge',
    }),
    consumeAuthorization: vi.fn().mockResolvedValue({
      bindingHash: 'b'.repeat(64),
      nonce: 'authorization-nonce',
      codeVerifier: 'v'.repeat(64),
      returnTo: '/account',
      intent: 'LOGIN',
      locale: 'fr',
    }),
    createOnboarding: vi.fn().mockResolvedValue(undefined),
    readOnboarding: vi.fn(),
    onboardingDiscriminator: vi.fn().mockReturnValue('onboarding-discriminator-hash'),
    claimOnboarding: vi.fn(),
    finishOnboarding: vi.fn().mockResolvedValue(undefined),
    releaseOnboarding: vi.fn().mockResolvedValue(undefined),
    recordFailedLink: vi.fn().mockResolvedValue(undefined),
  };
  const customerAuth = {
    createGoogleCustomer: vi.fn().mockResolvedValue('customer-user-1'),
  };
  const sessions = {
    issue: vi.fn().mockResolvedValue({
      sessionId: 'customer-session-1',
      expiresAt: new Date('2026-08-04T12:00:00.000Z'),
    }),
    customerResponse: vi.fn().mockResolvedValue({
      data: {
        user: { id: 'customer-user-1' },
        expiresAt: '2026-08-04T12:00:00.000Z',
      },
    }),
  };
  const events = {
    loginAttempt: vi.fn().mockResolvedValue(undefined),
    audit: vi.fn().mockResolvedValue(undefined),
  };
  const throttle = {
    consume: vi.fn().mockResolvedValue(undefined),
  };
  const crypto = {
    hashToken: vi.fn((value: string) =>
      value.startsWith('google:') ? 'google-subject-hash' : 'request-discriminator-hash',
    ),
  };
  const config = {
    get: vi.fn((key: keyof Environment) =>
      key === 'GOOGLE_OAUTH_STATE_TTL_SECONDS' ? 300 : undefined,
    ),
  };

  const service = new GoogleCustomerAuthService(
    prisma as unknown as PrismaService,
    provider as unknown as GoogleIdentityProvider,
    state as unknown as GoogleOAuthStateService,
    customerAuth as unknown as CustomerAuthService,
    sessions as unknown as SessionService,
    events as unknown as AuthEventService,
    throttle as unknown as DistributedAuthThrottleService,
    crypto as unknown as CryptoService,
    config as unknown as ConfigService<Environment, true>,
  );

  return {
    service,
    prisma,
    transaction,
    provider,
    state,
    customerAuth,
    sessions,
    events,
    throttle,
    crypto,
  };
};

const callbackInput = {
  state: 'authorization-state-value',
  code: 'authorization-code-value',
};

describe('isSafeCustomerReturnPath', () => {
  it.each(['/', '/account', '/account/orders?status=open', '/products#featured'])(
    'accepts customer-local return path %s',
    (returnTo) => {
      expect(isSafeCustomerReturnPath(returnTo)).toBe(true);
    },
  );

  it.each([
    '/admin',
    '/admin/users',
    '/ADMIN?tab=security',
    '/api',
    '/api/v1/orders',
    '//attacker.example/path',
    '/account\\attacker.example',
    'https://attacker.example/path',
  ])('rejects privileged or non-local return path %s', (returnTo) => {
    expect(isSafeCustomerReturnPath(returnTo)).toBe(false);
  });
});

describe('GoogleCustomerAuthService', () => {
  beforeEach(() => {
    verifyPassword.mockReset();
  });

  it('fails closed before state, throttling, or session work when Google is disabled', async () => {
    const { service, provider, state, sessions, throttle } = setup(false);
    const browserRequest = request();
    const browserResponse = response();

    const startError = await service
      .start(
        { intent: 'LOGIN', returnTo: '/account', locale: 'fr' },
        browserRequest,
        browserResponse,
      )
      .catch((error: unknown) => error);
    const callbackError = await service
      .callback(callbackInput, browserRequest, browserResponse)
      .catch((error: unknown) => error);

    expect(startError).toBeInstanceOf(ServiceUnavailableException);
    expect(startError).toMatchObject({
      response: { code: 'GOOGLE_AUTH_NOT_CONFIGURED' },
    });
    expect(callbackError).toBeInstanceOf(GoogleOAuthFlowError);
    expect(callbackError).toMatchObject({ reason: 'configuration', returnTo: '/login' });
    expect(provider.exchange).not.toHaveBeenCalled();
    expect(state.consumeAuthorization).not.toHaveBeenCalled();
    expect(throttle.consume).not.toHaveBeenCalled();
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('revalidates consumed return paths before exchanging a code or issuing a session', async () => {
    const { service, provider, state, sessions } = setup();
    state.consumeAuthorization.mockResolvedValue({
      bindingHash: 'b'.repeat(64),
      nonce: 'authorization-nonce',
      codeVerifier: 'v'.repeat(64),
      returnTo: '/admin/users',
      intent: 'LOGIN',
      locale: 'fr',
    });

    const error = await service
      .callback(callbackInput, request(), response())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GoogleOAuthFlowError);
    expect(error).toMatchObject({ reason: 'state', returnTo: '/login' });
    expect(provider.exchange).not.toHaveBeenCalled();
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('logs in an active customer through an existing linked Google identity', async () => {
    const { service, prisma, sessions, events } = setup();
    prisma.customerExternalIdentity.findUnique.mockResolvedValue({
      id: 'google-identity-1',
      customerId: 'customer-profile-1',
      customer: {
        userId: 'customer-user-1',
        suspendedAt: null,
        user: { id: 'customer-user-1', audience: 'CUSTOMER', status: 'ACTIVE' },
      },
    });

    await expect(service.callback(callbackInput, request(), response())).resolves.toEqual({
      kind: 'AUTHENTICATED',
      returnTo: '/account',
    });

    expect(prisma.customerExternalIdentity.update).toHaveBeenCalledWith({
      where: { id: 'google-identity-1' },
      data: {
        emailNormalized: googleIdentity.emailNormalized,
        // Vitest's asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        lastAuthenticatedAt: expect.any(Date),
      },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'customer-user-1' },
      data: {
        // Vitest's asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        lastLoginAt: expect.any(Date),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    expect(sessions.issue).toHaveBeenCalledWith(
      'customer-user-1',
      'CUSTOMER',
      false,
      expect.anything(),
      expect.anything(),
    );
    expect(events.loginAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: 'CUSTOMER',
        identifier: googleIdentity.emailNormalized,
        result: 'SUCCESS',
        userId: 'customer-user-1',
      }),
    );
    expect(events.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.customer.google.login',
        outcome: 'SUCCESS',
        sessionId: 'customer-session-1',
      }),
    );
  });

  it('rejects an administrator email conflict without creating onboarding or a customer session', async () => {
    const { service, prisma, state, sessions, events } = setup();
    prisma.user.findFirst.mockResolvedValue({
      id: 'admin-user-1',
      audience: 'ADMIN',
      emailNormalized: googleIdentity.emailNormalized,
    });

    const error = await service
      .callback(callbackInput, request(), response())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GoogleOAuthFlowError);
    expect(error).toMatchObject({ reason: 'account_conflict', returnTo: '/account' });
    expect(events.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: 'CUSTOMER',
        action: 'auth.customer.google.login',
        outcome: 'DENIED',
        errorCode: 'GOOGLE_ADMIN_EMAIL_CONFLICT',
      }),
    );
    expect(state.createOnboarding).not.toHaveBeenCalled();
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('creates onboarding state for a new verified Google identity without issuing a session', async () => {
    const { service, state, sessions } = setup();
    const browserResponse = response();

    await expect(service.callback(callbackInput, request(), browserResponse)).resolves.toEqual({
      kind: 'ONBOARDING',
      returnTo: '/register/google',
    });

    expect(state.createOnboarding).toHaveBeenCalledWith(
      {
        mode: 'CREATE',
        subjectHash: 'google-subject-hash',
        email: googleIdentity.email,
        emailNormalized: googleIdentity.emailNormalized,
        fullName: googleIdentity.fullName,
        returnTo: '/account',
        locale: 'fr',
      },
      browserResponse,
    );
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('completes new-customer onboarding before consuming state and issuing a session', async () => {
    const { service, state, customerAuth, sessions, events } = setup();
    const claim = onboardingClaim({ mode: 'CREATE', customerId: undefined });
    state.claimOnboarding.mockResolvedValue(claim);
    const browserRequest = request();
    const browserResponse = response();

    const result = await service.complete(
      {
        fullName: 'Amel Ben Salah',
        phone: '+21620123456',
        adultConfirmed: true,
        termsAccepted: true,
        locale: 'ar',
      },
      browserRequest,
      browserResponse,
    );

    expect(customerAuth.createGoogleCustomer).toHaveBeenCalledWith(
      {
        fullName: 'Amel Ben Salah',
        email: googleIdentity.email,
        phone: '+21620123456',
        adultConfirmed: true,
        termsAccepted: true,
        locale: 'ar',
        providerSubjectHash: 'google-subject-hash',
      },
      browserRequest,
    );
    expect(state.finishOnboarding).toHaveBeenCalledWith(claim, browserResponse);
    expect(sessions.issue).toHaveBeenCalledWith(
      'customer-user-1',
      'CUSTOMER',
      false,
      browserRequest,
      browserResponse,
    );
    expect(events.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.customer.google.register', outcome: 'SUCCESS' }),
    );
    expect(result).toEqual({
      data: {
        user: { id: 'customer-user-1' },
        expiresAt: '2026-08-04T12:00:00.000Z',
      },
    });
  });

  it('auto-links an active verified-email customer and authenticates it', async () => {
    const { service, prisma, transaction, state, sessions } = setup();
    const verifiedAt = new Date('2026-08-01T09:00:00.000Z');
    prisma.user.findFirst.mockResolvedValue({
      id: 'customer-user-1',
      audience: 'CUSTOMER',
      status: 'ACTIVE',
      emailNormalized: googleIdentity.emailNormalized,
      emailVerifiedAt: verifiedAt,
      customerProfile: {
        id: 'customer-profile-1',
        suspendedAt: null,
        externalIdentities: [],
      },
    });
    transaction.user.findFirst.mockResolvedValue({
      id: 'customer-user-1',
      emailVerifiedAt: verifiedAt,
      customerProfile: { id: 'customer-profile-1', suspendedAt: null },
    });

    await expect(service.callback(callbackInput, request(), response())).resolves.toEqual({
      kind: 'AUTHENTICATED',
      returnTo: '/account',
    });

    expect(transaction.customerExternalIdentity.create).toHaveBeenCalledWith({
      data: {
        customerId: 'customer-profile-1',
        provider: 'GOOGLE',
        providerSubjectHash: 'google-subject-hash',
        emailNormalized: googleIdentity.emailNormalized,
        // Vitest's asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        lastAuthenticatedAt: expect.any(Date),
      },
    });
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: 'customer-user-1' },
      data: {
        emailVerifiedAt: verifiedAt,
        // Vitest's asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        lastLoginAt: expect.any(Date),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    expect(state.createOnboarding).not.toHaveBeenCalled();
    expect(sessions.issue).toHaveBeenCalledOnce();
  });

  it('requires password-confirmation onboarding before linking an unverified-email customer', async () => {
    const { service, prisma, state, sessions } = setup();
    const browserResponse = response();
    prisma.user.findFirst.mockResolvedValue({
      id: 'customer-user-1',
      audience: 'CUSTOMER',
      status: 'ACTIVE',
      emailNormalized: googleIdentity.emailNormalized,
      emailVerifiedAt: null,
      customerProfile: {
        id: 'customer-profile-1',
        suspendedAt: null,
        externalIdentities: [],
      },
    });

    await expect(service.callback(callbackInput, request(), browserResponse)).resolves.toEqual({
      kind: 'ONBOARDING',
      returnTo: '/register/google',
    });

    expect(state.createOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'LINK',
        subjectHash: 'google-subject-hash',
        customerId: 'customer-profile-1',
        emailNormalized: googleIdentity.emailNormalized,
        returnTo: '/account',
      }),
      browserResponse,
    );
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('links an unverified-email customer only after a valid current-password check', async () => {
    const { service, prisma, transaction, state, sessions, events } = setup();
    const claim = onboardingClaim();
    state.claimOnboarding.mockResolvedValue(claim);
    prisma.customerProfile.findUnique.mockResolvedValue({
      id: 'customer-profile-1',
      userId: 'customer-user-1',
      suspendedAt: null,
      user: {
        id: 'customer-user-1',
        audience: 'CUSTOMER',
        emailNormalized: googleIdentity.emailNormalized,
        emailVerifiedAt: null,
        status: 'ACTIVE',
        passwordHash: 'existing-password-hash',
      },
      externalIdentities: [],
    });
    transaction.user.findFirst.mockResolvedValue({
      id: 'customer-user-1',
      emailVerifiedAt: null,
      customerProfile: { id: 'customer-profile-1', suspendedAt: null },
    });
    verifyPassword.mockResolvedValue(true);
    const browserRequest = request();
    const browserResponse = response();

    await service.complete(
      { currentPassword: 'Confirmed-password-2026!' },
      browserRequest,
      browserResponse,
    );

    expect(verifyPassword).toHaveBeenCalledWith(
      'existing-password-hash',
      'Confirmed-password-2026!',
    );
    expect(transaction.customerExternalIdentity.create).toHaveBeenCalledOnce();
    expect(state.finishOnboarding).toHaveBeenCalledWith(claim, browserResponse);
    expect(state.recordFailedLink).not.toHaveBeenCalled();
    expect(sessions.issue).toHaveBeenCalledOnce();
    expect(events.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.customer.google.link', outcome: 'SUCCESS' }),
    );
  });

  it('records an invalid linking password as a retry without finishing or releasing onboarding', async () => {
    const { service, prisma, state, sessions, events } = setup();
    const claim = onboardingClaim({ attempts: 2 });
    state.claimOnboarding.mockResolvedValue(claim);
    prisma.customerProfile.findUnique.mockResolvedValue({
      id: 'customer-profile-1',
      userId: 'customer-user-1',
      suspendedAt: null,
      user: {
        id: 'customer-user-1',
        audience: 'CUSTOMER',
        emailNormalized: googleIdentity.emailNormalized,
        status: 'ACTIVE',
        passwordHash: 'existing-password-hash',
      },
      externalIdentities: [],
    });
    verifyPassword.mockResolvedValue(false);
    const browserRequest = request();
    const browserResponse = response();

    const error = await service
      .complete({ currentPassword: 'Incorrect-password-2026!' }, browserRequest, browserResponse)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error).toMatchObject({
      response: { code: 'GOOGLE_LINK_CREDENTIALS_INVALID' },
    });
    expect(events.loginAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: 'CUSTOMER',
        identifier: googleIdentity.emailNormalized,
        result: 'INVALID_CREDENTIALS',
        userId: 'customer-user-1',
      }),
    );
    expect(state.recordFailedLink).toHaveBeenCalledWith(claim, browserResponse);
    expect(state.finishOnboarding).not.toHaveBeenCalled();
    expect(state.releaseOnboarding).not.toHaveBeenCalled();
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive', { audience: 'CUSTOMER', status: 'SUSPENDED' }, null],
    ['suspended', { audience: 'CUSTOMER', status: 'ACTIVE' }, new Date('2026-08-01')],
  ])(
    'rejects an %s linked customer before database updates or session issuance',
    async (_description, user, suspendedAt) => {
      const { service, prisma, sessions } = setup();
      prisma.customerExternalIdentity.findUnique.mockResolvedValue({
        id: 'google-identity-1',
        customerId: 'customer-profile-1',
        customer: {
          userId: 'customer-user-1',
          suspendedAt,
          user: { id: 'customer-user-1', ...user },
        },
      });

      const error = await service
        .callback(callbackInput, request(), response())
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(GoogleOAuthFlowError);
      expect(error).toMatchObject({ reason: 'account_unavailable', returnTo: '/account' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(sessions.issue).not.toHaveBeenCalled();
    },
  );
});
