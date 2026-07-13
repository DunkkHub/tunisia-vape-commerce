import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const booleanFromEnvironment = z.enum(['true', 'false']).transform((value) => value === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.url().default('redis://localhost:6379'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    WORKER_INSTANCE_ID: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[A-Za-z0-9._-]+$/)
      .optional(),
    OUTBOX_QUEUE_NAME: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._-]+$/)
      .default('durable-outbox'),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(1_000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
    OUTBOX_LEASE_MS: z.coerce.number().int().min(5_000).max(300_000).default(30_000),
    OUTBOX_PUBLISHED_LEASE_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(900_000),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),
    OUTBOX_RETRY_BASE_MS: z.coerce.number().int().min(250).max(60_000).default(1_000),
    OUTBOX_RETRY_MAX_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),
    OUTBOX_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
    WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(5_000).max(300_000).default(15_000),
    RESERVATION_EXPIRY_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(3_600_000)
      .default(60_000),
    RESERVATION_EXPIRY_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(100),
    NOTIFICATION_BRIDGE_ENABLED: booleanFromEnvironment.default(true),
    NOTIFICATION_ADAPTER: z.enum(['console', 'disabled']).default('console'),
  })
  .superRefine((value, context) => {
    let database: URL;
    try {
      database = new URL(value.DATABASE_URL);
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL must be a valid URL.',
      });
      return;
    }
    if (database.protocol !== 'mysql:') {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL must use MySQL.',
      });
    }
    const redis = new URL(value.REDIS_URL);
    if (!['redis:', 'rediss:'].includes(redis.protocol)) {
      context.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'REDIS_URL must use redis or rediss.',
      });
    }
    if (redis.pathname.length > 1 && !/^\/\d+$/.test(redis.pathname)) {
      context.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'REDIS_URL database path must be numeric.',
      });
    }
    if (value.OUTBOX_RETRY_BASE_MS > value.OUTBOX_RETRY_MAX_MS) {
      context.addIssue({
        code: 'custom',
        path: ['OUTBOX_RETRY_BASE_MS'],
        message: 'Retry base must not exceed the retry maximum.',
      });
    }
    if (value.OUTBOX_PUBLISHED_LEASE_MS <= value.OUTBOX_LEASE_MS) {
      context.addIssue({
        code: 'custom',
        path: ['OUTBOX_PUBLISHED_LEASE_MS'],
        message: 'Published lease must exceed the processing lease.',
      });
    }
    if (value.NODE_ENV === 'production' && value.NOTIFICATION_ADAPTER === 'console') {
      context.addIssue({
        code: 'custom',
        path: ['NOTIFICATION_ADAPTER'],
        message: 'The console notification adapter is development-only.',
      });
    }
  });

export type WorkerEnvironment = Omit<z.infer<typeof schema>, 'WORKER_INSTANCE_ID'> & {
  WORKER_INSTANCE_ID: string;
};

export const parseWorkerEnvironment = (
  input: Record<string, string | undefined>,
): WorkerEnvironment => {
  const parsed = schema.parse(input);
  return {
    ...parsed,
    WORKER_INSTANCE_ID:
      parsed.WORKER_INSTANCE_ID ??
      `${hostname().replace(/[^A-Za-z0-9._-]/g, '_')}-${process.pid}-${randomBytes(4).toString('hex')}`,
  };
};

export const bullConnectionFromUrl = (value: string) => {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number.parseInt(url.port || '6379', 10),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.pathname.length > 1 ? { db: Number.parseInt(url.pathname.slice(1), 10) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
};
