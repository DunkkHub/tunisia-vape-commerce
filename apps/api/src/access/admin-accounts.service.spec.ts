import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../common/security/crypto.service';
import type { PrismaService } from '../database/prisma.service';
import { AdminAccountsService } from './admin-accounts.service';

const request = {
  get: vi.fn().mockReturnValue('vitest'),
  ip: '127.0.0.1',
  socket: {},
  requestId: 'request-id',
} as unknown as Request;

const lifecycleInput = {
  expectedUserVersion: 1,
  expectedProfileVersion: 1,
  reason: 'Security review requires this action.',
  confirmed: true as const,
};

describe('administrator account lifecycle service', () => {
  it('rejects direct super-administrator assignment before any database write', async () => {
    const transaction = vi.fn();
    const prisma = {
      $transaction: transaction,
      auditLog: { create: vi.fn() },
    } as unknown as PrismaService;
    const crypto = { randomToken: vi.fn() } as unknown as CryptoService;
    const service = new AdminAccountsService(prisma, crypto);

    await expect(
      service.create(
        {
          email: 'new-admin@example.test',
          displayName: 'New administrator',
          password: 'A-long-and-valid-password-123!',
          roleKeys: ['administrator', 'super-administrator'],
          confirmed: true,
        },
        'actor-id',
        request,
      ),
    ).rejects.toMatchObject({
      response: { code: 'SUPER_ADMINISTRATOR_ASSIGNMENT_REQUIRES_APPROVAL' },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('denies suspending the acting administrator before loading a target account', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'actor-id' });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'super-role-id' }]),
      user: {
        findFirst,
      },
    };
    const runTransaction = vi.fn((callback: (tx: typeof transaction) => unknown) =>
      Promise.resolve(callback(transaction)),
    );
    const auditCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      $transaction: runTransaction,
      auditLog: { create: auditCreate },
    } as unknown as PrismaService;
    const crypto = { randomToken: vi.fn() } as unknown as CryptoService;
    const service = new AdminAccountsService(prisma, crypto);

    await expect(
      service.suspend('actor-id', lifecycleInput, 'actor-id', request),
    ).rejects.toMatchObject({ response: { code: 'SELF_ADMIN_LIFECYCLE_FORBIDDEN' } });
    expect(findFirst).toHaveBeenCalledTimes(1);
    const recorded = auditCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(recorded.data).toMatchObject({
      action: 'admin.account.suspend',
      outcome: 'DENIED',
      errorCode: 'SELF_ADMIN_LIFECYCLE_FORBIDDEN',
    });
  });
});
