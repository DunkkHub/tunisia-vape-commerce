import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { createNotificationWithOutbox } from '../common/outbox/notification-outbox';
import { CryptoService } from '../common/security/crypto.service';
import { PrismaService } from '../database/prisma.service';
import type { CreateCustomerNoteDto } from './dto/customer-management.dto';

const requestMetadata = (request: Request) => {
  const userAgent = request.get('user-agent');
  return {
    requestId: request.requestId,
    ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
    ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
};

@Injectable()
export class CustomerManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async detail(id: string) {
    const customer = await this.prisma.customerProfile.findFirst({
      where: { id, user: { is: { audience: 'CUSTOMER' } } },
      select: {
        id: true,
        userId: true,
        firstName: true,
        lastName: true,
        phoneE164: true,
        locale: true,
        marketingConsent: true,
        suspendedAt: true,
        suspensionReason: true,
        anonymizedAt: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { email: true, status: true, version: true, lastLoginAt: true } },
        addresses: {
          where: { deletedAt: null },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            label: true,
            fullName: true,
            phoneE164: true,
            street: true,
            postalCode: true,
            isDefault: true,
            governorate: { select: { nameFr: true } },
            delegation: { select: { nameFr: true } },
            locality: { select: { nameFr: true } },
          },
        },
        orders: {
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 20,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            grandTotalMillimes: true,
            createdAt: true,
          },
        },
        notes: {
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 50,
          select: { id: true, body: true, authorId: true, createdAt: true },
        },
      },
    });
    if (!customer) throw this.notFound();

    const [sessions, orderCount, audit] = await Promise.all([
      this.prisma.session.findMany({
        where: {
          userId: customer.userId,
          audience: 'CUSTOMER',
          status: 'ACTIVE',
          revokedAt: null,
          absoluteExpiresAt: { gt: new Date() },
        },
        orderBy: { lastSeenAt: 'desc' },
        take: 20,
        select: {
          id: true,
          lastSeenAt: true,
          absoluteExpiresAt: true,
          ipAddress: true,
          userAgent: true,
        },
      }),
      this.prisma.order.count({ where: { customerId: customer.id } }),
      this.prisma.auditLog.findMany({
        where: {
          OR: [
            { resourceType: 'CustomerProfile', resourceId: customer.id },
            { resourceType: 'CustomerProfile', resourceId: customer.userId },
          ],
        },
        orderBy: { occurredAt: 'desc' },
        take: 20,
        select: {
          id: true,
          action: true,
          outcome: true,
          actorUserId: true,
          occurredAt: true,
        },
      }),
    ]);

    return {
      data: {
        id: customer.id,
        userId: customer.userId,
        fullName: `${customer.firstName} ${customer.lastName}`.trim(),
        firstName: customer.firstName,
        lastName: customer.lastName,
        normalizedPhone: customer.phoneE164,
        email: customer.user.email,
        locale: customer.locale,
        marketingConsent: customer.marketingConsent,
        status: customer.user.status,
        suspendedAt: customer.suspendedAt?.toISOString() ?? null,
        suspensionReason: customer.suspensionReason,
        anonymizedAt: customer.anonymizedAt?.toISOString() ?? null,
        lastLoginAt: customer.user.lastLoginAt?.toISOString() ?? null,
        userVersion: customer.user.version,
        profileVersion: customer.version,
        createdAt: customer.createdAt.toISOString(),
        updatedAt: customer.updatedAt.toISOString(),
        orderCount,
        addresses: customer.addresses.map((address) => ({
          id: address.id,
          label: address.label,
          fullName: address.fullName,
          phone: address.phoneE164,
          street: address.street,
          governorate: address.governorate.nameFr,
          delegation: address.delegation.nameFr,
          locality: address.locality?.nameFr ?? null,
          postalCode: address.postalCode,
          isDefault: address.isDefault,
        })),
        recentOrders: customer.orders.map((order) => ({
          ...order,
          createdAt: order.createdAt.toISOString(),
        })),
        activeSessions: sessions.map((session) => ({
          ...session,
          lastSeenAt: session.lastSeenAt.toISOString(),
          absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
        })),
        notes: customer.notes.map((note) => ({
          ...note,
          createdAt: note.createdAt.toISOString(),
        })),
        audit: audit.map((entry) => ({
          ...entry,
          occurredAt: entry.occurredAt.toISOString(),
        })),
      },
    };
  }

  async addNote(id: string, input: CreateCustomerNoteDto, actorUserId: string, request: Request) {
    const body = input.body.trim();
    const note = await this.prisma.$transaction(async (transaction) => {
      await this.requireCustomer(transaction, id);
      const created = await transaction.customerNote.create({
        data: { customerId: id, authorId: actorUserId, body },
        select: { id: true, body: true, authorId: true, createdAt: true },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId,
          actorType: 'ADMIN',
          action: 'customer.note.created',
          resourceType: 'CustomerProfile',
          resourceId: id,
          outcome: 'SUCCESS',
          ...requestMetadata(request),
          afterSummary: { noteId: created.id },
        },
      });
      return created;
    });
    return { data: { ...note, createdAt: note.createdAt.toISOString() } };
  }

  async revokeSessions(id: string, actorUserId: string, request: Request) {
    const now = new Date();
    const revokedSessions = await this.prisma.$transaction(async (transaction) => {
      const customer = await this.requireCustomer(transaction, id);
      const revoked = await transaction.session.updateMany({
        where: { userId: customer.userId, audience: 'CUSTOMER', status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokedReason: 'administrator_revoked_customer_sessions',
        },
      });
      await Promise.all([
        transaction.auditLog.create({
          data: {
            actorUserId,
            actorType: 'ADMIN',
            action: 'customer.sessions.revoked',
            resourceType: 'CustomerProfile',
            resourceId: id,
            outcome: 'SUCCESS',
            ...requestMetadata(request),
            afterSummary: { revokedSessions: revoked.count },
          },
        }),
        transaction.securityEvent.create({
          data: {
            userId: customer.userId,
            type: 'CUSTOMER_SESSIONS_REVOKED_BY_ADMIN',
            severity: 'HIGH',
            summary: 'Active customer sessions were revoked by an administrator.',
            metadata: { actorUserId, revokedSessions: revoked.count },
            ...requestMetadata(request),
          },
        }),
      ]);
      return revoked.count;
    });
    return { revokedSessions };
  }

  async triggerPasswordReset(id: string, actorUserId: string, request: Request) {
    const token = this.crypto.randomToken();
    const tokenHash = this.crypto.hashToken(token);
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const customer = await transaction.customerProfile.findFirst({
        where: {
          id,
          suspendedAt: null,
          anonymizedAt: null,
          user: { is: { audience: 'CUSTOMER', status: 'ACTIVE', deletedAt: null } },
        },
        select: {
          userId: true,
          locale: true,
          user: { select: { emailNormalized: true } },
        },
      });
      if (!customer) throw this.notFound();
      if (!customer.user.emailNormalized) {
        throw new ConflictException({
          code: 'CUSTOMER_EMAIL_REQUIRED',
          message: 'The customer does not have a verified reset destination.',
        });
      }
      await transaction.passwordResetToken.updateMany({
        where: { userId: customer.userId, audience: 'CUSTOMER', consumedAt: null },
        data: { consumedAt: now },
      });
      await transaction.passwordResetToken.create({
        data: {
          userId: customer.userId,
          audience: 'CUSTOMER',
          tokenHash,
          requestedIp: requestMetadata(request).ipAddress,
          expiresAt: new Date(now.getTime() + 30 * 60_000),
        },
      });
      await createNotificationWithOutbox(transaction, {
        idempotencyKey: `admin-password-reset:${customer.userId}:${tokenHash.slice(0, 20)}`,
        event: 'PASSWORD_RESET',
        channel: 'EMAIL',
        recipientHash: this.crypto.hashToken(customer.user.emailNormalized),
        encryptedRecipient: this.crypto.encrypt(customer.user.emailNormalized),
        locale: customer.locale,
        payload: {
          encryptedResetToken: this.crypto.encrypt(token),
          expiresInMinutes: 30,
        },
        status: 'QUEUED',
      });
      await transaction.auditLog.create({
        data: {
          actorUserId,
          actorType: 'ADMIN',
          action: 'customer.password_reset.requested',
          resourceType: 'CustomerProfile',
          resourceId: id,
          outcome: 'SUCCESS',
          ...requestMetadata(request),
          afterSummary: { channel: 'EMAIL' },
        },
      });
    });
    return { queued: true };
  }

  async exportCustomer(id: string, actorUserId: string, request: Request) {
    const customer = await this.prisma.customerProfile.findFirst({
      where: { id, user: { is: { audience: 'CUSTOMER' } } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phoneE164: true,
        locale: true,
        marketingConsent: true,
        createdAt: true,
        user: { select: { email: true, status: true } },
        addresses: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            type: true,
            label: true,
            fullName: true,
            phoneE164: true,
            street: true,
            building: true,
            floor: true,
            apartment: true,
            landmark: true,
            postalCode: true,
            governorate: { select: { nameFr: true, nameAr: true } },
            delegation: { select: { nameFr: true, nameAr: true } },
            locality: { select: { nameFr: true, nameAr: true } },
          },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 500,
          select: {
            orderNumber: true,
            status: true,
            currency: true,
            grandTotalMillimes: true,
            createdAt: true,
          },
        },
        consentRecords: {
          orderBy: { consentedAt: 'desc' },
          take: 500,
          select: {
            type: true,
            granted: true,
            locale: true,
            source: true,
            consentedAt: true,
            withdrawnAt: true,
            legalDocumentVersion: { select: { version: true } },
          },
        },
      },
    });
    if (!customer) throw this.notFound();

    const generatedAt = new Date();
    const totalOrders = await this.prisma.order.count({ where: { customerId: id } });
    await this.prisma.$transaction([
      this.prisma.customerDataExportRequest.create({
        data: {
          customerId: id,
          status: 'COMPLETED',
          completedAt: generatedAt,
          processedBy: actorUserId,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId,
          actorType: 'ADMIN',
          action: 'customer.data_export.generated',
          resourceType: 'CustomerProfile',
          resourceId: id,
          outcome: 'SUCCESS',
          ...requestMetadata(request),
          afterSummary: { format: 'JSON', orderCount: customer.orders.length, totalOrders },
        },
      }),
    ]);

    return {
      data: {
        generatedAt: generatedAt.toISOString(),
        customer: {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phoneE164,
          email: customer.user.email,
          locale: customer.locale,
          accountStatus: customer.user.status,
          marketingConsent: customer.marketingConsent,
          createdAt: customer.createdAt.toISOString(),
        },
        addresses: customer.addresses,
        orders: customer.orders.map((order) => ({
          ...order,
          createdAt: order.createdAt.toISOString(),
        })),
        consents: customer.consentRecords.map((consent) => ({
          ...consent,
          consentedAt: consent.consentedAt.toISOString(),
          withdrawnAt: consent.withdrawnAt?.toISOString() ?? null,
          documentVersion: consent.legalDocumentVersion?.version ?? null,
          legalDocumentVersion: undefined,
        })),
        pagination: {
          ordersIncluded: customer.orders.length,
          totalOrders,
          truncated: totalOrders > customer.orders.length,
        },
      },
    };
  }

  private async requireCustomer(transaction: Prisma.TransactionClient, id: string) {
    const customer = await transaction.customerProfile.findFirst({
      where: { id, user: { is: { audience: 'CUSTOMER' } } },
      select: { id: true, userId: true },
    });
    if (!customer) throw this.notFound();
    return customer;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'CUSTOMER_ACCOUNT_NOT_FOUND',
      message: 'The customer account was not found.',
    });
  }
}
