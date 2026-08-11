import 'reflect-metadata';
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import type { CryptoService } from '../common/security/crypto.service';
import type { Environment } from '../config/environment';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import type { PrismaService } from '../database/prisma.service';
import { CustomerManagementController } from './customer-management.controller';
import { CustomerManagementService } from './customer-management.service';
import { CreateCustomerNoteDto } from './dto/customer-management.dto';

const request = {
  requestId: 'request-1',
  ip: '127.0.0.1',
  socket: {},
  get: vi.fn().mockReturnValue('test-agent'),
} as never;

describe('customer management access policy', () => {
  it('keeps reads and writes in the administrator realm with no-store responses', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CustomerManagementController)).toEqual([
      AdminSessionGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, CustomerManagementController)).toEqual([
      NoStoreInterceptor,
    ]);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const detail = CustomerManagementController.prototype.detail;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const addNote = CustomerManagementController.prototype.addNote;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const reset = CustomerManagementController.prototype.passwordReset;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const revoke = CustomerManagementController.prototype.revokeSessions;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const exportCustomer = CustomerManagementController.prototype.exportCustomer;

    expect(Reflect.getMetadata(PERMISSIONS_METADATA, detail)).toEqual(['customers.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, addNote)).toEqual(['customers.update']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, reset)).toEqual(['customers.update']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, revoke)).toEqual(['customers.update']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, exportCustomer)).toEqual(['customers.export']);
    expect(Reflect.getMetadata(GUARDS_METADATA, addNote)).toEqual([CsrfGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, reset)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, revoke)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, exportCustomer)).toEqual([
      RecentAuthenticationGuard,
    ]);
  });

  it('trims internal notes before validating their bounded content', async () => {
    const valid = plainToInstance(CreateCustomerNoteDto, { body: '  Call after 18:00  ' });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.body).toBe('Call after 18:00');

    const blank = plainToInstance(CreateCustomerNoteDto, { body: '   ' });
    expect((await validate(blank)).some(({ property }) => property === 'body')).toBe(true);
  });
});

describe('CustomerManagementService', () => {
  it('rejects an admin-triggered reset for a Google-only customer without persisting a token', async () => {
    const transaction = {
      customerProfile: {
        findFirst: vi.fn().mockResolvedValue({
          userId: 'google-user-1',
          locale: 'fr',
          user: { emailNormalized: 'google@example.com', passwordHash: null },
          externalIdentities: [{ provider: 'GOOGLE' }],
        }),
      },
      passwordResetToken: {
        updateMany: vi.fn(),
        create: vi.fn(),
      },
      notification: { create: vi.fn() },
      outboxEvent: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaService;
    const crypto = {
      randomToken: vi.fn().mockReturnValue('unused-reset-token'),
      hashToken: vi.fn().mockReturnValue('unused-reset-token-hash'),
    } as unknown as CryptoService;
    const getConfig = vi.fn();
    const config = { get: getConfig } as unknown as ConfigService<Environment, true>;
    const service = new CustomerManagementService(prisma, crypto, config);

    await expect(
      service.triggerPasswordReset('customer-1', 'admin-1', request),
    ).rejects.toMatchObject({
      response: {
        code: 'CUSTOMER_USES_EXTERNAL_PROVIDER',
        message: 'This customer signs in with Google and has no local password to reset.',
      },
      status: 409,
    });

    expect(transaction.passwordResetToken.updateMany).not.toHaveBeenCalled();
    expect(transaction.passwordResetToken.create).not.toHaveBeenCalled();
    expect(transaction.notification.create).not.toHaveBeenCalled();
    expect(transaction.outboxEvent.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
    expect(getConfig).not.toHaveBeenCalled();
  });

  it('uses the configured TTL for an admin-triggered local-password reset', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T12:00:00.000Z'));
    try {
      const transaction = {
        customerProfile: {
          findFirst: vi.fn().mockResolvedValue({
            userId: 'local-user-1',
            locale: 'fr',
            user: { emailNormalized: 'local@example.com', passwordHash: 'local-password-hash' },
            externalIdentities: [],
          }),
        },
        passwordResetToken: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue({ id: 'reset-record-1' }),
        },
        notification: {
          create: vi.fn().mockResolvedValue({
            id: 'admin-reset-notification-1',
            channel: 'EMAIL',
            event: 'PASSWORD_RESET',
          }),
        },
        outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
        auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
      };
      const prisma = {
        $transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
        ),
      } as unknown as PrismaService;
      const crypto = {
        randomToken: vi.fn().mockReturnValue('admin-reset-token'),
        hashToken: vi.fn((value: string) =>
          value === 'admin-reset-token' ? 'admin-reset-token-hash' : 'recipient-hash',
        ),
        encrypt: vi.fn((value: string) => `encrypted:${value}`),
      } as unknown as CryptoService;
      const getConfig = vi.fn().mockReturnValue(23);
      const config = { get: getConfig } as unknown as ConfigService<Environment, true>;
      const service = new CustomerManagementService(prisma, crypto, config);

      await expect(service.triggerPasswordReset('customer-1', 'admin-1', request)).resolves.toEqual(
        { queued: true },
      );

      expect(getConfig).toHaveBeenCalledWith('PASSWORD_RESET_TTL_MINUTES', { infer: true });
      expect(transaction.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'local-user-1', audience: 'CUSTOMER', consumedAt: null },
        data: { consumedAt: new Date('2026-08-04T12:00:00.000Z') },
      });
      expect(transaction.passwordResetToken.create).toHaveBeenCalledWith({
        data: {
          userId: 'local-user-1',
          audience: 'CUSTOMER',
          tokenHash: 'admin-reset-token-hash',
          requestedIp: '127.0.0.1',
          expiresAt: new Date('2026-08-04T12:23:00.000Z'),
        },
      });
      expect(transaction.notification.create).toHaveBeenCalledWith({
        // Vitest's nested asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          idempotencyKey: 'admin-password-reset:local-user-1:admin-reset-token-ha',
          event: 'PASSWORD_RESET',
          recipientHash: 'recipient-hash',
          encryptedRecipient: 'encrypted:local@example.com',
          payload: {
            kind: 'PASSWORD_RESET',
            encryptedResetToken: 'encrypted:admin-reset-token',
            expiresInMinutes: 23,
          },
        }),
        select: { id: true, channel: true, event: true },
      });
      expect(transaction.outboxEvent.create).toHaveBeenCalledOnce();
      expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('revokes only active customer-realm sessions and records both audit streams', async () => {
    const transaction = {
      customerProfile: {
        findFirst: vi.fn().mockResolvedValue({ id: 'customer-1', userId: 'user-1' }),
      },
      session: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
      securityEvent: { create: vi.fn().mockResolvedValue({ id: 'security-1' }) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaService;
    const service = new CustomerManagementService(
      prisma,
      {} as CryptoService,
      {} as ConfigService<Environment, true>,
    );

    await expect(service.revokeSessions('customer-1', 'admin-1', request)).resolves.toEqual({
      revokedSessions: 2,
    });
    expect(transaction.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', audience: 'CUSTOMER', status: 'ACTIVE' },
      // Vitest's asymmetric matcher is intentionally dynamic.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        status: 'REVOKED',
        revokedReason: 'administrator_revoked_customer_sessions',
      }),
    });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.securityEvent.create).toHaveBeenCalledOnce();
  });

  it('writes a customer note and its audit record in one transaction', async () => {
    const transaction = {
      customerProfile: {
        findFirst: vi.fn().mockResolvedValue({ id: 'customer-1', userId: 'user-1' }),
      },
      customerNote: {
        create: vi.fn().mockResolvedValue({
          id: 'note-1',
          body: 'Call after 18:00',
          authorId: 'admin-1',
          createdAt: new Date('2026-07-20T10:00:00.000Z'),
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaService;
    const service = new CustomerManagementService(
      prisma,
      {} as CryptoService,
      {} as ConfigService<Environment, true>,
    );

    await expect(
      service.addNote('customer-1', { body: '  Call after 18:00  ' }, 'admin-1', request),
    ).resolves.toEqual({
      data: {
        id: 'note-1',
        body: 'Call after 18:00',
        authorId: 'admin-1',
        createdAt: '2026-07-20T10:00:00.000Z',
      },
    });
    expect(transaction.customerNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        // Vitest's nested asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ body: 'Call after 18:00' }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });
});
