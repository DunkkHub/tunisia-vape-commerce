import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type HttpException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { hashAdminPassword } from '../auth/admin-password';
import { SUPER_ADMINISTRATOR_ROLE_KEY } from '../auth/guards/super-administrator.guard';
import { CryptoService } from '../common/security/crypto.service';
import { PrismaService } from '../database/prisma.service';
import type {
  AccountLifecycleDto,
  AdminAccountListQueryDto,
  AnonymizeAdminAccountDto,
  CreateAdminAccountDto,
} from './dto/admin-account.dto';

const ADMIN_ACCOUNT_INCLUDE = {
  adminProfile: true,
  twoFactorSecret: { select: { verifiedAt: true } },
  roles: { include: { role: { select: { key: true, name: true } } } },
} as const;

type AdminAccount = Prisma.UserGetPayload<{ include: typeof ADMIN_ACCOUNT_INCLUDE }>;

const responseCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || !('getResponse' in error)) return undefined;
  const response = (error as HttpException).getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? String(response.code)
    : undefined;
};

@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async list(query: AdminAccountListQueryDto) {
    const search = query.q?.trim().replace(/\s+/g, ' ');
    const where = {
      audience: 'ADMIN',
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { emailNormalized: { contains: search.toLocaleLowerCase('en-US') } },
              { adminProfile: { is: { displayName: { contains: search } } } },
              { adminProfile: { is: { employeeCode: { contains: search } } } },
              { adminProfile: { is: { jobTitle: { contains: search } } } },
            ],
          }
        : {}),
    } satisfies Prisma.UserWhereInput;
    const [records, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: ADMIN_ACCOUNT_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      data: {
        items: records
          .filter((record) => record.adminProfile)
          .map((record) => this.serialize(record)),
        page: query.page,
        pageSize: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async create(input: CreateAdminAccountDto, actorUserId: string, request: Request) {
    const emailNormalized = input.email.trim().toLocaleLowerCase('en-US');
    const roleKeys = [...new Set(input.roleKeys?.map((key) => key.trim()) ?? ['administrator'])];
    if (roleKeys.includes(SUPER_ADMINISTRATOR_ROLE_KEY)) {
      throw new ForbiddenException({
        code: 'SUPER_ADMINISTRATOR_ASSIGNMENT_REQUIRES_APPROVAL',
        message: 'Super-administrator assignment requires a separate approval workflow.',
      });
    }
    const passwordHash = await hashAdminPassword(input.password);

    try {
      const record = await this.prisma.$transaction(async (transaction) => {
        await this.lockAndRequireActor(transaction, actorUserId);
        const roles = await transaction.role.findMany({
          where: { key: { in: roleKeys }, isSystem: true },
          select: { id: true, key: true },
        });
        if (roles.length !== roleKeys.length) {
          throw new ConflictException({
            code: 'ADMIN_ROLE_SELECTION_INVALID',
            message: 'One or more selected administrator roles are unavailable.',
          });
        }

        const now = new Date();
        const created = await transaction.user.create({
          data: {
            audience: 'ADMIN',
            email: emailNormalized,
            emailNormalized,
            passwordHash,
            status: 'ACTIVE',
            emailVerifiedAt: now,
            passwordChangedAt: now,
            adminProfile: {
              create: {
                displayName: input.displayName.trim(),
                employeeCode: input.employeeCode?.trim() || null,
                jobTitle: input.jobTitle?.trim() || null,
                mustEnrollTwoFactor: true,
                invitationAcceptedAt: now,
              },
            },
            roles: {
              create: roles.map((role) => ({ roleId: role.id, assignedBy: actorUserId })),
            },
          },
          include: ADMIN_ACCOUNT_INCLUDE,
        });
        await this.writeSuccessEvents(transaction, {
          actorUserId,
          targetUserId: created.id,
          action: 'admin.account.created',
          request,
          before: null,
          after: { status: created.status, roleKeys },
          securityType: 'ADMIN_ACCOUNT_CREATED',
          securitySummary: 'A new administrator account was created and requires TOTP enrollment.',
          severity: 'HIGH',
        });
        return created;
      });
      return { data: this.serialize(record) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'ADMIN_ACCOUNT_UNAVAILABLE',
          message: 'The administrator account could not be created with those identifiers.',
        });
      }
      await this.recordDenied('admin.account.create', null, actorUserId, request, error);
      throw error;
    }
  }

  suspend(id: string, input: AccountLifecycleDto, actorUserId: string, request: Request) {
    return this.lifecycle('suspend', id, input, actorUserId, request);
  }

  reactivate(id: string, input: AccountLifecycleDto, actorUserId: string, request: Request) {
    return this.lifecycle('reactivate', id, input, actorUserId, request);
  }

  anonymize(id: string, input: AnonymizeAdminAccountDto, actorUserId: string, request: Request) {
    return this.lifecycle('anonymize', id, input, actorUserId, request);
  }

  private async lifecycle(
    action: 'suspend' | 'reactivate' | 'anonymize',
    id: string,
    input: AccountLifecycleDto | AnonymizeAdminAccountDto,
    actorUserId: string,
    request: Request,
  ) {
    const replacementPasswordHash =
      action === 'anonymize' ? await hashAdminPassword(this.crypto.randomToken()) : null;
    try {
      const record = await this.prisma.$transaction(async (transaction) => {
        await this.lockAndRequireActor(transaction, actorUserId);
        if (id === actorUserId) {
          throw new ForbiddenException({
            code:
              action === 'anonymize'
                ? 'SELF_ADMIN_ANONYMIZATION_FORBIDDEN'
                : 'SELF_ADMIN_LIFECYCLE_FORBIDDEN',
            message: 'You cannot change your own administrator lifecycle state.',
          });
        }
        const target = await transaction.user.findFirst({
          where: { id, audience: 'ADMIN' },
          include: ADMIN_ACCOUNT_INCLUDE,
        });
        if (!target?.adminProfile) throw this.notFound();
        this.assertVersions(target, input);
        if (action !== 'reactivate') await this.assertAnotherOperationalSuper(transaction, target);

        const before = {
          status: target.status,
          suspendedAt: target.adminProfile.suspendedAt?.toISOString() ?? null,
          roleKeys: target.roles.map(({ role }) => role.key),
        };
        const now = new Date();
        const reason = input.reason.trim();
        if (action === 'suspend') {
          if (target.status !== 'ACTIVE' || target.adminProfile.suspendedAt) {
            throw this.stateConflict('ADMIN_ACCOUNT_NOT_ACTIVE');
          }
          await this.updateLifecycleVersions(transaction, target, input, {
            user: { status: 'SUSPENDED', version: { increment: 1 } },
            profile: {
              suspendedAt: now,
              suspensionReason: reason,
              version: { increment: 1 },
            },
          });
          await this.revokeAdministratorAccess(
            transaction,
            target.id,
            'administrator_suspended',
            now,
          );
        } else if (action === 'reactivate') {
          if (target.status !== 'SUSPENDED' || !target.adminProfile.suspendedAt) {
            throw this.stateConflict('ADMIN_ACCOUNT_NOT_SUSPENDED');
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
          if (target.status !== 'SUSPENDED' || !target.adminProfile.suspendedAt) {
            throw this.stateConflict('ADMIN_ACCOUNT_MUST_BE_SUSPENDED_FIRST');
          }
          await this.revokeAdministratorAccess(
            transaction,
            target.id,
            'administrator_anonymized',
            now,
          );
          await Promise.all([
            transaction.userRole.deleteMany({ where: { userId: target.id } }),
            transaction.twoFactorSecret.deleteMany({ where: { userId: target.id } }),
            transaction.recoveryCode.deleteMany({ where: { userId: target.id } }),
            transaction.verificationToken.deleteMany({ where: { userId: target.id } }),
            transaction.passwordResetToken.deleteMany({ where: { userId: target.id } }),
          ]);
          await this.updateLifecycleVersions(transaction, target, input, {
            user: {
              status: 'ANONYMIZED',
              email: null,
              emailNormalized: null,
              emailVerifiedAt: null,
              phoneVerifiedAt: null,
              passwordHash: replacementPasswordHash!,
              failedLoginCount: 0,
              lockedUntil: null,
              lastLoginAt: null,
              deletedAt: now,
              version: { increment: 1 },
            },
            profile: {
              displayName: 'Administrator removed',
              employeeCode: null,
              jobTitle: null,
              mustEnrollTwoFactor: true,
              twoFactorEnforcedAt: null,
              lastStepUpAt: null,
              allowedIpCidrs: Prisma.DbNull,
              suspensionReason: reason,
              invitationAcceptedAt: null,
              version: { increment: 1 },
            },
          });
        }

        const updated = await transaction.user.findUniqueOrThrow({
          where: { id: target.id },
          include: ADMIN_ACCOUNT_INCLUDE,
        });
        await this.writeSuccessEvents(transaction, {
          actorUserId,
          targetUserId: target.id,
          action: `admin.account.${action}`,
          request,
          before,
          after: { status: updated.status, reason },
          securityType: `ADMIN_ACCOUNT_${action.toUpperCase()}`,
          securitySummary: `An administrator account lifecycle action completed: ${action}.`,
          severity: action === 'reactivate' ? 'MEDIUM' : 'HIGH',
        });
        return updated;
      });
      return { data: this.serialize(record) };
    } catch (error) {
      await this.recordDenied(`admin.account.${action}`, id, actorUserId, request, error);
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
        adminProfile: {
          is: { suspendedAt: null, mustEnrollTwoFactor: false },
        },
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

  private async assertAnotherOperationalSuper(
    transaction: Prisma.TransactionClient,
    target: AdminAccount,
  ): Promise<void> {
    if (!target.roles.some(({ role }) => role.key === SUPER_ADMINISTRATOR_ROLE_KEY)) return;
    const remaining = await transaction.user.count({
      where: {
        id: { not: target.id },
        audience: 'ADMIN',
        status: 'ACTIVE',
        deletedAt: null,
        adminProfile: { is: { suspendedAt: null, mustEnrollTwoFactor: false } },
        twoFactorSecret: { is: { verifiedAt: { not: null } } },
        roles: { some: { role: { key: SUPER_ADMINISTRATOR_ROLE_KEY } } },
      },
    });
    if (remaining < 1) {
      throw new ConflictException({
        code: 'LAST_SUPER_ADMINISTRATOR_REQUIRED',
        message: 'At least one other operational super-administrator must remain.',
      });
    }
  }

  private assertVersions(target: AdminAccount, input: AccountLifecycleDto): void {
    if (
      target.version !== input.expectedUserVersion ||
      target.adminProfile?.version !== input.expectedProfileVersion
    ) {
      throw new ConflictException({
        code: 'ADMIN_ACCOUNT_VERSION_CONFLICT',
        message: 'The administrator account changed. Refresh and confirm the action again.',
      });
    }
  }

  private async updateLifecycleVersions(
    transaction: Prisma.TransactionClient,
    target: AdminAccount,
    input: AccountLifecycleDto,
    data: {
      user: Prisma.UserUpdateManyMutationInput;
      profile: Prisma.AdminProfileUpdateManyMutationInput;
    },
  ): Promise<void> {
    const user = await transaction.user.updateMany({
      where: { id: target.id, version: input.expectedUserVersion },
      data: data.user,
    });
    const profile = await transaction.adminProfile.updateMany({
      where: { id: target.adminProfile!.id, version: input.expectedProfileVersion },
      data: data.profile,
    });
    if (user.count !== 1 || profile.count !== 1) {
      throw new ConflictException({
        code: 'ADMIN_ACCOUNT_VERSION_CONFLICT',
        message: 'The administrator account changed. Refresh and confirm the action again.',
      });
    }
  }

  private async revokeAdministratorAccess(
    transaction: Prisma.TransactionClient,
    userId: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    await Promise.all([
      transaction.session.updateMany({
        where: { userId, audience: 'ADMIN', status: 'ACTIVE' },
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
      before: Prisma.InputJsonValue | null;
      after: Prisma.InputJsonValue;
      securityType: string;
      securitySummary: string;
      severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
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
          resourceType: 'User',
          resourceId: input.targetUserId,
          outcome: 'SUCCESS',
          requestId: input.request.requestId,
          ipAddress,
          ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
          ...(input.before === null ? {} : { beforeSummary: input.before }),
          afterSummary: input.after,
        },
      }),
      transaction.securityEvent.create({
        data: {
          userId: input.targetUserId,
          type: input.securityType,
          severity: input.severity,
          summary: input.securitySummary,
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
    targetUserId: string | null,
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
          resourceType: 'User',
          ...(targetUserId ? { resourceId: targetUserId } : {}),
          outcome: 'DENIED',
          requestId: request.requestId,
          ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
          ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
          errorCode: code,
        },
      })
      .catch(() => undefined);
  }

  private serialize(record: AdminAccount) {
    if (!record.adminProfile) throw this.notFound();
    return {
      id: record.id,
      email: record.email,
      displayName: record.adminProfile.displayName,
      employeeCode: record.adminProfile.employeeCode,
      jobTitle: record.adminProfile.jobTitle,
      status: record.status,
      roles: record.roles.map(({ role }) => ({ key: role.key, name: role.name })),
      twoFactorEnrolled: Boolean(record.twoFactorSecret?.verifiedAt),
      suspendedAt: record.adminProfile.suspendedAt?.toISOString() ?? null,
      suspensionReason: record.adminProfile.suspensionReason,
      userVersion: record.version,
      profileVersion: record.adminProfile.version,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private stateConflict(code: string): ConflictException {
    return new ConflictException({
      code,
      message: 'The administrator account is not in the required lifecycle state.',
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'ADMIN_ACCOUNT_NOT_FOUND',
      message: 'The administrator account was not found.',
    });
  }
}
