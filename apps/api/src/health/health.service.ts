import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import { ReadinessRedisService } from './readiness-redis.service';

type CheckStatus = 'up' | 'down';
type ReadinessChecks = Record<'mysql' | 'redis' | 'worker' | 'migrations', CheckStatus>;

interface MigrationRow {
  finishedAt: Date | null;
  rolledBackAt: Date | null;
}

const withTimeout = async <T>(operation: Promise<T>, milliseconds: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Readiness timeout')), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: ReadinessRedisService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async ready() {
    const timeout = this.config.get('HEALTHCHECK_TIMEOUT_MS', { infer: true });
    const results = await Promise.allSettled([
      withTimeout(this.checkMysql(), timeout),
      withTimeout(this.redis.ping(), timeout),
      withTimeout(this.checkWorkerHeartbeat(), timeout),
      withTimeout(this.checkMigrations(), timeout),
    ]);
    const names = ['mysql', 'redis', 'worker', 'migrations'] as const;
    const checks = Object.fromEntries(
      names.map((name, index) => [name, results[index]?.status === 'fulfilled' ? 'up' : 'down']),
    ) as ReadinessChecks;
    const response = { status: 'ready' as const, checks, timestamp: new Date().toISOString() };
    if (Object.values(checks).some((status) => status === 'down')) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'A required dependency is unavailable.',
        checks,
      });
    }
    return response;
  }

  private async checkMysql(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  private async checkWorkerHeartbeat(): Promise<void> {
    const heartbeat = await this.prisma.systemHealthRecord.findFirst({
      where: { component: 'durable-outbox-worker', status: 'HEALTHY' },
      orderBy: { checkedAt: 'desc' },
      select: { checkedAt: true },
    });
    if (!heartbeat) throw new Error('Worker heartbeat missing');
    const maximumAge = this.config.get('WORKER_HEARTBEAT_MAX_AGE_SECONDS', { infer: true }) * 1_000;
    const age = Date.now() - heartbeat.checkedAt.getTime();
    if (age < -maximumAge || age > maximumAge) throw new Error('Worker heartbeat stale');
  }

  private async checkMigrations(): Promise<void> {
    const expected = this.config.get('EXPECTED_MIGRATION_NAME', { infer: true });
    const [migration] = await this.prisma.$queryRaw<MigrationRow[]>(Prisma.sql`
      SELECT
        \`finished_at\` AS \`finishedAt\`,
        \`rolled_back_at\` AS \`rolledBackAt\`
      FROM \`_prisma_migrations\`
      WHERE \`migration_name\` = ${expected}
      LIMIT 1
    `);
    if (!migration?.finishedAt || migration.rolledBackAt) {
      throw new Error('Expected migration is not applied');
    }
    const incomplete = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS \`count\`
      FROM \`_prisma_migrations\`
      WHERE \`finished_at\` IS NULL AND \`rolled_back_at\` IS NULL
    `);
    if ((incomplete[0]?.count ?? 1n) !== 0n) throw new Error('Incomplete migration exists');
  }
}
