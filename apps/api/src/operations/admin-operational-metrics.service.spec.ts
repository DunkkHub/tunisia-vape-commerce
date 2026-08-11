import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Environment } from '../config/environment';
import type { PrismaService } from '../database/prisma.service';
import { AdminOperationalMetricsService } from './admin-operational-metrics.service';

const config = {
  get: vi.fn().mockReturnValue(60),
} as unknown as ConfigService<Environment, true>;

const transaction = vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations));

const emptyOperationalSignalModels = () => ({
  loginAttempt: { groupBy: vi.fn().mockResolvedValue([]) },
  auditLog: { groupBy: vi.fn().mockResolvedValue([]) },
  securityEvent: { groupBy: vi.fn().mockResolvedValue([]) },
  delivery: {
    aggregate: vi.fn().mockResolvedValue({
      _count: { _all: 0 },
      _min: { createdAt: null },
    }),
  },
  cashDiscrepancy: { groupBy: vi.fn().mockResolvedValue([]) },
});

describe('AdminOperationalMetricsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns bounded privacy-safe operational, outbox, and worker metrics', async () => {
    const outboxGroupBy = vi.fn().mockResolvedValue([
      { status: 'PENDING', _count: { _all: 4 } },
      { status: 'RETRY', _count: { _all: 2 } },
      { status: 'PROCESSED', _count: { _all: 100 } },
      { status: 'DEAD_LETTER', _count: { _all: 1 } },
    ]);
    const outboxCount = vi
      .fn()
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    const oldest = vi.fn().mockResolvedValue({
      availableAt: new Date('2026-07-20T11:58:30.000Z'),
    });
    const workerFindFirst = vi.fn().mockResolvedValue({
      status: 'HEALTHY',
      latencyMs: 7,
      checkedAt: new Date('2026-07-20T11:59:45.000Z'),
    });
    const loginAttemptGroupBy = vi.fn().mockResolvedValue([
      {
        audience: 'CUSTOMER',
        _count: { _all: 6 },
        _min: { occurredAt: new Date('2026-07-20T11:57:00.000Z') },
      },
      {
        audience: 'ADMIN',
        _count: { _all: 3 },
        _min: { occurredAt: new Date('2026-07-20T11:59:00.000Z') },
      },
    ]);
    const auditLogGroupBy = vi.fn().mockResolvedValue([
      {
        action: 'auth.customer.password_reset.request',
        outcome: 'SUCCESS',
        _count: { _all: 8 },
        _min: { occurredAt: new Date('2026-07-20T11:50:00.000Z') },
      },
      {
        action: 'auth.customer.password_reset.provider_guidance',
        outcome: 'SUCCESS',
        _count: { _all: 2 },
        _min: { occurredAt: new Date('2026-07-20T11:55:00.000Z') },
      },
      {
        action: 'auth.customer.password_reset',
        outcome: 'DENIED',
        _count: { _all: 4 },
        _min: { occurredAt: new Date('2026-07-20T11:58:00.000Z') },
      },
    ]);
    const securityEventGroupBy = vi.fn().mockResolvedValue([
      {
        severity: 'HIGH',
        _count: { _all: 2 },
        _min: { occurredAt: new Date('2026-07-20T11:53:00.000Z') },
      },
      {
        severity: 'CRITICAL',
        _count: { _all: 1 },
        _min: { occurredAt: new Date('2026-07-20T11:59:30.000Z') },
      },
    ]);
    const deliveryAggregate = vi.fn().mockResolvedValue({
      _count: { _all: 7 },
      _min: { createdAt: new Date('2026-07-20T09:00:00.000Z') },
    });
    const cashDiscrepancyGroupBy = vi.fn().mockResolvedValue([
      {
        status: 'OPEN',
        _count: { _all: 3 },
        _min: { openedAt: new Date('2026-07-20T10:00:00.000Z') },
      },
      {
        status: 'INVESTIGATING',
        _count: { _all: 2 },
        _min: { openedAt: new Date('2026-07-20T11:00:00.000Z') },
      },
    ]);
    const prisma = {
      outboxEvent: { groupBy: outboxGroupBy, count: outboxCount, findFirst: oldest },
      systemHealthRecord: { findFirst: workerFindFirst },
      loginAttempt: { groupBy: loginAttemptGroupBy },
      auditLog: { groupBy: auditLogGroupBy },
      securityEvent: { groupBy: securityEventGroupBy },
      delivery: { aggregate: deliveryAggregate },
      cashDiscrepancy: { groupBy: cashDiscrepancyGroupBy },
      $transaction: transaction,
    } as unknown as PrismaService;

    const result = await new AdminOperationalMetricsService(prisma, config).snapshot();

    expect(result.data).toMatchObject({
      asOf: '2026-07-20T12:00:00.000Z',
      outbox: {
        PENDING: 4,
        LEASED: 0,
        RETRY: 2,
        PROCESSED: 100,
        DEAD_LETTER: 1,
        actionableBacklog: 5,
        scheduledBacklog: 1,
        expiredLeases: 2,
        oldestActionableAvailableAt: '2026-07-20T11:58:30.000Z',
        oldestActionableAgeSeconds: 90,
      },
      worker: {
        state: 'HEALTHY',
        status: 'HEALTHY',
        checkedAt: '2026-07-20T11:59:45.000Z',
        ageSeconds: 15,
        latencyMs: 7,
        maximumAgeSeconds: 60,
      },
      signals: {
        windowMinutes: 15,
        windowStartedAt: '2026-07-20T11:45:00.000Z',
        authentication: {
          failedCustomerLogins: {
            count: 6,
            oldestAt: '2026-07-20T11:57:00.000Z',
            oldestAgeSeconds: 180,
          },
          failedAdminLogins: {
            count: 3,
            oldestAt: '2026-07-20T11:59:00.000Z',
            oldestAgeSeconds: 60,
          },
          passwordResetRequests: {
            count: 10,
            oldestAt: '2026-07-20T11:50:00.000Z',
            oldestAgeSeconds: 600,
          },
          passwordResetFailuresOrDenials: {
            count: 4,
            oldestAt: '2026-07-20T11:58:00.000Z',
            oldestAgeSeconds: 120,
          },
        },
        adminSecurityEvents: {
          high: {
            count: 2,
            oldestAt: '2026-07-20T11:53:00.000Z',
            oldestAgeSeconds: 420,
          },
          critical: {
            count: 1,
            oldestAt: '2026-07-20T11:59:30.000Z',
            oldestAgeSeconds: 30,
          },
          totalHighOrCritical: {
            count: 3,
            oldestAt: '2026-07-20T11:53:00.000Z',
            oldestAgeSeconds: 420,
          },
        },
      },
      delivery: {
        activeBacklog: {
          count: 7,
          oldestAt: '2026-07-20T09:00:00.000Z',
          oldestAgeSeconds: 10_800,
        },
      },
      cashOnDelivery: {
        openDiscrepancies: {
          count: 3,
          oldestAt: '2026-07-20T10:00:00.000Z',
          oldestAgeSeconds: 7_200,
        },
        investigatingDiscrepancies: {
          count: 2,
          oldestAt: '2026-07-20T11:00:00.000Z',
          oldestAgeSeconds: 3_600,
        },
        totalActionableDiscrepancies: {
          count: 5,
          oldestAt: '2026-07-20T10:00:00.000Z',
          oldestAgeSeconds: 7_200,
        },
      },
    });
    expect(outboxCount).toHaveBeenNthCalledWith(1, {
      where: {
        status: { in: ['PENDING', 'RETRY'] },
        availableAt: { lte: new Date('2026-07-20T12:00:00.000Z') },
      },
    });
    expect(outboxCount).toHaveBeenNthCalledWith(3, {
      where: {
        status: { in: ['LEASED', 'PUBLISHED', 'PROCESSING'] },
        leaseExpiresAt: { not: null, lt: new Date('2026-07-20T12:00:00.000Z') },
      },
    });
    expect(workerFindFirst).toHaveBeenCalledWith({
      where: { component: 'durable-outbox-worker' },
      orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
      select: { status: true, latencyMs: true, checkedAt: true },
    });
    expect(loginAttemptGroupBy).toHaveBeenCalledWith({
      by: ['audience'],
      where: {
        occurredAt: {
          gte: new Date('2026-07-20T11:45:00.000Z'),
          lte: new Date('2026-07-20T12:00:00.000Z'),
        },
        result: {
          in: [
            'INVALID_CREDENTIALS',
            'LOCKED',
            'SUSPENDED',
            'TWO_FACTOR_FAILED',
            'RATE_LIMITED',
            'IP_RESTRICTED',
          ],
        },
      },
      orderBy: { audience: 'asc' },
      _count: { _all: true },
      _min: { occurredAt: true },
    });
    expect(auditLogGroupBy).toHaveBeenCalledTimes(1);
    expect(auditLogGroupBy).toHaveBeenCalledWith({
      by: ['action', 'outcome'],
      where: {
        occurredAt: {
          gte: new Date('2026-07-20T11:45:00.000Z'),
          lte: new Date('2026-07-20T12:00:00.000Z'),
        },
        action: { startsWith: 'auth.customer.password_reset' },
      },
      orderBy: [{ action: 'asc' }, { outcome: 'asc' }],
      _count: { _all: true },
      _min: { occurredAt: true },
    });
    expect(securityEventGroupBy).toHaveBeenCalledWith({
      by: ['severity'],
      where: {
        occurredAt: {
          gte: new Date('2026-07-20T11:45:00.000Z'),
          lte: new Date('2026-07-20T12:00:00.000Z'),
        },
        severity: { in: ['HIGH', 'CRITICAL'] },
        OR: [{ user: { is: { audience: 'ADMIN' } } }, { session: { is: { audience: 'ADMIN' } } }],
      },
      orderBy: { severity: 'asc' },
      _count: { _all: true },
      _min: { occurredAt: true },
    });
    expect(deliveryAggregate).toHaveBeenCalledWith({
      where: {
        status: {
          notIn: ['DELIVERED', 'RETURNED', 'CANCELLED'],
        },
      },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    expect(cashDiscrepancyGroupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { status: { in: ['OPEN', 'INVESTIGATING'] } },
      orderBy: { status: 'asc' },
      _count: { _all: true },
      _min: { openedAt: true },
    });
    expect(JSON.stringify(result.data)).not.toMatch(
      /userId|customerId|identifierHash|ipAddress|requestId|sessionId/u,
    );
  });

  it.each([
    [null, 'MISSING'],
    [
      {
        status: 'HEALTHY',
        latencyMs: null,
        checkedAt: new Date('2026-07-20T11:58:00.000Z'),
      },
      'STALE',
    ],
    [
      {
        status: 'DEGRADED',
        latencyMs: 40,
        checkedAt: new Date('2026-07-20T11:59:45.000Z'),
      },
      'UNHEALTHY',
    ],
  ])(
    'classifies the latest worker heartbeat without exposing instance details',
    async (heartbeat, state) => {
      const prisma = {
        outboxEvent: {
          groupBy: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0),
          findFirst: vi.fn().mockResolvedValue(null),
        },
        systemHealthRecord: { findFirst: vi.fn().mockResolvedValue(heartbeat) },
        ...emptyOperationalSignalModels(),
        $transaction: transaction,
      } as unknown as PrismaService;

      const result = await new AdminOperationalMetricsService(prisma, config).snapshot();

      expect(result.data.worker.state).toBe(state);
      expect(result.data.worker).not.toHaveProperty('instanceId');
    },
  );

  it('fails closed if a database count cannot be represented safely', async () => {
    const prisma = {
      outboxEvent: {
        groupBy: vi
          .fn()
          .mockResolvedValue([
            { status: 'PENDING', _count: { _all: Number.MAX_SAFE_INTEGER + 1 } },
          ]),
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      systemHealthRecord: { findFirst: vi.fn().mockResolvedValue(null) },
      ...emptyOperationalSignalModels(),
      $transaction: transaction,
    } as unknown as PrismaService;

    await expect(
      new AdminOperationalMetricsService(prisma, config).snapshot(),
    ).rejects.toMatchObject({ response: { code: 'OPERATIONAL_METRIC_OUT_OF_RANGE' } });
  });

  it('fails closed if a privacy-safe signal count exceeds the safe integer range', async () => {
    const prisma = {
      outboxEvent: {
        groupBy: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      systemHealthRecord: { findFirst: vi.fn().mockResolvedValue(null) },
      ...emptyOperationalSignalModels(),
      loginAttempt: {
        groupBy: vi.fn().mockResolvedValue([
          {
            audience: 'ADMIN',
            _count: { _all: Number.MAX_SAFE_INTEGER + 1 },
            _min: { occurredAt: new Date('2026-07-20T11:59:00.000Z') },
          },
        ]),
      },
      $transaction: transaction,
    } as unknown as PrismaService;

    await expect(
      new AdminOperationalMetricsService(prisma, config).snapshot(),
    ).rejects.toMatchObject({ response: { code: 'OPERATIONAL_METRIC_OUT_OF_RANGE' } });
  });
});
