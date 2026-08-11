import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AuditOutcome,
  AuthAudience,
  CashDiscrepancyStatus,
  DeliveryStatus,
  LoginAttemptResult,
  OutboxEventStatus,
  SecuritySeverity,
  SystemHealthStatus,
} from '@prisma/client';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';

const SIGNAL_WINDOW_MINUTES = 15;

const FAILED_LOGIN_RESULTS = [
  'INVALID_CREDENTIALS',
  'LOCKED',
  'SUSPENDED',
  'TWO_FACTOR_FAILED',
  'RATE_LIMITED',
  'IP_RESTRICTED',
] as const satisfies readonly LoginAttemptResult[];

const ADMIN_SECURITY_SEVERITIES = [
  'HIGH',
  'CRITICAL',
] as const satisfies readonly SecuritySeverity[];

const FAILED_AUDIT_OUTCOMES = ['FAILURE', 'DENIED'] as const satisfies readonly AuditOutcome[];

const TERMINAL_DELIVERY_STATUSES = [
  'DELIVERED',
  'RETURNED',
  'CANCELLED',
] as const satisfies readonly DeliveryStatus[];

const ACTIONABLE_CASH_DISCREPANCY_STATUSES = [
  'OPEN',
  'INVESTIGATING',
] as const satisfies readonly CashDiscrepancyStatus[];

const PASSWORD_RESET_ACTION_PREFIX = 'auth.customer.password_reset';
const PASSWORD_RESET_REQUEST_ACTIONS = new Set([
  'auth.customer.password_reset.request',
  'auth.customer.password_reset.provider_guidance',
]);

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

interface CountedMetricRow {
  _count: true | { _all?: number } | undefined;
}

const safeCount = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ServiceUnavailableException({
      code: 'OPERATIONAL_METRIC_OUT_OF_RANGE',
      message: 'An operational metric cannot be represented safely.',
    });
  }
  return value;
};

const rowCount = (row: CountedMetricRow): number => {
  if (typeof row._count !== 'object' || typeof row._count._all !== 'number') {
    throw new ServiceUnavailableException({
      code: 'OPERATIONAL_METRIC_UNAVAILABLE',
      message: 'An operational metric could not be read safely.',
    });
  }
  return safeCount(row._count._all);
};

const aggregateMetric = <TRow extends CountedMetricRow>(
  rows: readonly TRow[],
  asOf: Date,
  oldestValue: (row: TRow) => Date | null | undefined,
) => {
  let count = 0;
  let oldestAt: Date | null = null;
  for (const row of rows) {
    const currentCount = rowCount(row);
    count = safeCount(count + currentCount);
    const candidate = oldestValue(row);
    if (currentCount > 0 && !candidate) {
      throw new ServiceUnavailableException({
        code: 'OPERATIONAL_METRIC_UNAVAILABLE',
        message: 'An operational metric could not be read safely.',
      });
    }
    if (candidate && (!oldestAt || candidate.getTime() < oldestAt.getTime())) {
      oldestAt = candidate;
    }
  }
  if (!oldestAt) return { count, oldestAt: null, oldestAgeSeconds: null };
  const oldestAgeSeconds = safeCount(
    Math.max(0, Math.floor((asOf.getTime() - oldestAt.getTime()) / 1_000)),
  );
  return { count, oldestAt: oldestAt.toISOString(), oldestAgeSeconds };
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
    counts[row.status] = rowCount(row);
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
    const signalWindowStartedAt = new Date(asOf.getTime() - SIGNAL_WINDOW_MINUTES * 60 * 1_000);
    const activeOutboxStatuses: OutboxEventStatus[] = ['PENDING', 'RETRY'];
    const leasedOutboxStatuses: OutboxEventStatus[] = ['LEASED', 'PUBLISHED', 'PROCESSING'];
    const [
      outboxRows,
      actionableBacklog,
      scheduledBacklog,
      expiredLeases,
      oldestActionable,
      workerHeartbeat,
      failedLoginRows,
      passwordResetRows,
      adminSecurityEventRows,
      activeDeliveryBacklog,
      cashDiscrepancyRows,
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
      this.prisma.loginAttempt.groupBy({
        by: ['audience'],
        where: {
          occurredAt: { gte: signalWindowStartedAt, lte: asOf },
          result: { in: [...FAILED_LOGIN_RESULTS] },
        },
        orderBy: { audience: 'asc' },
        _count: { _all: true },
        _min: { occurredAt: true },
      }),
      this.prisma.auditLog.groupBy({
        by: ['action', 'outcome'],
        where: {
          occurredAt: { gte: signalWindowStartedAt, lte: asOf },
          action: { startsWith: PASSWORD_RESET_ACTION_PREFIX },
        },
        orderBy: [{ action: 'asc' }, { outcome: 'asc' }],
        _count: { _all: true },
        _min: { occurredAt: true },
      }),
      this.prisma.securityEvent.groupBy({
        by: ['severity'],
        where: {
          occurredAt: { gte: signalWindowStartedAt, lte: asOf },
          severity: { in: [...ADMIN_SECURITY_SEVERITIES] },
          OR: [{ user: { is: { audience: 'ADMIN' } } }, { session: { is: { audience: 'ADMIN' } } }],
        },
        orderBy: { severity: 'asc' },
        _count: { _all: true },
        _min: { occurredAt: true },
      }),
      this.prisma.delivery.aggregate({
        where: { status: { notIn: [...TERMINAL_DELIVERY_STATUSES] } },
        _count: { _all: true },
        _min: { createdAt: true },
      }),
      this.prisma.cashDiscrepancy.groupBy({
        by: ['status'],
        where: { status: { in: [...ACTIONABLE_CASH_DISCREPANCY_STATUSES] } },
        orderBy: { status: 'asc' },
        _count: { _all: true },
        _min: { openedAt: true },
      }),
    ]);

    const outbox = statusCounts(OUTBOX_STATUSES, outboxRows);
    const maximumHeartbeatAgeSeconds = this.config.get('WORKER_HEARTBEAT_MAX_AGE_SECONDS', {
      infer: true,
    });
    const worker = workerSnapshot(workerHeartbeat, asOf, maximumHeartbeatAgeSeconds);
    const metricForAudience = (audience: AuthAudience) =>
      aggregateMetric(
        failedLoginRows.filter((row) => row.audience === audience),
        asOf,
        (row) => row._min?.occurredAt,
      );
    const passwordResetRequests = aggregateMetric(
      passwordResetRows.filter(
        (row) => row.outcome === 'SUCCESS' && PASSWORD_RESET_REQUEST_ACTIONS.has(row.action),
      ),
      asOf,
      (row) => row._min?.occurredAt,
    );
    const passwordResetFailuresOrDenials = aggregateMetric(
      passwordResetRows.filter((row) =>
        FAILED_AUDIT_OUTCOMES.some((outcome) => outcome === row.outcome),
      ),
      asOf,
      (row) => row._min?.occurredAt,
    );
    const adminSecurityMetric = (severity?: SecuritySeverity) =>
      aggregateMetric(
        severity
          ? adminSecurityEventRows.filter((row) => row.severity === severity)
          : adminSecurityEventRows,
        asOf,
        (row) => row._min?.occurredAt,
      );
    const cashDiscrepancyMetric = (status?: CashDiscrepancyStatus) =>
      aggregateMetric(
        status ? cashDiscrepancyRows.filter((row) => row.status === status) : cashDiscrepancyRows,
        asOf,
        (row) => row._min?.openedAt,
      );

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
        signals: {
          windowMinutes: SIGNAL_WINDOW_MINUTES,
          windowStartedAt: signalWindowStartedAt.toISOString(),
          authentication: {
            failedCustomerLogins: metricForAudience('CUSTOMER'),
            failedAdminLogins: metricForAudience('ADMIN'),
            passwordResetRequests,
            passwordResetFailuresOrDenials,
          },
          adminSecurityEvents: {
            high: adminSecurityMetric('HIGH'),
            critical: adminSecurityMetric('CRITICAL'),
            totalHighOrCritical: adminSecurityMetric(),
          },
        },
        delivery: {
          activeBacklog: aggregateMetric(
            [activeDeliveryBacklog],
            asOf,
            (row) => row._min.createdAt,
          ),
        },
        cashOnDelivery: {
          openDiscrepancies: cashDiscrepancyMetric('OPEN'),
          investigatingDiscrepancies: cashDiscrepancyMetric('INVESTIGATING'),
          totalActionableDiscrepancies: cashDiscrepancyMetric(),
        },
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
          signalWindow:
            'Authentication and administrator security signals are aggregate durable-event counts from the trailing 15 minutes.',
          failedLoginAttempts:
            'Failures exclude successful logins and the expected administrator TWO_FACTOR_REQUIRED challenge state.',
          passwordResetSignals:
            'Requests include enumeration-safe reset and provider-guidance audit outcomes; failures or denials include rejected reset attempts.',
          adminSecurityEvents:
            'Only HIGH or CRITICAL security events linked to the administrator authentication realm are counted.',
          activeDeliveryBacklog:
            'Current non-terminal deliveries, including return-to-sender work that has not reached a terminal state.',
          actionableCashDiscrepancies:
            'Current OPEN or INVESTIGATING cash discrepancies requiring reconciliation.',
          privacy:
            'Operational signals contain aggregate counts and ages only; no user, customer, request, session, order or delivery identifiers are returned.',
          lowStock:
            'Low-stock metrics remain available from the administrator dashboard and are not recalculated by this endpoint.',
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
