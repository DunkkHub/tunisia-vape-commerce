import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../common/security/crypto.service';
import type { Environment } from '../config/environment';
import type { PrismaService } from '../database/prisma.service';
import type { AuthEventService } from './auth-event.service';
import { SessionService } from './session.service';

describe('SessionService authentication rotation', () => {
  it('revokes the previous same-realm cookie and links the replacement session', async () => {
    const transaction = {
      session: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'old-session',
          userId: 'customer-id',
          audience: 'CUSTOMER',
          status: 'ACTIVE',
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'new-session' }),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const crypto = {
      randomToken: vi.fn().mockReturnValueOnce('new-session-token').mockReturnValueOnce('new-csrf'),
      hashToken: vi.fn((value: string) => `hash:${value}`),
    } as unknown as CryptoService;
    const config = {
      get: vi.fn((key: keyof Environment) => {
        if (key === 'NODE_ENV') return 'test';
        if (key === 'CUSTOMER_SESSION_IDLE_MINUTES') return 60;
        if (key === 'CUSTOMER_SESSION_ABSOLUTE_MINUTES') return 120;
        return 30;
      }),
    } as unknown as ConfigService<Environment, true>;
    const request = {
      cookies: { vape_customer_session: 'old-session-token' },
      ip: '127.0.0.1',
      socket: {},
      get: vi.fn().mockReturnValue('vitest'),
    } as unknown as Request;
    const setCookie = vi.fn();
    const response = { cookie: setCookie } as unknown as Response;

    await new SessionService(prisma, crypto, config, {} as AuthEventService).issue(
      'customer-id',
      'CUSTOMER',
      false,
      request,
      response,
    );

    expect(transaction.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'old-session', audience: 'CUSTOMER', status: 'ACTIVE' },
      }),
    );
    expect(transaction.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        // Vitest's asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          rotatedFromId: 'old-session',
          userId: 'customer-id',
          audience: 'CUSTOMER',
        }),
      }),
    );
    expect(setCookie).toHaveBeenCalledTimes(2);
  });

  it('revokes but never links a previous session belonging to another customer', async () => {
    const transaction = {
      session: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'other-session',
          userId: 'other-customer',
          audience: 'CUSTOMER',
          status: 'ACTIVE',
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'new-session' }),
      },
    };
    const service = new SessionService(
      {
        $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
          callback(transaction),
        ),
      } as unknown as PrismaService,
      {
        randomToken: vi.fn().mockReturnValue('token'),
        hashToken: vi.fn((value: string) => `hash:${value}`),
      } as unknown as CryptoService,
      {
        get: vi.fn((key: keyof Environment) =>
          key === 'NODE_ENV' ? 'test' : key.includes('ABSOLUTE') ? 120 : 60,
        ),
      } as unknown as ConfigService<Environment, true>,
      {} as AuthEventService,
    );

    await service.issue(
      'new-customer',
      'CUSTOMER',
      false,
      {
        cookies: { vape_customer_session: 'other-token' },
        ip: '127.0.0.1',
        socket: {},
        get: vi.fn(),
      } as unknown as Request,
      { cookie: vi.fn() } as unknown as Response,
    );

    const create = transaction.session.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(create.data).not.toHaveProperty('rotatedFromId');
  });
});
