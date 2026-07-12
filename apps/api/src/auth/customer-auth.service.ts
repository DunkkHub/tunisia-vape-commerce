import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import argon2, { argon2id } from 'argon2';
import type { Request, Response } from 'express';
import { AUTH_AUDIENCES } from '../common/auth/auth.constants';
import { CryptoService } from '../common/security/crypto.service';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import type { SessionResponse, CustomerUserResponse } from './auth-response.types';
import { AuthEventService } from './auth-event.service';
import { DistributedAuthThrottleService } from './distributed-auth-throttle.service';
import type {
  CustomerLoginDto,
  CustomerRegistrationDto,
  PasswordResetCompleteDto,
  PasswordResetRequestDto,
} from './dto/customer-auth.dto';
import { SessionService } from './session.service';

const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const DUMMY_PASSWORD_HASH = argon2.hash('not-a-real-account-password', ARGON2_OPTIONS);

const normalizeEmail = (email: string): string => email.trim().toLocaleLowerCase('en-US');
const normalizePhone = (phone: string): string => {
  const compact = phone.replace(/[\s().-]/g, '').replace(/^00216/, '+216');
  return compact.startsWith('+216') ? compact : `+216${compact}`;
};

@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly crypto: CryptoService,
    private readonly throttle: DistributedAuthThrottleService,
    private readonly events: AuthEventService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async register(
    input: CustomerRegistrationDto,
    request: Request,
    response: Response,
  ): Promise<SessionResponse<CustomerUserResponse>> {
    await this.throttle.consume('customer-registration', input.email, request, 3, 15 * 60);
    if (!input.adultConfirmed || !input.termsAccepted) {
      throw new BadRequestException({
        code: 'CONSENT_REQUIRED',
        message: 'Age confirmation and acceptance of the terms are required.',
      });
    }
    const minimumAge = this.config.get('MINIMUM_PURCHASE_AGE', { infer: true });
    if (minimumAge < 18) {
      throw new BadRequestException({
        code: 'AGE_POLICY_NOT_CONFIGURED',
        message: 'Registration is temporarily unavailable.',
      });
    }

    const emailNormalized = normalizeEmail(input.email);
    const phoneE164 = normalizePhone(input.phone);
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ emailNormalized }, { customerProfile: { is: { phoneE164 } } }],
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'ACCOUNT_ALREADY_EXISTS',
        message: 'An account with these details already exists.',
      });
    }

    const [firstName = input.fullName.trim(), ...remainingName] = input.fullName
      .trim()
      .split(/\s+/);
    const lastName = remainingName.join(' ');
    const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
    const consentedAt = new Date();
    const ipAddress = (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45);
    const userAgent = request.get('user-agent')?.slice(0, 512);
    const termsVersion = await this.prisma.legalDocumentVersion.findFirst({
      where: {
        status: 'PUBLISHED',
        publishedAt: { lte: consentedAt },
        legalDocument: {
          is: { type: 'TERMS_AND_CONDITIONS', locale: input.locale },
        },
      },
      orderBy: [{ version: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    let userId: string;
    try {
      const user = await this.prisma.user.create({
        data: {
          audience: 'CUSTOMER',
          email: input.email.trim(),
          emailNormalized,
          passwordHash,
          status: 'ACTIVE',
          customerProfile: {
            create: {
              firstName,
              lastName,
              phoneE164,
              phoneSearch: phoneE164.replace(/\D/g, ''),
              locale: input.locale,
              marketingConsent: false,
              consentRecords: {
                create: [
                  {
                    type: 'AGE_GATE',
                    granted: true,
                    consentedAt,
                    ipAddress,
                    ...(userAgent ? { userAgent } : {}),
                    locale: input.locale,
                    source: 'customer_registration',
                  },
                  {
                    type: 'TERMS',
                    granted: true,
                    consentedAt,
                    ...(termsVersion ? { legalDocumentVersionId: termsVersion.id } : {}),
                    ipAddress,
                    ...(userAgent ? { userAgent } : {}),
                    locale: input.locale,
                    source: 'customer_registration',
                  },
                ],
              },
              ageVerificationEvents: {
                create: {
                  phase: 'STORE_ENTRY',
                  result: 'PASSED',
                  minimumAge,
                  method: 'self_declaration',
                  ipAddress,
                  ...(userAgent ? { userAgent } : {}),
                  metadata: { source: 'customer_registration' },
                },
              },
            },
          },
        },
        select: { id: true },
      });
      userId = user.id;
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        throw new ConflictException({
          code: 'ACCOUNT_ALREADY_EXISTS',
          message: 'An account with these details already exists.',
        });
      }
      throw error;
    }

    const session = await this.sessions.issue(
      userId,
      AUTH_AUDIENCES.CUSTOMER,
      false,
      request,
      response,
    );
    await this.events.audit({
      audience: 'CUSTOMER',
      action: 'auth.customer.register',
      outcome: 'SUCCESS',
      request,
      userId,
      sessionId: session.sessionId,
    });
    return this.sessions.customerResponse(userId, session.expiresAt);
  }

  async login(
    input: CustomerLoginDto,
    request: Request,
    response: Response,
  ): Promise<SessionResponse<CustomerUserResponse>> {
    await this.throttle.consume('customer-login', input.emailOrPhone, request, 5, 60);
    const identifier = input.emailOrPhone.trim();
    const emailNormalized = normalizeEmail(identifier);
    const phoneE164 = /^\+?(?:216)?\d+$/.test(identifier.replace(/[\s().-]/g, ''))
      ? normalizePhone(identifier)
      : '__not_a_phone__';
    const user = await this.prisma.user.findFirst({
      where: {
        audience: 'CUSTOMER',
        OR: [{ emailNormalized }, { customerProfile: { is: { phoneE164 } } }],
      },
      include: { customerProfile: true },
    });

    const passwordHash = user?.passwordHash ?? (await DUMMY_PASSWORD_HASH);
    const passwordValid = await argon2.verify(passwordHash, input.password);
    const locked = Boolean(user?.lockedUntil && user.lockedUntil > new Date());
    if (
      !user ||
      !passwordValid ||
      locked ||
      user.status !== 'ACTIVE' ||
      !user.customerProfile ||
      user.customerProfile.suspendedAt
    ) {
      if (user && !locked) {
        const failed = await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: { increment: 1 } },
          select: { failedLoginCount: true },
        });
        if (failed.failedLoginCount >= 5) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: {
              lockedUntil: new Date(
                Date.now() + Math.min(failed.failedLoginCount - 4, 6) * 5 * 60_000,
              ),
            },
          });
        }
      }
      await this.events.loginAttempt({
        audience: 'CUSTOMER',
        identifier,
        result: locked
          ? 'LOCKED'
          : user?.customerProfile?.suspendedAt
            ? 'SUSPENDED'
            : 'INVALID_CREDENTIALS',
        request,
        ...(user ? { userId: user.id } : {}),
      });
      throw this.invalidCredentials();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const session = await this.sessions.issue(
      user.id,
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
      userId: user.id,
    });
    await this.events.audit({
      audience: 'CUSTOMER',
      action: 'auth.customer.login',
      outcome: 'SUCCESS',
      request,
      userId: user.id,
    });
    return this.sessions.customerResponse(user.id, session.expiresAt);
  }

  async requestPasswordReset(input: PasswordResetRequestDto, request: Request): Promise<void> {
    await this.throttle.consume('customer-password-reset', input.email, request, 3, 15 * 60);
    const user = await this.prisma.user.findFirst({
      where: {
        audience: 'CUSTOMER',
        emailNormalized: normalizeEmail(input.email),
        status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] },
      },
      select: { id: true, emailNormalized: true, customerProfile: { select: { locale: true } } },
    });
    if (!user) {
      await DUMMY_PASSWORD_HASH;
      return;
    }

    const token = this.crypto.randomToken();
    const tokenHash = this.crypto.hashToken(token);
    const now = new Date();
    const recipient = user.emailNormalized ?? normalizeEmail(input.email);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          audience: 'CUSTOMER',
          tokenHash,
          requestedIp: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
          expiresAt: new Date(now.getTime() + 30 * 60_000),
        },
      }),
      this.prisma.notification.create({
        data: {
          idempotencyKey: `password-reset:${user.id}:${tokenHash.slice(0, 20)}`,
          event: 'PASSWORD_RESET',
          channel: 'EMAIL',
          recipientHash: this.crypto.hashToken(recipient),
          encryptedRecipient: this.crypto.encrypt(recipient),
          locale: user.customerProfile?.locale ?? 'fr',
          payload: {
            encryptedResetToken: this.crypto.encrypt(token),
            expiresInMinutes: 30,
          },
          status: 'QUEUED',
        },
      }),
    ]);
  }

  async completePasswordReset(input: PasswordResetCompleteDto, request: Request): Promise<void> {
    await this.throttle.consume(
      'customer-password-reset-confirm',
      input.token.slice(0, 32),
      request,
      5,
      15 * 60,
    );
    const tokenHash = this.crypto.hashToken(input.token);
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { customerProfile: true } } },
    });
    const now = new Date();
    if (
      !token ||
      token.audience !== 'CUSTOMER' ||
      token.consumedAt ||
      token.expiresAt <= now ||
      token.user.audience !== 'CUSTOMER' ||
      token.user.status !== 'ACTIVE' ||
      !token.user.customerProfile ||
      token.user.customerProfile.suspendedAt
    ) {
      throw this.invalidResetToken();
    }

    const passwordHash = await argon2.hash(input.newPassword, ARGON2_OPTIONS);
    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.passwordResetToken.updateMany({
        where: { id: token.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw this.invalidResetToken();
      await transaction.user.update({
        where: { id: token.userId },
        data: {
          passwordHash,
          passwordChangedAt: now,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await transaction.session.updateMany({
        where: { userId: token.userId, audience: 'CUSTOMER', status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokedReason: 'password_reset',
        },
      });
    });
    await this.events.audit({
      audience: 'CUSTOMER',
      action: 'auth.customer.password_reset',
      outcome: 'SUCCESS',
      request,
      userId: token.userId,
    });
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'The email, phone number, or password is incorrect.',
    });
  }

  private invalidResetToken(): BadRequestException {
    return new BadRequestException({
      code: 'INVALID_OR_EXPIRED_RESET_TOKEN',
      message: 'The password reset link is invalid or expired.',
    });
  }

  private isUniqueConstraint(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }
}
