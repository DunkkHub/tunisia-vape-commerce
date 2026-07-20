import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OutboxEventStatus, SystemHealthStatus } from '@prisma/client';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';

const OUTBOX_STATUSES = [
  'PENDING',
  'LEASED',
  'PUBLISHED',
  'PROCESSING',
  'RETRY',
  'PROCESSED',
  'DEAD_LETTER',
  'CANCELLED',
] as const satisfies readonly OutboxEventStatus[];

type CountByStatus<TStatus extends string> = Array<{
  status: TStatus;
  _count: true | { _all?: number } | undefined;
}>;

const safeCount = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ServiceUnavailableException({
      code: 'OPERATIONAL_METRIC_OUT_OF_RANGE',
      message: 'An operational metric cannot be represented safely.',
    });
  }
  return value;
};

const statusCounts = <TStatus extends string>(
  statuses: readonly TStatus[],
  rows: CountByStatus<TStatus>,
): Record<TStatus, number> => {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<
    TStatus,
    number
  >;
  for (const row of rows) {
    if (typeof row._count !== 'object' || typeof row._count._all !== 'number') {
      throw new ServiceUnavailableException({
        code: 'OPERATIONAL_METRIC_UNAVAILABLE',
        message: 'An operational metric could not be read safely.',
      });
    }
    counts[row.status] = safeCount(row._count._all);
  }
  return counts;
};

@Injectable()
export class AdminOperationalMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async snapshot() {
    const asOf = new Date();
    const activeOutboxStatuses: OutboxEventStatus[] = ['PENDING', 'RETRY'];
    const leasedOutboxStatuses: OutboxEventStatus[] = ['LEASED', 'PUBLISHED', 'PROCESSING'];
    const [
      outboxRows,
      actionableBacklog,
      scheduledBacklog,
      expiredLeases,
      oldestActionable,
      workerHeartbeat,
    ] = await this.prisma.$transaction([
      this.prisma.outboxEvent.groupBy({
        by: ['status'],
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.outboxEvent.count({
        where: { status: { in: activeOutboxStatuses }, availableAt: { lte: asOf } },
      }),
      this.prisma.outboxEvent.count({
        where: { status: { in: activeOutboxStatuses }, availableAt: { gt: asOf } },
      }),
      this.prisma.outboxEvent.count({
        where: {
          status: { in: leasedOutboxStatuses },
          leaseExpiresAt: { not: null, lt: asOf },
        },
      }),
      this.prisma.outboxEvent.findFirst({
        where: { status: { in: activeOutboxStatuses }, availableAt: { lte: asOf } },
        orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
        select: { availableAt: true },
      }),
      this.prisma.systemHealthRecord.findFirst({
        where: { component: 'durable-outbox-worker' },
        orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
        select: { status: true, latencyMs: true, checkedAt: true },
      }),
    ]);

    const outbox = statusCounts(OUTBOX_STATUSES, outboxRows);
    const maximumHeartbeatAgeSeconds = this.config.get('WORKER_HEARTBEAT_MAX_AGE_SECONDS', {
      infer: true,
    });
    const worker = workerSnapshot(workerHeartbeat, asOf, maximumHeartbeatAgeSeconds);

    return {
      data: {
        asOf: asOf.toISOString(),
        outbox: {
          ...outbox,
          actionableBacklog: safeCount(actionableBacklog),
          scheduledBacklog: safeCount(scheduledBacklog),
          expiredLeases: safeCount(expiredLeases),
          oldestActionableAvailableAt: oldestActionable?.availableAt.toISOString() ?? null,
          oldestActionableAgeSeconds: oldestActionable
            ? Math.max(
                0,
                Math.floor((asOf.getTime() - oldestActionable.availableAt.getTime()) / 1_000),
              )
            : null,
        },
        worker,
        definitions: {
          actionableBacklog:
            'PENDING or RETRY outbox events whose availableAt timestamp is not in the future.',
          scheduledBacklog:
            'PENDING or RETRY outbox events intentionally scheduled for a future availableAt.',
          expiredLeases:
            'LEASED, PUBLISHED or PROCESSING outbox events whose recovery lease has expired.',
          workerState:
            'Fresh only when the latest durable worker heartbeat is HEALTHY and inside the configured maximum age.',
          queueAuthority:
            'The MySQL outbox is the durable job authority; Redis/BullMQ is rebuildable transport.',
        },
      },
    };
  }
}

interface WorkerHeartbeat {
  status: SystemHealthStatus;
  latencyMs: number | null;
  checkedAt: Date;
}

const workerSnapshot = (
  heartbeat: WorkerHeartbeat | null,
  asOf: Date,
  maximumAgeSeconds: number,
) => {
  if (!heartbeat) {
    return {
      state: 'MISSING' as const,
      status: null,
      checkedAt: null,
      ageSeconds: null,
      latencyMs: null,
      maximumAgeSeconds,
    };
  }
  const ageMilliseconds = asOf.getTime() - heartbeat.checkedAt.getTime();
  const ageSeconds = Math.floor(ageMilliseconds / 1_000);
  const fresh = ageMilliseconds >= 0 && ageMilliseconds <= maximumAgeSeconds * 1_000;
  return {
    state: fresh
      ? heartbeat.status === 'HEALTHY'
        ? ('HEALTHY' as const)
        : ('UNHEALTHY' as const)
      : ('STALE' as const),
    status: heartbeat.status,
    checkedAt: heartbeat.checkedAt.toISOString(),
    ageSeconds,
    latencyMs: heartbeat.latencyMs,
    maximumAgeSeconds,
  };
};
