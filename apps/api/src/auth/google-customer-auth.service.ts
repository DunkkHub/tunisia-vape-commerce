import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { AUTH_AUDIENCES } from '../common/auth/auth.constants';
import { CryptoService } from '../common/security/crypto.service';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import { AuthEventService } from './auth-event.service';
import { CustomerAuthService } from './customer-auth.service';
import { DistributedAuthThrottleService } from './distributed-auth-throttle.service';
import type {
  GoogleOAuthCallbackDto,
  GoogleOAuthCompleteDto,
  GoogleOAuthStartDto,
} from './dto/customer-auth.dto';
import {
  GoogleIdentityProvider,
  GoogleIdentityVerificationError,
  type VerifiedGoogleIdentity,
} from './google-identity.provider';
import {
  GoogleOAuthStateError,
  GoogleOAuthStateService,
  type GoogleOnboardingRecord,
} from './google-oauth-state.service';
import { SessionService } from './session.service';

export type GoogleOAuthFailureReason =
  | 'access_denied'
  | 'account_conflict'
  | 'account_unavailable'
  | 'configuration'
  | 'provider'
  | 'state';

export class GoogleOAuthFlowError extends Error {
  constructor(
    readonly reason: GoogleOAuthFailureReason,
    readonly returnTo = '/login',
  ) {
    super('Google authentication could not be completed.');
    this.name = 'GoogleOAuthFlowError';
  }
}

export const isSafeCustomerReturnPath = (value: string): boolean => {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false;
  const pathname = value.split(/[?#]/, 1)[0]?.toLocaleLowerCase('en-US') ?? '';
  return (
    pathname !== '/admin' &&
    !pathname.startsWith('/admin/') &&
    pathname !== '/api' &&
    !pathname.startsWith('/api/')
  );
};

type CallbackResult =
  | { kind: 'AUTHENTICATED'; returnTo: string }
  | { kind: 'ONBOARDING'; returnTo: '/register/google' };

@Injectable()
export class GoogleCustomerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: GoogleIdentityProvider,
    private readonly state: GoogleOAuthStateService,
    private readonly customerAuth: CustomerAuthService,
    private readonly sessions: SessionService,
    private readonly events: AuthEventService,
    private readonly throttle: DistributedAuthThrottleService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  isEnabled(): boolean {
    return this.provider.isEnabled();
  }

  async start(input: GoogleOAuthStartDto, request: Request, response: Response) {
    if (!this.provider.isEnabled()) throw this.notConfigured();
    await this.throttle.consume('customer-google-start', input.returnTo, request, 10, 5 * 60);
    const authorization = await this.state.createAuthorization(
      {
        intent: input.intent,
        locale: input.locale,
        returnTo: input.returnTo,
      },
      response,
    );
    return {
      data: {
        authorizationUrl: this.provider.authorizationUrl(authorization),
      },
    };
  }

  async callback(
    input: GoogleOAuthCallbackDto,
    request: Request,
    response: Response,
  ): Promise<CallbackResult> {
    if (!this.provider.isEnabled()) throw new GoogleOAuthFlowError('configuration');
    if (!input.state) {
      await this.auditFailure(request, 'GOOGLE_STATE_MISSING');
      throw new GoogleOAuthFlowError('state');
    }
    let authorizationState;
    try {
      authorizationState = await this.state.consumeAuthorization(input.state, request, response);
    } catch (error) {
      if (error instanceof GoogleOAuthStateError) {
        await this.auditFailure(request, 'GOOGLE_STATE_INVALID');
        throw new GoogleOAuthFlowError('state');
      }
      throw error;
    }
    if (!isSafeCustomerReturnPath(authorizationState.returnTo)) {
      await this.auditFailure(request, 'GOOGLE_RETURN_PATH_INVALID');
      throw new GoogleOAuthFlowError('state');
    }
    if (input.error || !input.code) {
      await this.auditFailure(
        request,
        input.error === 'access_denied' ? 'GOOGLE_ACCESS_DENIED' : 'GOOGLE_PROVIDER_ERROR',
      );
      throw new GoogleOAuthFlowError(
        input.error === 'access_denied' ? 'access_denied' : 'provider',
        authorizationState.returnTo,
      );
    }

    let identity: VerifiedGoogleIdentity;
    try {
      identity = await this.provider.exchange({
        code: input.code,
        codeVerifier: authorizationState.codeVerifier,
        nonce: authorizationState.nonce,
      });
    } catch (error) {
      if (error instanceof GoogleIdentityVerificationError) {
        await this.auditFailure(request, 'GOOGLE_IDENTITY_INVALID');
        throw new GoogleOAuthFlowError('provider', authorizationState.returnTo);
      }
      throw error;
    }
    return this.resolveIdentity(identity, authorizationState, request, response);
  }

  async onboarding(request: Request) {
    if (!this.provider.isEnabled()) throw this.notConfigured();
    const record = await this.state.readOnboarding(request);
    return {
      data: {
        mode: record.mode,
        email: record.email,
        fullName: record.fullName,
        locale: record.locale,
        expiresInSeconds: this.config.get('GOOGLE_OAUTH_STATE_TTL_SECONDS', { infer: true }),
      },
    };
  }

  async complete(input: GoogleOAuthCompleteDto, request: Request, response: Response) {
    if (!this.provider.isEnabled()) throw this.notConfigured();
    await this.throttle.consume(
      'customer-google-complete',
      this.state.onboardingDiscriminator(request),
      request,
      5,
      15 * 60,
    );
    const claim = await this.state.claimOnboarding(request);
    try {
      const userId =
        claim.record.mode === 'CREATE'
          ? await this.completeCreation(claim.record, input, request)
          : await this.completeLink(claim.record, input, request, response, claim);
      await this.state.finishOnboarding(claim, response);
      const session = await this.sessions.issue(
        userId,
        AUTH_AUDIENCES.CUSTOMER,
        false,
        request,
        response,
      );
      await this.events.loginAttempt({
        audience: 'CUSTOMER',
        identifier: claim.record.emailNormalized,
        result: 'SUCCESS',
        request,
        userId,
      });
      await this.events.audit({
        audience: 'CUSTOMER',
        action:
          claim.record.mode === 'CREATE'
            ? 'auth.customer.google.register'
            : 'auth.customer.google.link',
        outcome: 'SUCCESS',
        request,
        userId,
        sessionId: session.sessionId,
      });
      return this.sessions.customerResponse(userId, session.expiresAt);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) {
        await this.state.releaseOnboarding(claim);
      }
      throw error;
    }
  }

  private async resolveIdentity(
    identity: VerifiedGoogleIdentity,
    authorization: { returnTo: string; locale: 'fr' | 'ar' },
    request: Request,
    response: Response,
  ): Promise<CallbackResult> {
    const providerSubjectHash = this.providerSubjectHash(identity.subject);
    const existingIdentity = await this.prisma.customerExternalIdentity.findUnique({
      where: {
        provider_providerSubjectHash: {
          provider: 'GOOGLE',
          providerSubjectHash,
        },
      },
      include: { customer: { include: { user: true } } },
    });
    if (existingIdentity) {
      const { customer } = existingIdentity;
      this.assertOperationalCustomer(customer.user, customer.suspendedAt, authorization.returnTo);
      await this.prisma.$transaction([
        this.prisma.customerExternalIdentity.update({
          where: { id: existingIdentity.id },
          data: {
            emailNormalized: identity.emailNormalized,
            lastAuthenticatedAt: new Date(),
          },
        }),
        this.prisma.user.update({
          where: { id: customer.userId },
          data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
        }),
      ]);
      await this.authenticate(
        customer.userId,
        identity.emailNormalized,
        authorization.returnTo,
        request,
        response,
      );
      return { kind: 'AUTHENTICATED', returnTo: authorization.returnTo };
    }

    const matchingUser = await this.prisma.user.findFirst({
      where: { emailNormalized: identity.emailNormalized },
      include: {
        customerProfile: { include: { externalIdentities: true } },
      },
    });
    if (matchingUser?.audience === 'ADMIN') {
      await this.auditFailure(request, 'GOOGLE_ADMIN_EMAIL_CONFLICT');
      throw new GoogleOAuthFlowError('account_conflict', authorization.returnTo);
    }
    if (matchingUser) {
      if (!matchingUser.customerProfile) {
        throw new GoogleOAuthFlowError('account_conflict', authorization.returnTo);
      }
      this.assertOperationalCustomer(
        matchingUser,
        matchingUser.customerProfile.suspendedAt,
        authorization.returnTo,
      );
      if (
        matchingUser.customerProfile.externalIdentities.some(
          ({ provider }) => provider === 'GOOGLE',
        )
      ) {
        throw new GoogleOAuthFlowError('account_conflict', authorization.returnTo);
      }
      if (matchingUser.emailVerifiedAt) {
        await this.linkVerifiedCustomer(
          matchingUser.id,
          matchingUser.customerProfile.id,
          providerSubjectHash,
          identity.emailNormalized,
          authorization.returnTo,
        );
        await this.authenticate(
          matchingUser.id,
          identity.emailNormalized,
          authorization.returnTo,
          request,
          response,
        );
        return { kind: 'AUTHENTICATED', returnTo: authorization.returnTo };
      }
      await this.state.createOnboarding(
        {
          mode: 'LINK',
          subjectHash: providerSubjectHash,
          email: identity.email,
          emailNormalized: identity.emailNormalized,
          fullName: identity.fullName,
          customerId: matchingUser.customerProfile.id,
          returnTo: authorization.returnTo,
          locale: authorization.locale,
        },
        response,
      );
      return { kind: 'ONBOARDING', returnTo: '/register/google' };
    }

    await this.state.createOnboarding(
      {
        mode: 'CREATE',
        subjectHash: providerSubjectHash,
        email: identity.email,
        emailNormalized: identity.emailNormalized,
        fullName: identity.fullName,
        returnTo: authorization.returnTo,
        locale: authorization.locale,
      },
      response,
    );
    return { kind: 'ONBOARDING', returnTo: '/register/google' };
  }

  private async completeCreation(
    record: GoogleOnboardingRecord,
    input: GoogleOAuthCompleteDto,
    request: Request,
  ): Promise<string> {
    const missing = [
      ...(!input.fullName ? ['fullName'] : []),
      ...(!input.phone ? ['phone'] : []),
      ...(input.adultConfirmed === undefined ? ['adultConfirmed'] : []),
      ...(input.termsAccepted === undefined ? ['termsAccepted'] : []),
    ];
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'GOOGLE_ONBOARDING_FIELDS_REQUIRED',
        message: 'Complete the required customer profile fields.',
        fields: missing,
      });
    }
    return this.customerAuth.createGoogleCustomer(
      {
        fullName: input.fullName!,
        email: record.email,
        phone: input.phone!,
        adultConfirmed: input.adultConfirmed!,
        termsAccepted: input.termsAccepted!,
        locale: input.locale ?? record.locale,
        providerSubjectHash: record.subjectHash,
      },
      request,
    );
  }

  private async completeLink(
    record: GoogleOnboardingRecord,
    input: GoogleOAuthCompleteDto,
    request: Request,
    response: Response,
    claim: Parameters<GoogleOAuthStateService['recordFailedLink']>[0],
  ): Promise<string> {
    if (!record.customerId || !input.currentPassword) {
      throw new BadRequestException({
        code: 'GOOGLE_LINK_PASSWORD_REQUIRED',
        message: 'Confirm the existing customer password to link Google.',
      });
    }
    const profile = await this.prisma.customerProfile.findUnique({
      where: { id: record.customerId },
      include: { user: true, externalIdentities: true },
    });
    if (
      !profile ||
      profile.user.audience !== 'CUSTOMER' ||
      profile.user.emailNormalized !== record.emailNormalized ||
      profile.user.status !== 'ACTIVE' ||
      profile.suspendedAt ||
      !profile.user.passwordHash ||
      profile.externalIdentities.some(({ provider }) => provider === 'GOOGLE')
    ) {
      throw new ConflictException({
        code: 'GOOGLE_ACCOUNT_STATE_CHANGED',
        message: 'The account could not be linked. Start Google sign-in again.',
      });
    }
    const valid = await argon2.verify(profile.user.passwordHash, input.currentPassword);
    if (!valid) {
      await this.events.loginAttempt({
        audience: 'CUSTOMER',
        identifier: record.emailNormalized,
        result: 'INVALID_CREDENTIALS',
        request,
        userId: profile.userId,
      });
      await this.state.recordFailedLink(claim, response);
      throw new UnauthorizedException({
        code: 'GOOGLE_LINK_CREDENTIALS_INVALID',
        message: 'The existing customer credentials could not be confirmed.',
      });
    }
    await this.linkVerifiedCustomer(
      profile.userId,
      profile.id,
      record.subjectHash,
      record.emailNormalized,
      record.returnTo,
    );
    return profile.userId;
  }

  private async linkVerifiedCustomer(
    userId: string,
    customerId: string,
    providerSubjectHash: string,
    emailNormalized: string,
    returnTo: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.user.findFirst({
          where: { id: userId, audience: 'CUSTOMER', status: 'ACTIVE' },
          include: { customerProfile: true },
        });
        if (!current?.customerProfile || current.customerProfile.suspendedAt) {
          throw new GoogleOAuthFlowError('account_unavailable', returnTo);
        }
        await transaction.customerExternalIdentity.create({
          data: {
            customerId,
            provider: 'GOOGLE',
            providerSubjectHash,
            emailNormalized,
            lastAuthenticatedAt: new Date(),
          },
        });
        await transaction.user.update({
          where: { id: userId },
          data: {
            emailVerifiedAt: current.emailVerifiedAt ?? new Date(),
            lastLoginAt: new Date(),
            failedLoginCount: 0,
            lockedUntil: null,
          },
        });
      });
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        const winner = await this.prisma.customerExternalIdentity.findUnique({
          where: {
            provider_providerSubjectHash: {
              provider: 'GOOGLE',
              providerSubjectHash,
            },
          },
        });
        if (winner?.customerId === customerId) return;
        throw new GoogleOAuthFlowError('account_conflict', returnTo);
      }
      throw error;
    }
  }

  private async authenticate(
    userId: string,
    identifier: string,
    returnTo: string,
    request: Request,
    response: Response,
  ): Promise<void> {
    if (!isSafeCustomerReturnPath(returnTo)) {
      throw new GoogleOAuthFlowError('state');
    }
    const session = await this.sessions.issue(
      userId,
      AUTH_AUDIENCES.CUSTOMER,
      false,
      request,
      response,
    );
    await this.events.loginAttempt({
      audience: 'CUSTOMER',
      identifier,
      result: 'SUCCESS',
      request,
      userId,
    });
    await this.events.audit({
      audience: 'CUSTOMER',
      action: 'auth.customer.google.login',
      outcome: 'SUCCESS',
      request,
      userId,
      sessionId: session.sessionId,
    });
  }

  private assertOperationalCustomer(
    user: { audience: string; status: string },
    suspendedAt: Date | null,
    returnTo: string,
  ): void {
    if (user.audience !== 'CUSTOMER' || user.status !== 'ACTIVE' || suspendedAt) {
      throw new GoogleOAuthFlowError('account_unavailable', returnTo);
    }
  }

  private providerSubjectHash(subject: string): string {
    return this.crypto.hashToken(`google:${subject}`);
  }

  private async auditFailure(request: Request, errorCode: string): Promise<void> {
    await this.events.audit({
      audience: 'CUSTOMER',
      action: 'auth.customer.google.login',
      outcome: 'DENIED',
      request,
      errorCode,
    });
  }

  private isUniqueConstraint(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private notConfigured(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'GOOGLE_AUTH_NOT_CONFIGURED',
      message: 'Google sign-in is not configured.',
    });
  }
}
