import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { CustomerAccountActionsService } from './customer-account-actions.service';

const request = {
  get: vi.fn().mockReturnValue('vitest'),
  ip: '127.0.0.1',
  socket: {},
  requestId: 'request-id',
} as unknown as Request;

describe('customer account lifecycle service', () => {
  it('suspends through the customer realm without revoking administrator sessions', async () => {
    const target = {
      id: 'customer-profile-id',
      firstName: 'Sami',
      lastName: 'Trabelsi',
      phoneE164: '+21620111222',
      suspendedAt: null,
      suspensionReason: null,
      version: 2,
      createdAt: new Date('2026-07-11T08:00:00.000Z'),
      user: {
        id: 'customer-user-id',
        email: 'sami@example.test',
        audience: 'CUSTOMER' as const,
        status: 'ACTIVE' as const,
        version: 3,
      },
    };
    const updated = {
      ...target,
      suspendedAt: new Date('2026-07-13T08:00:00.000Z'),
      suspensionReason: 'Confirmed account abuse investigation.',
      version: 3,
      user: { ...target.user, status: 'SUSPENDED' as const, version: 4 },
    };
    const sessionUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'super-role-id' }]),
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: 'actor-id' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      customerProfile: {
        findFirst: vi.fn().mockResolvedValue(target),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(updated),
      },
      session: { updateMany: sessionUpdate },
      verificationToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      passwordResetToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      securityEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const service = new CustomerAccountActionsService(prisma);

    await expect(
      service.suspend(
        target.id,
        {
          expectedUserVersion: 3,
          expectedProfileVersion: 2,
          reason: 'Confirmed account abuse investigation.',
          confirmed: true,
        },
        'actor-id',
        request,
      ),
    ).resolves.toMatchObject({
      data: { id: target.id, userId: target.user.id, status: 'SUSPENDED' },
    });
    expect(sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'customer-user-id',
          audience: 'CUSTOMER',
          status: 'ACTIVE',
        },
      }),
    );
  });
});
