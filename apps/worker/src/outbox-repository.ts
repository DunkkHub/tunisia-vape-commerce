import { Prisma, type OutboxEvent, type PrismaClient } from '@prisma/client';
import { exponentialRetryDelay } from './outbox-contracts.js';

const OUTBOX_SELECT = {
  id: true,
  deterministicKey: true,
  aggregateType: true,
  aggregateId: true,
  eventType: true,
  eventVersion: true,
  payload: true,
  status: true,
  availableAt: true,
  leaseOwner: true,
  leaseExpiresAt: true,
  attemptCount: true,
  maxAttempts: true,
} satisfies Prisma.OutboxEventSelect;

export type ClaimedOutboxEvent = Pick<
  OutboxEvent,
  | 'id'
  | 'deterministicKey'
  | 'aggregateType'
  | 'aggregateId'
  | 'eventType'
  | 'eventVersion'
  | 'payload'
  | 'status'
  | 'availableAt'
  | 'leaseOwner'
  | 'leaseExpiresAt'
  | 'attemptCount'
  | 'maxAttempts'
>;

interface RetryStateRow {
  id: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
}

export class OutboxRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly instanceId: string,
    private readonly batchSize: number,
    private readonly leaseMilliseconds: number,
    private readonly publishedLeaseMilliseconds: number,
    private readonly retryBaseMilliseconds: number,
    private readonly retryMaximumMilliseconds: number,
  ) {}

  async claimAvailable(now = new Date()): Promise<ClaimedOutboxEvent[]> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw(Prisma.sql`
          UPDATE \`OutboxEvent\`
          SET
            \`status\` = ${'DEAD_LETTER'},
            \`deadLetteredAt\` = ${now},
            \`safeErrorCode\` = COALESCE(\`safeErrorCode\`, ${'ATTEMPTS_EXHAUSTED'}),
            \`leaseOwner\` = NULL,
            \`leaseExpiresAt\` = NULL,
            \`updatedAt\` = ${now}
          WHERE
            \`status\` IN (${'PENDING'}, ${'LEASED'}, ${'PUBLISHED'}, ${'PROCESSING'}, ${'RETRY'})
            AND \`attemptCount\` >= \`maxAttempts\`
        `);

        // A blocking row lock works on the supported MySQL target and the older local rehearsal
        // database. Independent instances serialize briefly at claim time, then receive disjoint
        // batches after each READ COMMITTED transaction observes the preceding committed lease.
        // Every dynamic value remains a Prisma parameter; identifiers are static reviewed SQL.
        const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT \`id\`
          FROM \`OutboxEvent\`
          WHERE
            \`attemptCount\` < \`maxAttempts\`
            AND (
              (
                \`status\` IN (${'PENDING'}, ${'RETRY'})
                AND \`availableAt\` <= ${now}
              )
              OR (
                \`status\` IN (${'LEASED'}, ${'PUBLISHED'}, ${'PROCESSING'})
                AND \`leaseExpiresAt\` IS NOT NULL
                AND \`leaseExpiresAt\` <= ${now}
              )
            )
          ORDER BY \`availableAt\` ASC, \`id\` ASC
          LIMIT ${this.batchSize}
          FOR UPDATE
        `);
        const ids = rows.map((row) => row.id);
        if (ids.length === 0) return [];
        const leaseExpiresAt = new Date(now.getTime() + this.leaseMilliseconds);
        await transaction.outboxEvent.updateMany({
          where: { id: { in: ids } },
          data: {
            status: 'LEASED',
            leaseOwner: this.instanceId,
            leaseExpiresAt,
            attemptCount: { increment: 1 },
            lastAttemptAt: now,
            safeErrorCode: null,
          },
        });
        return transaction.outboxEvent.findMany({
          where: { id: { in: ids }, status: 'LEASED', leaseOwner: this.instanceId },
          orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
          select: OUTBOX_SELECT,
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  }

  async markPublished(eventId: string, jobId: string, now = new Date()): Promise<boolean> {
    const updated = await this.prisma.outboxEvent.updateMany({
      where: { id: eventId, status: 'LEASED', leaseOwner: this.instanceId },
      data: {
        status: 'PUBLISHED',
        publishedAt: now,
        publishedJobId: jobId,
        leaseExpiresAt: new Date(now.getTime() + this.publishedLeaseMilliseconds),
      },
    });
    return updated.count === 1;
  }

  async scheduleRetry(
    eventId: string,
    errorCode: string,
    now = new Date(),
  ): Promise<'RETRY' | 'DEAD_LETTER' | 'TERMINAL' | 'MISSING'> {
    return this.prisma.$transaction(
      async (transaction) => {
        const rows = await transaction.$queryRaw<RetryStateRow[]>(Prisma.sql`
          SELECT \`id\`, \`status\`, \`attemptCount\`, \`maxAttempts\`
          FROM \`OutboxEvent\`
          WHERE \`id\` = ${eventId}
          FOR UPDATE
        `);
        const event = rows[0];
        if (!event) return 'MISSING';
        if (['PROCESSED', 'DEAD_LETTER', 'CANCELLED'].includes(event.status)) return 'TERMINAL';
        if (event.attemptCount >= event.maxAttempts) {
          await transaction.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: 'DEAD_LETTER',
              deadLetteredAt: now,
              safeErrorCode: errorCode.slice(0, 100),
              leaseOwner: null,
              leaseExpiresAt: null,
            },
          });
          return 'DEAD_LETTER';
        }
        const retryDelay = exponentialRetryDelay(
          event.attemptCount,
          this.retryBaseMilliseconds,
          this.retryMaximumMilliseconds,
        );
        await transaction.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'RETRY',
            availableAt: new Date(now.getTime() + retryDelay),
            safeErrorCode: errorCode.slice(0, 100),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        return 'RETRY';
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  }
}
