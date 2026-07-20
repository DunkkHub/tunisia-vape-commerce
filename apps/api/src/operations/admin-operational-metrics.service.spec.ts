import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Environment } from '../config/environment';
import type { PrismaService } from '../database/prisma.service';
import { AdminOperationalMetricsService } from './admin-operational-metrics.service';

const config = {
  get: vi.fn().mockReturnValue(60),
} as unknown as ConfigService<Environment, true>;

const transaction = vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations));

describe('AdminOperationalMetricsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns bounded durable outbox, dead-letter, lease, and worker metrics', async () => {
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
    const prisma = {
      outboxEvent: { groupBy: outboxGroupBy, count: outboxCount, findFirst: oldest },
      systemHealthRecord: { findFirst: workerFindFirst },
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
      $transaction: transaction,
    } as unknown as PrismaService;

    await expect(
      new AdminOperationalMetricsService(prisma, config).snapshot(),
    ).rejects.toMatchObject({ response: { code: 'OPERATIONAL_METRIC_OUT_OF_RANGE' } });
  });
});
