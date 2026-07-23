import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  AUTH_AUDIENCES,
  type AuthAudience,
  cookieNames,
  csrfCookieOptions,
  sessionCookieOptions,
} from '../common/auth/auth.constants';
import type { AuthContext } from '../common/auth/auth-context';
import { CryptoService } from '../common/security/crypto.service';
import { isIpAllowed, jsonIpRules } from '../common/security/ip-allowlist';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import type {
  AdminUserResponse,
  CustomerUserResponse,
  SessionResponse,
} from './auth-response.types';
import { AuthEventService } from './auth-event.service';

const USER_AUTHORIZATION_INCLUDE = {
  adminProfile: true,
  customerProfile: true,
  twoFactorSecret: true,
  roles: {
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  },
} as const;

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Environment, true>,
    private readonly events: AuthEventService,
  ) {}

  async issue(
    userId: string,
    audience: AuthAudience,
    twoFactorVerified: boolean,
    request: Request,
    response: Response,
  ): Promise<{
    sessionId: string;
    expiresAt: Date;
    authenticatedAt: Date;
    csrfToken: string;
  }> {
    const now = new Date();
    const admin = audience === AUTH_AUDIENCES.ADMIN;
    const idleMinutes = this.config.get(
      admin ? 'ADMIN_SESSION_IDLE_MINUTES' : 'CUSTOMER_SESSION_IDLE_MINUTES',
      { infer: true },
    );
    const absoluteMinutes = this.config.get(
      admin ? 'ADMIN_SESSION_ABSOLUTE_MINUTES' : 'CUSTOMER_SESSION_ABSOLUTE_MINUTES',
      { infer: true },
    );
    const absoluteMilliseconds = absoluteMinutes * 60_000;
    const idleExpiresAt = new Date(now.getTime() + idleMinutes * 60_000);
    const absoluteExpiresAt = new Date(now.getTime() + absoluteMilliseconds);
    const token = this.crypto.randomToken();
    const csrfToken = this.crypto.randomToken();

    const createdSession = await this.prisma.session.create({
      data: {
        userId,
        audience,
        tokenHash: this.crypto.hashToken(token),
        csrfTokenHash: this.crypto.hashToken(csrfToken),
        status: 'ACTIVE',
        ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
        ...(request.get('user-agent')
          ? { userAgent: request.get('user-agent')!.slice(0, 512) }
          : {}),
        authenticatedAt: now,
        lastSeenAt: now,
        idleExpiresAt,
        absoluteExpiresAt,
        twoFactorVerified,
      },
    });

    const production = this.config.get('NODE_ENV', { infer: true }) === 'production';
    const names = cookieNames(production);
    const sessionName = admin ? names.adminSession : names.customerSession;
    const csrfName = admin ? names.adminCsrf : names.customerCsrf;
    const maxAge = Math.min(idleExpiresAt.getTime(), absoluteExpiresAt.getTime()) - now.getTime();
    response.cookie(sessionName, token, sessionCookieOptions(production, maxAge));
    response.cookie(csrfName, csrfToken, csrfCookieOptions(production, maxAge));
    return {
      sessionId: createdSession.id,
      expiresAt: idleExpiresAt,
      authenticatedAt: now,
      csrfToken,
    };
  }

  async resolve(request: Request, audience: AuthAudience): Promise<AuthContext> {
    const production = this.config.get('NODE_ENV', { infer: true }) === 'production';
    const names = cookieNames(production);
    const cookieName =
      audience === AUTH_AUDIENCES.ADMIN ? names.adminSession : names.customerSession;
    const token = this.readCookie(request, cookieName);
    if (!token) throw this.unauthorized();

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.crypto.hashToken(token) },
      include: { user: { include: USER_AUTHORIZATION_INCLUDE } },
    });
    const now = new Date();
    if (
      !session ||
      session.status !== 'ACTIVE' ||
      session.audience !== audience ||
      session.user.audience !== audience ||
      session.user.status !== 'ACTIVE' ||
      session.idleExpiresAt <= now ||
      session.absoluteExpiresAt <= now ||
      session.revokedAt
    ) {
      if (session?.status === 'ACTIVE') {
        await this.prisma.session.updateMany({
          where: { id: session.id, status: 'ACTIVE' },
          data: { status: 'EXPIRED', revokedAt: now, revokedReason: 'expired_or_invalid' },
        });
      }
      throw this.unauthorized();
    }

    if (
      audience === AUTH_AUDIENCES.CUSTOMER &&
      (!session.user.customerProfile || session.user.customerProfile.suspendedAt)
    ) {
      throw this.unauthorized();
    }
    if (
      audience === AUTH_AUDIENCES.ADMIN &&
      (!session.user.adminProfile ||
        session.user.adminProfile.suspendedAt ||
        session.user.adminProfile.mustEnrollTwoFactor ||
        !session.user.twoFactorSecret?.verifiedAt ||
        !session.twoFactorVerified)
    ) {
      throw this.unauthorized();
    }
    if (audience === AUTH_AUDIENCES.ADMIN && session.user.adminProfile) {
      const requestIp = request.ip ?? request.socket.remoteAddress ?? 'unknown';
      const environmentRules =
        this.config
          .get('ADMIN_IP_ALLOWLIST', { infer: true })
          ?.split(',')
          .map((value) => value.trim())
          .filter(Boolean) ?? [];
      if (
        !isIpAllowed(requestIp, environmentRules) ||
        !isIpAllowed(requestIp, jsonIpRules(session.user.adminProfile.allowedIpCidrs))
      ) {
        throw this.unauthorized();
      }
    }

    const permissions = [
      ...new Set(
        session.user.roles.flatMap(({ role }) =>
          role.permissions.map(({ permission }) => permission.key),
        ),
      ),
    ];
    const roleKeys = session.user.roles.map(({ role }) => role.key);
    const context: AuthContext = {
      sessionId: session.id,
      userId: session.userId,
      audience,
      permissions,
      roleKeys,
      twoFactorVerified: session.twoFactorVerified,
      authenticatedAt: session.authenticatedAt,
      expiresAt:
        session.idleExpiresAt < session.absoluteExpiresAt
          ? session.idleExpiresAt
          : session.absoluteExpiresAt,
      csrfTokenHash: session.csrfTokenHash ?? '',
    };

    if (now.getTime() - session.lastSeenAt.getTime() >= 5 * 60_000) {
      const idleMinutes = this.config.get(
        audience === AUTH_AUDIENCES.ADMIN
          ? 'ADMIN_SESSION_IDLE_MINUTES'
          : 'CUSTOMER_SESSION_IDLE_MINUTES',
        { infer: true },
      );
      const candidate = new Date(now.getTime() + idleMinutes * 60_000);
      await this.prisma.session.updateMany({
        where: { id: session.id, status: 'ACTIVE', lastSeenAt: session.lastSeenAt },
        data: {
          lastSeenAt: now,
          idleExpiresAt:
            candidate < session.absoluteExpiresAt ? candidate : session.absoluteExpiresAt,
        },
      });
    }

    return context;
  }

  async revoke(request: Request, response: Response, audience: AuthAudience): Promise<void> {
    const production = this.config.get('NODE_ENV', { infer: true }) === 'production';
    const names = cookieNames(production);
    const sessionName =
      audience === AUTH_AUDIENCES.ADMIN ? names.adminSession : names.customerSession;
    const csrfName = audience === AUTH_AUDIENCES.ADMIN ? names.adminCsrf : names.customerCsrf;
    const token = this.readCookie(request, sessionName);
    if (token) {
      await this.prisma.session.updateMany({
        where: { tokenHash: this.crypto.hashToken(token), audience, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedReason: 'user_logout',
        },
      });
    }
    if (request.auth) {
      await this.events.audit({
        audience,
        action: audience === AUTH_AUDIENCES.ADMIN ? 'auth.admin.logout' : 'auth.customer.logout',
        outcome: 'SUCCESS',
        request,
        userId: request.auth.userId,
        sessionId: request.auth.sessionId,
      });
    }
    response.clearCookie(sessionName, { path: '/', secure: production, sameSite: 'lax' });
    response.clearCookie(csrfName, { path: '/', secure: production, sameSite: 'lax' });
  }

  async list(userId: string, audience: AuthAudience, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: {
        userId,
        audience,
        status: 'ACTIVE',
        revokedAt: null,
        absoluteExpiresAt: { gt: new Date() },
      },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        authenticatedAt: true,
        lastSeenAt: true,
        idleExpiresAt: true,
        absoluteExpiresAt: true,
        ipAddress: true,
        userAgent: true,
        twoFactorVerified: true,
      },
    });
    return {
      data: sessions.map((session) => ({
        ...session,
        current: session.id === currentSessionId,
        createdAt: session.createdAt.toISOString(),
        authenticatedAt: session.authenticatedAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        idleExpiresAt: session.idleExpiresAt.toISOString(),
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      })),
    };
  }

  async revokeById(
    userId: string,
    audience: AuthAudience,
    sessionId: string,
    request: Request,
    response: Response,
  ): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId, audience, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'user_revoked_session' },
    });
    if (request.auth?.sessionId === sessionId) {
      this.clearRealmCookies(response, audience);
    }
  }

  async revokeAll(userId: string, audience: AuthAudience, response: Response): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, audience, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'user_revoked_all' },
    });
    this.clearRealmCookies(response, audience);
  }

  async customerResponse(
    userId: string,
    expiresAt: Date,
  ): Promise<SessionResponse<CustomerUserResponse>> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, audience: 'CUSTOMER', status: 'ACTIVE' },
      include: { customerProfile: true },
    });
    if (!user?.customerProfile) throw this.unauthorized();
    return {
      data: {
        user: {
          id: user.id,
          email: user.email,
          phone: user.customerProfile.phoneE164,
          fullName: [user.customerProfile.firstName, user.customerProfile.lastName]
            .filter(Boolean)
            .join(' '),
          emailVerified: Boolean(user.emailVerifiedAt),
        },
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  async adminResponse(
    userId: string,
    expiresAt: Date,
    authenticatedAt: Date,
  ): Promise<SessionResponse<AdminUserResponse>> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, audience: 'ADMIN', status: 'ACTIVE' },
      include: USER_AUTHORIZATION_INCLUDE,
    });
    if (!user?.adminProfile) throw this.unauthorized();
    const roles = user.roles.map(({ role }) => role.name);
    const permissions = [
      ...new Set(
        user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)),
      ),
    ];
    return {
      data: {
        user: {
          id: user.id,
          email: user.email ?? '',
          name: user.adminProfile.displayName,
          roles,
          permissions,
          requiresRecentAuthentication: Date.now() - authenticatedAt.getTime() > 10 * 60_000,
        },
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  private readCookie(request: Request, name: string): string | undefined {
    const value = (request.cookies as Record<string, unknown> | undefined)?.[name];
    return typeof value === 'string' && value.length <= 512 ? value : undefined;
  }

  private clearRealmCookies(response: Response, audience: AuthAudience): void {
    const production = this.config.get('NODE_ENV', { infer: true }) === 'production';
    const names = cookieNames(production);
    const sessionName =
      audience === AUTH_AUDIENCES.ADMIN ? names.adminSession : names.customerSession;
    const csrfName = audience === AUTH_AUDIENCES.ADMIN ? names.adminCsrf : names.customerCsrf;
    response.clearCookie(sessionName, { path: '/', secure: production, sameSite: 'lax' });
    response.clearCookie(csrfName, { path: '/', secure: production, sameSite: 'lax' });
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required.',
    });
  }
}
