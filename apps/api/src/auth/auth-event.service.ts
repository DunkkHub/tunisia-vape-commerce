import { Injectable } from '@nestjs/common';
import type { AuthAudience, LoginAttemptResult } from '@prisma/client';
import type { Request } from 'express';
import { CryptoService } from '../common/security/crypto.service';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AuthEventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async loginAttempt(input: {
    audience: AuthAudience;
    identifier: string;
    result: LoginAttemptResult;
    request: Request;
    userId?: string;
  }): Promise<void> {
    const userAgent = input.request.get('user-agent');
    await this.prisma.loginAttempt.create({
      data: {
        audience: input.audience,
        identifierHash: this.crypto.hashToken(input.identifier.trim().toLocaleLowerCase('en-US')),
        result: input.result,
        ...(input.userId ? { userId: input.userId } : {}),
        ipAddress: (input.request.ip ?? input.request.socket.remoteAddress ?? 'unknown').slice(
          0,
          45,
        ),
        ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
      },
    });
  }

  async audit(input: {
    audience: AuthAudience;
    action: string;
    outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
    request: Request;
    userId?: string;
    sessionId?: string;
    errorCode?: string;
  }): Promise<void> {
    const userAgent = input.request.get('user-agent');
    await this.prisma.auditLog.create({
      data: {
        ...(input.userId ? { actorUserId: input.userId } : {}),
        actorType: input.audience,
        action: input.action,
        resourceType: input.sessionId ? 'Session' : 'Authentication',
        ...(input.sessionId ? { resourceId: input.sessionId } : {}),
        outcome: input.outcome,
        requestId: input.request.requestId,
        ipAddress: (input.request.ip ?? input.request.socket.remoteAddress ?? 'unknown').slice(
          0,
          45,
        ),
        ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      },
    });
  }
}
