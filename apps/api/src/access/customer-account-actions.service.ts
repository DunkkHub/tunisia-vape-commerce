import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type HttpException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { SUPER_ADMINISTRATOR_ROLE_KEY } from '../auth/guards/super-administrator.guard';
import { PrismaService } from '../database/prisma.service';
import type { AccountLifecycleDto, DisableCustomerAccountDto } from './dto/admin-account.dto';

const CUSTOMER_ACCOUNT_INCLUDE = {
  user: { select: { id: true, email: true, audience: true, status: true, version: true } },
} as const;

type CustomerAccount = Prisma.CustomerProfileGetPayload<{
  include: typeof CUSTOMER_ACCOUNT_INCLUDE;
}>;

const responseCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || !('getResponse' in error)) return undefined;
  const response = (error as HttpException).getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? String(response.code)
    : undefined;
};

@Injectable()
export class CustomerAccountActionsService {
  constructor(private readonly prisma: PrismaService) {}

  suspend(id: string, input: AccountLifecycleDto, actorUserId: string, request: Request) {
    return this.lifecycle('suspend', id, input, actorUserId, request);
  }

  reactivate(id: string, input: AccountLifecycleDto, actorUserId: string, request: Request) {
    return this.lifecycle('reactivate', id, input, actorUserId, request);
  }

  disable(id: string, input: DisableCustomerAccountDto, actorUserId: string, request: Request) {
    return this.lifecycle('disable', id, input, actorUserId, request);
  }

  private async lifecycle(
    action: 'suspend' | 'reactivate' | 'disable',
    id: string,
    input: AccountLifecycleDto | DisableCustomerAccountDto,
    actorUserId: string,
    request: Request,
  ) {
    try {
      const record = await this.prisma.$transaction(async (transaction) => {
        await this.lockAndRequireActor(transaction, actorUserId);
        const target = await transaction.customerProfile.findFirst({
          where: { id, user: { is: { audience: 'CUSTOMER' } } },
          include: CUSTOMER_ACCOUNT_INCLUDE,
        });
        if (!target) throw this.notFound();
        this.assertVersions(target, input);

        const now = new Date();
        const reason = input.reason.trim();
        if (action === 'suspend') {
          if (target.user.status !== 'ACTIVE' || target.suspendedAt) {
            throw this.stateConflict('CUSTOMER_ACCOUNT_NOT_ACTIVE');
          }
          await this.updateLifecycleVersions(transaction, target, input, {
            user: { status: 'SUSPENDED', version: { increment: 1 } },
            profile: {
              suspendedAt: now,
              suspensionReason: reason,
              version: { increment: 1 },
            },
          });
          await this.revokeCustomerAccess(transaction, target.user.id, 'customer_suspended', now);
        } else if (action === 'reactivate') {
          if (target.user.status !== 'SUSPENDED' || !target.suspendedAt) {
            throw this.stateConflict('CUSTOMER_ACCOUNT_NOT_SUSPENDED');
          }
          await this.updateLifecycleVersions(transaction, target, input, {
            user: {
              status: 'ACTIVE',
              failedLoginCount: 0,
              lockedUntil: null,
              version: { increment: 1 },
            },
            profile: {
              suspendedAt: null,
              suspensionReason: null,
              version: { increment: 1 },
            },
          });
        } else {
          if (target.user.status !== 'SUSPENDED' || !target.suspendedAt) {
            throw this.stateConflict('CUSTOMER_ACCOUNT_MUST_BE_SUSPENDED_FIRST');
          }
          await this.revokeCustomerAccess(transaction, target.user.id, 'customer_disabled', now);
          await this.updateLifecycleVersions(transaction, target, input, {
            user: {
              status: 'DISABLED',
              deletedAt: now,
              version: { increment: 1 },
            },
            profile: {
              suspensionReason: reason,
              version: { increment: 1 },
            },
          });
        }

        const updated = await transaction.customerProfile.findUniqueOrThrow({
          where: { id: target.id },
          include: CUSTOMER_ACCOUNT_INCLUDE,
        });
        await this.writeSuccessEvents(transaction, {
          actorUserId,
          targetUserId: target.user.id,
          action: `customer.account.${action}`,
          request,
          before: { status: target.user.status },
          after: { status: updated.user.status, reason },
          severity: action === 'reactivate' ? 'MEDIUM' : 'HIGH',
        });
        return updated;
      });
      return { data: this.serialize(record) };
    } catch (error) {
      await this.recordDenied(`customer.account.${action}`, id, actorUserId, request, error);
      throw error;
    }
  }

  private async lockAndRequireActor(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
  ): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT id FROM Role WHERE \`key\` = ${SUPER_ADMINISTRATOR_ROLE_KEY} FOR UPDATE`,
    );
    const actor = await transaction.user.findFirst({
      where: {
        id: actorUserId,
        audience: 'ADMIN',
        status: 'ACTIVE',
        deletedAt: null,
        adminProfile: { is: { suspendedAt: null, mustEnrollTwoFactor: false } },
        twoFactorSecret: { is: { verifiedAt: { not: null } } },
        roles: { some: { role: { key: SUPER_ADMINISTRATOR_ROLE_KEY } } },
      },
      select: { id: true },
    });
    if (!actor) {
      throw new ForbiddenException({
        code: 'SUPER_ADMINISTRATOR_STATE_INVALID',
        message: 'The super-administrator account is not in an operational state.',
      });
    }
  }

  private assertVersions(target: CustomerAccount, input: AccountLifecycleDto): void {
    if (
      target.user.version !== input.expectedUserVersion ||
      target.version !== input.expectedProfileVersion
    ) {
      throw new ConflictException({
        code: 'CUSTOMER_ACCOUNT_VERSION_CONFLICT',
        message: 'The customer account changed. Refresh and confirm the action again.',
      });
    }
  }

  private async updateLifecycleVersions(
    transaction: Prisma.TransactionClient,
    target: CustomerAccount,
    input: AccountLifecycleDto,
    data: {
      user: Prisma.UserUpdateManyMutationInput;
      profile: Prisma.CustomerProfileUpdateManyMutationInput;
    },
  ): Promise<void> {
    const user = await transaction.user.updateMany({
      where: { id: target.user.id, version: input.expectedUserVersion },
      data: data.user,
    });
    const profile = await transaction.customerProfile.updateMany({
      where: { id: target.id, version: input.expectedProfileVersion },
      data: data.profile,
    });
    if (user.count !== 1 || profile.count !== 1) {
      throw new ConflictException({
        code: 'CUSTOMER_ACCOUNT_VERSION_CONFLICT',
        message: 'The customer account changed. Refresh and confirm the action again.',
      });
    }
  }

  private async revokeCustomerAccess(
    transaction: Prisma.TransactionClient,
    userId: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    await Promise.all([
      transaction.session.updateMany({
        where: { userId, audience: 'CUSTOMER', status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: now, revokedReason: reason },
      }),
      transaction.verificationToken.deleteMany({ where: { userId } }),
      transaction.passwordResetToken.deleteMany({ where: { userId } }),
    ]);
  }

  private async writeSuccessEvents(
    transaction: Prisma.TransactionClient,
    input: {
      actorUserId: string;
      targetUserId: string;
      action: string;
      request: Request;
      before: Prisma.InputJsonValue;
      after: Prisma.InputJsonValue;
      severity: 'MEDIUM' | 'HIGH';
    },
  ): Promise<void> {
    const userAgent = input.request.get('user-agent');
    const ipAddress = (input.request.ip ?? input.request.socket.remoteAddress ?? 'unknown').slice(
      0,
      45,
    );
    await Promise.all([
      transaction.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          actorType: 'ADMIN',
          action: input.action,
          resourceType: 'CustomerProfile',
          resourceId: input.targetUserId,
          outcome: 'SUCCESS',
          requestId: input.request.requestId,
          ipAddress,
          ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
          beforeSummary: input.before,
          afterSummary: input.after,
        },
      }),
      transaction.securityEvent.create({
        data: {
          userId: input.targetUserId,
          type: input.action.toUpperCase().replaceAll('.', '_'),
          severity: input.severity,
          summary: 'A customer account lifecycle action was completed by a super administrator.',
          requestId: input.request.requestId,
          ipAddress,
          ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
          metadata: { actorUserId: input.actorUserId },
        },
      }),
    ]);
  }

  private async recordDenied(
    action: string,
    profileId: string,
    actorUserId: string,
    request: Request,
    error: unknown,
  ): Promise<void> {
    const code = responseCode(error);
    if (!code) return;
    const userAgent = request.get('user-agent');
    await this.prisma.auditLog
      .create({
        data: {
          actorUserId,
          actorType: 'ADMIN',
          action,
          resourceType: 'CustomerProfile',
          resourceId: profileId,
          outcome: 'DENIED',
          requestId: request.requestId,
          ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
          ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
          errorCode: code,
        },
      })
      .catch(() => undefined);
  }

  private serialize(record: CustomerAccount) {
    return {
      id: record.id,
      userId: record.user.id,
      fullName: `${record.firstName} ${record.lastName}`.trim(),
      normalizedPhone: record.phoneE164,
      email: record.user.email,
      status: record.user.status,
      suspendedAt: record.suspendedAt?.toISOString() ?? null,
      suspensionReason: record.suspensionReason,
      userVersion: record.user.version,
      profileVersion: record.version,
      createdAt: record.createdAt.toISOString(),
    };
  }

  private stateConflict(code: string): ConflictException {
    return new ConflictException({
      code,
      message: 'The customer account is not in the required lifecycle state.',
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'CUSTOMER_ACCOUNT_NOT_FOUND',
      message: 'The customer account was not found.',
    });
  }
}
