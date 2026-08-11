import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

const config = {
  get: vi.fn((key: string) => {
    if (key === 'HEALTHCHECK_TIMEOUT_MS') return 1_000;
    if (key === 'WORKER_HEARTBEAT_MAX_AGE_SECONDS') return 60;
    if (key === 'EXPECTED_MIGRATION_NAME') return '20260811170000_product_image_renditions';
    return undefined;
  }),
};

const readyPrisma = (heartbeat = new Date()) => ({
  $queryRaw: vi
    .fn()
    .mockResolvedValueOnce([{ ok: 1 }])
    .mockResolvedValueOnce([{ finishedAt: new Date(), rolledBackAt: null }])
    .mockResolvedValueOnce([{ count: 0n }]),
  systemHealthRecord: {
    findFirst: vi.fn().mockResolvedValue({ checkedAt: heartbeat }),
  },
});

describe('health readiness', () => {
  it('keeps liveness process-only', () => {
    const health = { ready: vi.fn() };
    const controller = new HealthController(health as never);
    expect(controller.live().status).toBe('ok');
    expect(health.ready).not.toHaveBeenCalled();
  });

  it('reports ready only when MySQL, Redis, worker heartbeat and migrations are healthy', async () => {
    const prisma = readyPrisma();
    const redis = { ping: vi.fn().mockResolvedValue(undefined) };
    const service = new HealthService(prisma as never, redis as never, config as never);

    await expect(service.ready()).resolves.toMatchObject({
      status: 'ready',
      checks: { mysql: 'up', redis: 'up', worker: 'up', migrations: 'up' },
    });
  });

  it('fails safely with named statuses when the worker heartbeat is stale', async () => {
    const prisma = readyPrisma(new Date(Date.now() - 120_000));
    const redis = { ping: vi.fn().mockResolvedValue(undefined) };
    const service = new HealthService(prisma as never, redis as never, config as never);

    const error = await service.ready().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error).toMatchObject({
      response: {
        code: 'DEPENDENCY_UNAVAILABLE',
        checks: { mysql: 'up', redis: 'up', worker: 'down', migrations: 'up' },
      },
    });
  });

  it('does not expose dependency errors when Redis and the expected migration are unavailable', async () => {
    const prisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ ok: 1 }])
        .mockResolvedValueOnce([]),
      systemHealthRecord: { findFirst: vi.fn().mockResolvedValue({ checkedAt: new Date() }) },
    };
    const redis = { ping: vi.fn().mockRejectedValue(new Error('redis://secret-host')) };
    const service = new HealthService(prisma as never, redis as never, config as never);

    const error = await service.ready().catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      response: {
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'A required dependency is unavailable.',
        checks: { mysql: 'up', redis: 'down', worker: 'up', migrations: 'down' },
      },
    });
    expect(JSON.stringify(error)).not.toContain('secret-host');
  });
});
