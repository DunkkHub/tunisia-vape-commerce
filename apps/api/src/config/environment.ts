import { z } from 'zod';
import { isIP } from 'node:net';

const booleanFromEnvironment = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');

const optionalBooleanFromEnvironment = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const hasUnsafeProductionPlaceholder = (value: string): boolean =>
  /(?:change[_-]?me|development[-_]?only|replace(?:[_-]?with)?|placeholder)/i.test(value);

const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const browserOrigin = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash
  );
}, 'Must be an HTTP(S) browser origin without credentials, path, query, or fragment');

const browserHost = z
  .string()
  .regex(
    /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i,
    'Must be a single DNS hostname',
  );

const dnsHostname = browserHost.refine(
  (value) => isIP(value) === 0,
  'IP address literals are not allowed',
);

const catalogImportMediaHosts = z
  .string()
  .default('')
  .transform((value) => [
    ...new Set(
      value
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ),
  ])
  .pipe(z.array(dnsHostname).max(50));

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    WEB_URL: browserOrigin.default('http://localhost:5173'),
    ADMIN_WEB_URL: browserOrigin.optional(),
    STOREFRONT_HOST: browserHost.optional(),
    ADMIN_HOST: browserHost.optional(),
    OPENAPI_ENABLED: optionalBooleanFromEnvironment,
    DATABASE_URL: z.string().min(1).default('mysql://app_user:change_me@localhost:3306/vape_store'),
    REDIS_URL: z.url().default('redis://localhost:6379'),
    HEALTHCHECK_TIMEOUT_MS: z.coerce.number().int().min(250).max(10_000).default(2_000),
    WORKER_HEARTBEAT_MAX_AGE_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
    EXPECTED_MIGRATION_NAME: z
      .string()
      .min(1)
      .max(200)
      .regex(/^\d{14}_[a-z0-9_]+$/)
      .default('20260811170000_product_image_renditions'),
    COOKIE_SECRET: z.string().default('development-only-cookie-secret-change-me'),
    FIELD_ENCRYPTION_KEY: z.string().default('development-only-field-key-change-me'),
    CHECKOUT_ENABLED: booleanFromEnvironment('true'),
    MAINTENANCE_MODE: booleanFromEnvironment('false'),
    PRELAUNCH_MODE: booleanFromEnvironment('false'),
    MINIMUM_PURCHASE_AGE: z.coerce.number().int().min(1).max(99).default(18),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    ADMIN_SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
    ADMIN_SESSION_ABSOLUTE_MINUTES: z.coerce.number().int().min(30).max(1_440).default(480),
    ADMIN_PREAUTH_TTL_MINUTES: z.coerce.number().int().min(1).max(15).default(5),
    ADMIN_RECENT_AUTH_MINUTES: z.coerce.number().int().min(1).max(30).default(10),
    CUSTOMER_SESSION_IDLE_MINUTES: z.coerce.number().int().min(30).max(43_200).default(10_080),
    CUSTOMER_SESSION_ABSOLUTE_MINUTES: z.coerce.number().int().min(60).max(129_600).default(43_200),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(30),
    GOOGLE_OAUTH_ENABLED: booleanFromEnvironment('false'),
    GOOGLE_CLIENT_ID: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().min(20).max(512).optional(),
    ),
    GOOGLE_CLIENT_SECRET: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().min(16).max(2_048).optional(),
    ),
    GOOGLE_CALLBACK_URL: z.preprocess(emptyStringToUndefined, z.url().optional()),
    GOOGLE_OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().min(180).max(900).default(300),
    ADMIN_IP_ALLOWLIST: z.string().optional(),
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
    S3_FORCE_PATH_STYLE: booleanFromEnvironment('true'),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(25 * 1_024 * 1_024)
      .default(10 * 1_024 * 1_024),
    UPLOAD_MAX_PIXELS: z.coerce.number().int().min(1).max(64_000_000).default(40_000_000),
    CATALOG_IMPORT_MEDIA_HOSTS: catalogImportMediaHosts,
  })
  .superRefine((environment, context) => {
    if (Boolean(environment.S3_ACCESS_KEY) !== Boolean(environment.S3_SECRET_KEY)) {
      context.addIssue({
        code: 'custom',
        path: environment.S3_ACCESS_KEY ? ['S3_SECRET_KEY'] : ['S3_ACCESS_KEY'],
        message: 'S3 access and secret keys must be configured together',
      });
    }

    if (environment.GOOGLE_OAUTH_ENABLED) {
      for (const name of [
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_CALLBACK_URL',
      ] as const) {
        if (!environment[name]) {
          context.addIssue({
            code: 'custom',
            path: [name],
            message: `${name} is required when Google OAuth is enabled`,
          });
        }
      }
      if (
        environment.GOOGLE_CLIENT_ID &&
        (!environment.GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com') ||
          hasUnsafeProductionPlaceholder(environment.GOOGLE_CLIENT_ID))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['GOOGLE_CLIENT_ID'],
          message: 'GOOGLE_CLIENT_ID must be a non-placeholder Google web client ID',
        });
      }
      if (
        environment.GOOGLE_CLIENT_SECRET &&
        hasUnsafeProductionPlaceholder(environment.GOOGLE_CLIENT_SECRET)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['GOOGLE_CLIENT_SECRET'],
          message: 'GOOGLE_CLIENT_SECRET contains an unsafe placeholder',
        });
      }
      if (environment.GOOGLE_CALLBACK_URL) {
        const callback = new URL(environment.GOOGLE_CALLBACK_URL);
        if (
          callback.username ||
          callback.password ||
          callback.pathname !== '/api/v1/auth/customer/google/callback' ||
          callback.search ||
          callback.hash
        ) {
          context.addIssue({
            code: 'custom',
            path: ['GOOGLE_CALLBACK_URL'],
            message:
              'GOOGLE_CALLBACK_URL must use the exact customer callback path without credentials, query, or fragment',
          });
        }
        if (callback.origin !== new URL(environment.WEB_URL).origin) {
          context.addIssue({
            code: 'custom',
            path: ['GOOGLE_CALLBACK_URL'],
            message: 'GOOGLE_CALLBACK_URL must use the storefront origin',
          });
        }
        if (environment.NODE_ENV === 'production' && callback.protocol !== 'https:') {
          context.addIssue({
            code: 'custom',
            path: ['GOOGLE_CALLBACK_URL'],
            message: 'Production GOOGLE_CALLBACK_URL must use HTTPS',
          });
        }
      }
    }
    if (environment.NODE_ENV !== 'production') return;

    for (const [name, value] of [
      ['DATABASE_URL', environment.DATABASE_URL],
      ['REDIS_URL', environment.REDIS_URL],
      ['COOKIE_SECRET', environment.COOKIE_SECRET],
      ['FIELD_ENCRYPTION_KEY', environment.FIELD_ENCRYPTION_KEY],
    ] as const) {
      if (hasUnsafeProductionPlaceholder(value) || value.toLowerCase().includes('localhost')) {
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
    if (!environment.ADMIN_WEB_URL) {
      context.addIssue({
        code: 'custom',
        path: ['ADMIN_WEB_URL'],
        message: 'Production ADMIN_WEB_URL is required',
      });
    } else {
      if (!environment.ADMIN_WEB_URL.startsWith('https://')) {
        context.addIssue({
          code: 'custom',
          path: ['ADMIN_WEB_URL'],
          message: 'Production ADMIN_WEB_URL must use HTTPS',
        });
      }
      if (new URL(environment.ADMIN_WEB_URL).origin === new URL(environment.WEB_URL).origin) {
        context.addIssue({
          code: 'custom',
          path: ['ADMIN_WEB_URL'],
          message: 'Production administrator and storefront origins must be different',
        });
      }
    }
    if (!environment.STOREFRONT_HOST) {
      context.addIssue({
        code: 'custom',
        path: ['STOREFRONT_HOST'],
        message: 'Production STOREFRONT_HOST is required',
      });
    } else if (environment.STOREFRONT_HOST !== new URL(environment.WEB_URL).hostname) {
      context.addIssue({
        code: 'custom',
        path: ['STOREFRONT_HOST'],
        message: 'STOREFRONT_HOST must match WEB_URL',
      });
    }
    if (!environment.ADMIN_HOST) {
      context.addIssue({
        code: 'custom',
        path: ['ADMIN_HOST'],
        message: 'Production ADMIN_HOST is required',
      });
    } else if (
      environment.ADMIN_WEB_URL &&
      environment.ADMIN_HOST !== new URL(environment.ADMIN_WEB_URL).hostname
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ADMIN_HOST'],
        message: 'ADMIN_HOST must match ADMIN_WEB_URL',
      });
    }
    if (
      environment.STOREFRONT_HOST &&
      environment.ADMIN_HOST &&
      environment.STOREFRONT_HOST === environment.ADMIN_HOST
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ADMIN_HOST'],
        message: 'Production administrator and storefront hosts must be different',
      });
    }
    for (const [name, value] of [
      ['STOREFRONT_HOST', environment.STOREFRONT_HOST],
      ['ADMIN_HOST', environment.ADMIN_HOST],
    ] as const) {
      if (value === 'localhost' || value?.endsWith('.localhost')) {
        context.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} cannot use localhost in production`,
        });
      }
    }
    if (environment.MEDIA_STORAGE_DRIVER === 's3') {
      if (
        [environment.S3_ACCESS_KEY, environment.S3_SECRET_KEY].some(
          (value) => value && hasUnsafeProductionPlaceholder(value),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['S3_SECRET_KEY'],
          message: 'S3 credentials contain an unsafe production default',
        });
      }
      if (environment.S3_ENDPOINT && !environment.S3_ENDPOINT.startsWith('https://')) {
        context.addIssue({
          code: 'custom',
          path: ['S3_ENDPOINT'],
          message: 'Production S3_ENDPOINT must use HTTPS',
        });
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export const validateEnvironment = (input: Record<string, unknown>): Environment =>
  environmentSchema.parse(input);

export const storefrontOrigin = (environment: Pick<Environment, 'WEB_URL'>): string =>
  new URL(environment.WEB_URL).origin;

export const adminOrigin = (environment: Pick<Environment, 'WEB_URL' | 'ADMIN_WEB_URL'>): string =>
  new URL(environment.ADMIN_WEB_URL ?? environment.WEB_URL).origin;

export const allowedBrowserOrigins = (
  environment: Pick<Environment, 'WEB_URL' | 'ADMIN_WEB_URL'>,
): string[] => [...new Set([storefrontOrigin(environment), adminOrigin(environment)])];

export const isAdministratorBrowserPath = (path: string): boolean =>
  /^\/api\/v1\/(?:admin(?:\/|$)|auth\/admin(?:\/|$))/.test(path.split('?', 1)[0] ?? '') ||
  /^\/api\/docs(?:\/|$|-)/.test(path.split('?', 1)[0] ?? '');

export const browserOriginForPath = (
  environment: Pick<Environment, 'WEB_URL' | 'ADMIN_WEB_URL'>,
  path: string,
): string =>
  isAdministratorBrowserPath(path) ? adminOrigin(environment) : storefrontOrigin(environment);

export const openApiEnabled = (
  environment: Pick<Environment, 'NODE_ENV' | 'OPENAPI_ENABLED'>,
): boolean => environment.OPENAPI_ENABLED ?? environment.NODE_ENV !== 'production';
