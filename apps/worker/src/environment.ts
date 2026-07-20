import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const booleanFromEnvironment = z.enum(['true', 'false']).transform((value) => value === 'true');
const notificationAdapterSchema = z.enum(['console', 'smtp', 'smtp-webhook', 'disabled']);

const addConfigurationIssue = (context: z.RefinementCtx, path: string, message: string): void => {
  context.addIssue({ code: 'custom', path: [path], message });
};

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.url().default('redis://localhost:6379'),
    WEB_URL: z.url().default('http://localhost:5173'),
    FIELD_ENCRYPTION_KEY: z.string().default(''),
    MEDIA_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    MEDIA_LOCAL_ROOT: z
      .string()
      .min(1)
      .max(1_024)
      .refine((value) => !value.includes('\0'), 'MEDIA_LOCAL_ROOT contains an invalid character')
      .default('uploads/media'),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).max(100).default('us-east-1'),
    S3_BUCKET: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/)
      .default('vape-store'),
    S3_ACCESS_KEY: z.string().min(1).max(512).optional(),
    S3_SECRET_KEY: z.string().min(1).max(1_024).optional(),
    S3_FORCE_PATH_STYLE: booleanFromEnvironment.default(true),
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
    NOTIFICATION_ADAPTER: notificationAdapterSchema.default('console'),
    SMS_ENABLED: booleanFromEnvironment.default(false),
    NOTIFICATION_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(250).max(30_000).default(5_000),
    NOTIFICATION_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(10_000),
    SMTP_HOST: z.string().trim().max(255).default(''),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
    SMTP_SECURE: booleanFromEnvironment.default(false),
    SMTP_REQUIRE_TLS: booleanFromEnvironment.default(false),
    SMTP_USER: z.string().max(512).default(''),
    SMTP_PASSWORD: z.string().max(4_096).default(''),
    EMAIL_FROM: z.string().trim().max(320).default(''),
    EMAIL_FROM_NAME: z.string().trim().max(120).default('Tunisia Vape Commerce'),
    SMS_WEBHOOK_URL: z.string().trim().max(2_048).default(''),
    SMS_WEBHOOK_AUTH_TOKEN: z.string().max(4_096).default(''),
    SMS_SENDER: z.string().trim().min(1).max(32).default('TunisiaVape'),
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
    if (Boolean(value.S3_ACCESS_KEY) !== Boolean(value.S3_SECRET_KEY)) {
      addConfigurationIssue(
        context,
        value.S3_ACCESS_KEY ? 'S3_SECRET_KEY' : 'S3_ACCESS_KEY',
        'S3 access and secret keys must be configured together.',
      );
    }
    if (value.OUTBOX_PUBLISHED_LEASE_MS <= value.OUTBOX_LEASE_MS) {
      context.addIssue({
        code: 'custom',
        path: ['OUTBOX_PUBLISHED_LEASE_MS'],
        message: 'Published lease must exceed the processing lease.',
      });
    }
    if (
      ['smtp', 'smtp-webhook'].includes(value.NOTIFICATION_ADAPTER) &&
      value.OUTBOX_LEASE_MS <
        value.NOTIFICATION_CONNECT_TIMEOUT_MS + value.NOTIFICATION_REQUEST_TIMEOUT_MS + 1_000
    ) {
      addConfigurationIssue(
        context,
        'OUTBOX_LEASE_MS',
        'OUTBOX_LEASE_MS must exceed the configured notification provider timeout budget.',
      );
    }
    const smtpEnabled = ['smtp', 'smtp-webhook'].includes(value.NOTIFICATION_ADAPTER);
    if (smtpEnabled) {
      if (!value.SMTP_HOST) {
        addConfigurationIssue(context, 'SMTP_HOST', 'SMTP_HOST is required for email delivery.');
      }
      if (!z.email().safeParse(value.EMAIL_FROM).success) {
        addConfigurationIssue(context, 'EMAIL_FROM', 'EMAIL_FROM must be a valid email address.');
      }
      if (!value.FIELD_ENCRYPTION_KEY || value.FIELD_ENCRYPTION_KEY.length < 16) {
        addConfigurationIssue(
          context,
          'FIELD_ENCRYPTION_KEY',
          'FIELD_ENCRYPTION_KEY must contain at least 16 characters for notification delivery.',
        );
      }
      if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD)) {
        addConfigurationIssue(
          context,
          'SMTP_USER',
          'SMTP_USER and SMTP_PASSWORD must be configured together.',
        );
      }
    }

    if (value.SMS_ENABLED && value.NOTIFICATION_ADAPTER !== 'smtp-webhook') {
      addConfigurationIssue(
        context,
        'NOTIFICATION_ADAPTER',
        'SMS_ENABLED=true requires NOTIFICATION_ADAPTER=smtp-webhook.',
      );
    }

    if (value.SMS_ENABLED) {
      let webhook: URL | undefined;
      try {
        webhook = new URL(value.SMS_WEBHOOK_URL);
      } catch {
        addConfigurationIssue(
          context,
          'SMS_WEBHOOK_URL',
          'SMS_WEBHOOK_URL must be a valid absolute URL.',
        );
      }
      if (webhook && webhook.protocol !== 'https:') {
        addConfigurationIssue(context, 'SMS_WEBHOOK_URL', 'SMS_WEBHOOK_URL must use HTTPS.');
      }
      if (!value.SMS_WEBHOOK_AUTH_TOKEN) {
        addConfigurationIssue(
          context,
          'SMS_WEBHOOK_AUTH_TOKEN',
          'SMS_WEBHOOK_AUTH_TOKEN is required for SMS delivery.',
        );
      }
    }

    if (value.NODE_ENV === 'production') {
      if (
        value.MEDIA_STORAGE_DRIVER === 's3' &&
        [value.S3_ACCESS_KEY, value.S3_SECRET_KEY].some((credential) =>
          credential?.includes('change_me'),
        )
      ) {
        addConfigurationIssue(
          context,
          'S3_SECRET_KEY',
          'S3 credentials contain an unsafe production default.',
        );
      }
      if (value.NOTIFICATION_ADAPTER !== 'smtp-webhook') {
        addConfigurationIssue(
          context,
          'NOTIFICATION_ADAPTER',
          'Production requires NOTIFICATION_ADAPTER=smtp-webhook.',
        );
      }
      if (value.FIELD_ENCRYPTION_KEY.length < 32) {
        addConfigurationIssue(
          context,
          'FIELD_ENCRYPTION_KEY',
          'Production FIELD_ENCRYPTION_KEY must contain at least 32 characters.',
        );
      }
      if (
        ['development-only', 'change_me'].some((fragment) =>
          value.FIELD_ENCRYPTION_KEY.includes(fragment),
        )
      ) {
        addConfigurationIssue(
          context,
          'FIELD_ENCRYPTION_KEY',
          'Production FIELD_ENCRYPTION_KEY contains an unsafe placeholder.',
        );
      }
      if (!value.WEB_URL.startsWith('https://')) {
        addConfigurationIssue(context, 'WEB_URL', 'Production WEB_URL must use HTTPS.');
      }
      if (!value.SMTP_USER || value.SMTP_PASSWORD.length < 16) {
        addConfigurationIssue(
          context,
          'SMTP_PASSWORD',
          'Production SMTP credentials are required and the password must be at least 16 characters.',
        );
      }
      if (!value.SMTP_SECURE && !value.SMTP_REQUIRE_TLS) {
        addConfigurationIssue(
          context,
          'SMTP_REQUIRE_TLS',
          'Production SMTP must use implicit TLS or require STARTTLS.',
        );
      }
      if (['localhost', 'mailpit'].includes(value.SMTP_HOST.toLowerCase())) {
        addConfigurationIssue(
          context,
          'SMTP_HOST',
          'Production SMTP_HOST cannot use a local development service.',
        );
      }
      if (value.EMAIL_FROM.endsWith('.invalid') || value.EMAIL_FROM.endsWith('.test')) {
        addConfigurationIssue(
          context,
          'EMAIL_FROM',
          'Production EMAIL_FROM cannot use a reserved development domain.',
        );
      }
      if (value.SMS_ENABLED && value.SMS_WEBHOOK_AUTH_TOKEN.length < 24) {
        addConfigurationIssue(
          context,
          'SMS_WEBHOOK_AUTH_TOKEN',
          'Production SMS webhook credentials must contain at least 24 characters.',
        );
      }
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
