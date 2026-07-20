import { Injectable } from '@nestjs/common';
import { NotificationEvent, type AuthAudience, type LoginAttemptResult } from '@prisma/client';
import type { Request } from 'express';
import { createOperationalAlertWithOutbox } from '../common/outbox/operational-alerts';
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
    const identifierHash = this.crypto.hashToken(
      input.identifier.trim().toLocaleLowerCase('en-US'),
    );
    const occurredAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.loginAttempt.create({
        data: {
          audience: input.audience,
          identifierHash,
          result: input.result,
          ...(input.userId ? { userId: input.userId } : {}),
          ipAddress: (input.request.ip ?? input.request.socket.remoteAddress ?? 'unknown').slice(
            0,
            45,
          ),
          ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
          occurredAt,
        },
      });
      if (
        input.audience === 'ADMIN' &&
        (input.result === 'LOCKED' || input.result === 'SUSPENDED')
      ) {
        const alertCode =
          input.result === 'LOCKED' ? 'ADMIN_LOGIN_LOCKED' : 'ADMIN_LOGIN_SUSPENDED';
        const hourBucket = occurredAt.toISOString().slice(0, 13);
        await createOperationalAlertWithOutbox(transaction, this.crypto, {
          kind: 'security',
          event: NotificationEvent.SECURITY_ALERT,
          idempotencyKey: `security-alert:${alertCode}:${identifierHash}:${hourBucket}`,
          payload: { alertCode, occurredAt: occurredAt.toISOString() },
          scheduledAt: occurredAt,
        });
      }
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
