import { z } from 'zod';

const booleanFromEnvironment = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    WEB_URL: z.url().default('http://localhost:5173'),
    DATABASE_URL: z.string().min(1).default('mysql://app_user:change_me@localhost:3306/vape_store'),
    REDIS_URL: z.url().default('redis://localhost:6379'),
    HEALTHCHECK_TIMEOUT_MS: z.coerce.number().int().min(250).max(10_000).default(2_000),
    WORKER_HEARTBEAT_MAX_AGE_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
    EXPECTED_MIGRATION_NAME: z
      .string()
      .min(1)
      .max(200)
      .regex(/^\d{14}_[a-z0-9_]+$/)
      .default('20260713010000_durable_outbox'),
    COOKIE_SECRET: z.string().default('development-only-cookie-secret-change-me'),
    FIELD_ENCRYPTION_KEY: z.string().default('development-only-field-key-change-me'),
    CHECKOUT_ENABLED: booleanFromEnvironment('true'),
    LEGAL_REVIEW_COMPLETED: booleanFromEnvironment('true'),
    MAINTENANCE_MODE: booleanFromEnvironment('false'),
    PRELAUNCH_MODE: booleanFromEnvironment('false'),
    MINIMUM_PURCHASE_AGE: z.coerce.number().int().min(18).max(99).default(18),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    ADMIN_SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
    ADMIN_SESSION_ABSOLUTE_MINUTES: z.coerce.number().int().min(30).max(1_440).default(480),
    ADMIN_PREAUTH_TTL_MINUTES: z.coerce.number().int().min(1).max(15).default(5),
    ADMIN_RECENT_AUTH_MINUTES: z.coerce.number().int().min(1).max(30).default(10),
    CUSTOMER_SESSION_IDLE_MINUTES: z.coerce.number().int().min(30).max(43_200).default(10_080),
    CUSTOMER_SESSION_ABSOLUTE_MINUTES: z.coerce.number().int().min(60).max(129_600).default(43_200),
    ADMIN_IP_ALLOWLIST: z.string().optional(),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV !== 'production') return;

    const unsafeFragments = ['change_me', 'development-only', 'localhost'];
    for (const [name, value] of [
      ['DATABASE_URL', environment.DATABASE_URL],
      ['COOKIE_SECRET', environment.COOKIE_SECRET],
      ['FIELD_ENCRYPTION_KEY', environment.FIELD_ENCRYPTION_KEY],
    ] as const) {
      if (unsafeFragments.some((fragment) => value.includes(fragment))) {
        context.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} contains an unsafe production default`,
        });
      }
    }

    if (environment.COOKIE_SECRET.length < 32) {
      context.addIssue({ code: 'custom', path: ['COOKIE_SECRET'], message: 'Must be 32+ chars' });
    }
    if (environment.FIELD_ENCRYPTION_KEY.length < 32) {
      context.addIssue({
        code: 'custom',
        path: ['FIELD_ENCRYPTION_KEY'],
        message: 'Must be 32+ chars',
      });
    }
    if (!environment.WEB_URL.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_URL'],
        message: 'Production WEB_URL must use HTTPS',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export const validateEnvironment = (input: Record<string, unknown>): Environment =>
  environmentSchema.parse(input);
