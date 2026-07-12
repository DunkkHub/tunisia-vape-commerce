import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import argon2, { argon2id } from 'argon2';
import type { Request, Response } from 'express';
import { OTP } from 'otplib';
import { z } from 'zod';
import { RedisService } from '../cache/redis.service';
import { AUTH_AUDIENCES } from '../common/auth/auth.constants';
import { CryptoService } from '../common/security/crypto.service';
import { isIpAllowed, jsonIpRules } from '../common/security/ip-allowlist';
import { PrismaService } from '../database/prisma.service';
import type { Environment } from '../config/environment';
import type { AdminUserResponse, SessionResponse } from './auth-response.types';
import { AuthEventService } from './auth-event.service';
import type { AdminLoginDto, AdminTotpDto } from './dto/admin-auth.dto';
import { DistributedAuthThrottleService } from './distributed-auth-throttle.service';
import { SessionService } from './session.service';

const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 3,
  parallelism: 1,
} as const;
const DUMMY_PASSWORD_HASH = argon2.hash('not-a-real-administrator-password', ARGON2_OPTIONS);
const otp = new OTP({ strategy: 'totp' });
const challengeSchema = z.object({
  userId: z.string().min(1),
  mode: z.enum(['TOTP', 'ENROLLMENT']),
  ipHash: z.string().length(64),
  issuedAt: z.number().int(),
});
type Challenge = z.infer<typeof challengeSchema>;

export type AdminLoginResponse = {
  data:
    | { state: 'TOTP_REQUIRED'; challengeId: string }
    | {
        state: 'ENROLLMENT_REQUIRED';
        challengeId: string;
        enrollmentUri: string;
        manualEntryKey: string;
      };
};

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly throttle: DistributedAuthThrottleService,
    private readonly events: AuthEventService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async beginLogin(input: AdminLoginDto, request: Request): Promise<AdminLoginResponse> {
    await this.throttle.consume('admin-login', input.email, request, 3, 60);
    const emailNormalized = input.email.trim().toLocaleLowerCase('en-US');
    const user = await this.prisma.user.findFirst({
      where: { audience: 'ADMIN', emailNormalized },
      include: { adminProfile: true, twoFactorSecret: true },
    });
    const passwordHash = user?.passwordHash ?? (await DUMMY_PASSWORD_HASH);
    const passwordValid = await argon2.verify(passwordHash, input.password);
    const locked = Boolean(user?.lockedUntil && user.lockedUntil > new Date());
    if (
      !user ||
      !passwordValid ||
      locked ||
      user.status !== 'ACTIVE' ||
      !user.adminProfile ||
      user.adminProfile.suspendedAt
    ) {
      if (user && !locked) {
        const failed = await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: { increment: 1 } },
          select: { failedLoginCount: true },
        });
        if (failed.failedLoginCount >= 3) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: {
              lockedUntil: new Date(
                Date.now() + Math.min(failed.failedLoginCount - 2, 12) * 5 * 60_000,
              ),
            },
          });
        }
      }
      await this.events.loginAttempt({
        audience: 'ADMIN',
        identifier: emailNormalized,
        result: locked
          ? 'LOCKED'
          : user?.adminProfile?.suspendedAt
            ? 'SUSPENDED'
            : 'INVALID_CREDENTIALS',
        request,
        ...(user ? { userId: user.id } : {}),
      });
      throw this.invalidCredentials();
    }

    const requestIp = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    this.enforceIpAllowlist(requestIp, user.adminProfile.allowedIpCidrs);
    await this.ensureRedis();
    const enrollmentRequired =
      user.adminProfile.mustEnrollTwoFactor || !user.twoFactorSecret?.verifiedAt;
    let enrollmentSecret: string | undefined;
    if (enrollmentRequired) {
      enrollmentSecret = otp.generateSecret();
      await this.prisma.twoFactorSecret.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          encryptedSecret: this.crypto.encrypt(enrollmentSecret),
          encryptionKeyId: 'env-v1',
        },
        update: {
          encryptedSecret: this.crypto.encrypt(enrollmentSecret),
          encryptionKeyId: 'env-v1',
          verifiedAt: null,
          lastUsedStep: null,
        },
      });
    }

    const challengeId = this.crypto.randomToken();
    const challenge: Challenge = {
      userId: user.id,
      mode: enrollmentRequired ? 'ENROLLMENT' : 'TOTP',
      ipHash: this.crypto.hashToken(requestIp),
      issuedAt: Date.now(),
    };
    await this.redis.client.set(
      this.challengeKey(challengeId),
      JSON.stringify(challenge),
      'EX',
      this.config.get('ADMIN_PREAUTH_TTL_MINUTES', { infer: true }) * 60,
      'NX',
    );
    await this.events.loginAttempt({
      audience: 'ADMIN',
      identifier: emailNormalized,
      result: 'TWO_FACTOR_REQUIRED',
      request,
      userId: user.id,
    });

    if (enrollmentRequired && enrollmentSecret) {
      return {
        data: {
          state: 'ENROLLMENT_REQUIRED',
          challengeId,
          enrollmentUri: otp.generateURI({
            issuer: 'Tunisia Vape Store',
            label: user.email ?? user.id,
            secret: enrollmentSecret,
          }),
          manualEntryKey: enrollmentSecret,
        },
      };
    }
    return { data: { state: 'TOTP_REQUIRED', challengeId } };
  }

  async completeTotp(
    input: AdminTotpDto,
    request: Request,
    response: Response,
  ): Promise<SessionResponse<AdminUserResponse>> {
    await this.ensureRedis();
    const key = this.challengeKey(input.challengeId);
    const lockKey = `${key}:lock`;
    const lockToken = this.crypto.randomToken(16);
    const acquired = await this.redis.client.set(lockKey, lockToken, 'EX', 15, 'NX');
    if (acquired !== 'OK') throw this.invalidChallenge();
    try {
      const serialized = await this.redis.client.get(key);
      let rawChallenge: unknown = null;
      if (serialized) {
        try {
          rawChallenge = JSON.parse(serialized) as unknown;
        } catch {
          await this.redis.client.del(key);
        }
      }
      const parsed = challengeSchema.safeParse(rawChallenge);
      const requestIp = request.ip ?? request.socket.remoteAddress ?? 'unknown';
      if (
        !parsed.success ||
        !this.crypto.tokenMatches(requestIp, parsed.data.ipHash) ||
        Date.now() - parsed.data.issuedAt >
          this.config.get('ADMIN_PREAUTH_TTL_MINUTES', { infer: true }) * 60_000
      ) {
        throw this.invalidChallenge();
      }
      const challenge = parsed.data;
      const user = await this.prisma.user.findFirst({
        where: { id: challenge.userId, audience: 'ADMIN', status: 'ACTIVE' },
        include: { adminProfile: true, twoFactorSecret: true },
      });
      if (!user?.adminProfile || user.adminProfile.suspendedAt || !user.twoFactorSecret) {
        await this.redis.client.del(key);
        throw this.invalidChallenge();
      }

      const secret = this.crypto.decrypt(user.twoFactorSecret.encryptedSecret);
      const verification = await otp.verify({
        secret,
        token: input.code,
        epochTolerance: 30,
        ...(user.twoFactorSecret.lastUsedStep === null
          ? {}
          : { afterTimeStep: Number(user.twoFactorSecret.lastUsedStep) }),
      });
      if (!verification.valid) {
        const attemptsKey = `${key}:attempts`;
        const attempts = await this.redis.client.incr(attemptsKey);
        await this.redis.client.expire(attemptsKey, 300);
        if (attempts >= 5) await this.redis.client.del(key, attemptsKey);
        await this.events.loginAttempt({
          audience: 'ADMIN',
          identifier: user.emailNormalized ?? user.id,
          result: 'TWO_FACTOR_FAILED',
          request,
          userId: user.id,
        });
        throw this.invalidCode();
      }

      const verifiedAt = new Date();
      const verifiedTimeStep =
        'timeStep' in verification && typeof verification.timeStep === 'number'
          ? verification.timeStep
          : Math.floor(Date.now() / 30_000);
      const twoFactorEnforcedAt = user.adminProfile.twoFactorEnforcedAt ?? verifiedAt;
      await this.prisma.$transaction(async (transaction) => {
        const advanced = await transaction.twoFactorSecret.updateMany({
          where: {
            userId: user.id,
            OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(verifiedTimeStep) } }],
          },
          data: { verifiedAt, lastUsedStep: BigInt(verifiedTimeStep) },
        });
        if (advanced.count !== 1) throw this.invalidCode();
        await transaction.adminProfile.update({
          where: { userId: user.id },
          data: {
            mustEnrollTwoFactor: false,
            twoFactorEnforcedAt,
            lastStepUpAt: verifiedAt,
          },
        });
        await transaction.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: verifiedAt },
        });
      });
      await this.redis.client.del(key, `${key}:attempts`);

      const session = await this.sessions.issue(
        user.id,
        AUTH_AUDIENCES.ADMIN,
        true,
        request,
        response,
      );
      await this.events.loginAttempt({
        audience: 'ADMIN',
        identifier: user.emailNormalized ?? user.id,
        result: 'SUCCESS',
        request,
        userId: user.id,
      });
      await this.events.audit({
        audience: 'ADMIN',
        action: 'auth.admin.login',
        outcome: 'SUCCESS',
        request,
        userId: user.id,
        sessionId: session.sessionId,
      });
      return this.sessions.adminResponse(user.id, session.expiresAt, session.authenticatedAt);
    } finally {
      await this.releaseLock(lockKey, lockToken);
    }
  }

  private async ensureRedis(): Promise<void> {
    try {
      await this.redis.connect();
      await this.redis.client.ping();
    } catch {
      throw new ServiceUnavailableException({
        code: 'AUTHENTICATION_DEPENDENCY_UNAVAILABLE',
        message: 'Administrator authentication is temporarily unavailable.',
      });
    }
  }

  private enforceIpAllowlist(ipAddress: string, profileRules: unknown): void {
    const environmentRules =
      process.env.ADMIN_IP_ALLOWLIST?.split(',')
        .map((value) => value.trim())
        .filter(Boolean) ?? [];
    const restricted =
      !isIpAllowed(ipAddress, environmentRules) ||
      !isIpAllowed(ipAddress, jsonIpRules(profileRules));
    if (restricted) {
      throw new ForbiddenException({
        code: 'ADMIN_NETWORK_RESTRICTED',
        message: 'Administrator access is not permitted from this network.',
      });
    }
  }

  private challengeKey(challengeId: string): string {
    return `auth:admin:challenge:${this.crypto.hashToken(challengeId)}`;
  }

  private async releaseLock(key: string, token: string): Promise<void> {
    await this.redis.client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token,
    );
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'The email or password is incorrect.',
    });
  }

  private invalidChallenge(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_AUTH_CHALLENGE',
      message: 'The authentication challenge is invalid or expired.',
    });
  }

  private invalidCode(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_TOTP',
      message: 'The verification code is invalid or expired.',
    });
  }
}
