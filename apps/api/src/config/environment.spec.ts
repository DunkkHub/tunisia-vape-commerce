import { describe, expect, it } from 'vitest';
import {
  adminOrigin,
  allowedBrowserOrigins,
  browserOriginForPath,
  openApiEnabled,
  storefrontOrigin,
  validateEnvironment,
} from './environment';

const productionEnvironment = {
  NODE_ENV: 'production',
  WEB_URL: 'https://store.example.tn',
  ADMIN_WEB_URL: 'https://admin.example.tn',
  STOREFRONT_HOST: 'store.example.tn',
  ADMIN_HOST: 'admin.example.tn',
  DATABASE_URL: 'mysql://app_user:strong-password@mysql.internal:3306/vape_store',
  REDIS_URL: 'redis://:strong-password@redis.internal:6379/0',
  COOKIE_SECRET: 'c'.repeat(48),
  FIELD_ENCRYPTION_KEY: 'f'.repeat(48),
};

describe('launch environment defaults', () => {
  it('uses the approved open launch flags while retaining operational policy gates', () => {
    const environment = validateEnvironment({});

    expect(environment).toMatchObject({
      CHECKOUT_ENABLED: true,
      MAINTENANCE_MODE: false,
      PRELAUNCH_MODE: false,
      MINIMUM_PURCHASE_AGE: 18,
      HEALTHCHECK_TIMEOUT_MS: 2_000,
      WORKER_HEARTBEAT_MAX_AGE_SECONDS: 60,
      EXPECTED_MIGRATION_NAME: '20260811170000_product_image_renditions',
      PASSWORD_RESET_TTL_MINUTES: 30,
      GOOGLE_OAUTH_ENABLED: false,
      GOOGLE_OAUTH_STATE_TTL_SECONDS: 300,
      MEDIA_STORAGE_DRIVER: 'local',
      MEDIA_LOCAL_ROOT: 'uploads/media',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'vape-store',
      S3_FORCE_PATH_STYLE: true,
      UPLOAD_MAX_BYTES: 10 * 1_024 * 1_024,
      UPLOAD_MAX_PIXELS: 40_000_000,
      CATALOG_IMPORT_MEDIA_HOSTS: [],
    });
    expect(environment).not.toHaveProperty('LEGAL_REVIEW_COMPLETED');
  });

  it('accepts an operator-selected positive minimum age', () => {
    expect(validateEnvironment({ MINIMUM_PURCHASE_AGE: '16' }).MINIMUM_PURCHASE_AGE).toBe(16);
  });

  it('validates Google OAuth as an all-or-nothing customer-only configuration', () => {
    expect(
      validateEnvironment({
        GOOGLE_OAUTH_ENABLED: 'true',
        GOOGLE_CLIENT_ID: '1234567890-example.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'GOCSPX-a-real-looking-local-test-secret',
        GOOGLE_CALLBACK_URL: 'http://localhost:5173/api/v1/auth/customer/google/callback',
        PASSWORD_RESET_TTL_MINUTES: '20',
      }),
    ).toMatchObject({
      GOOGLE_OAUTH_ENABLED: true,
      GOOGLE_OAUTH_STATE_TTL_SECONDS: 300,
      PASSWORD_RESET_TTL_MINUTES: 20,
    });

    expect(() => validateEnvironment({ GOOGLE_OAUTH_ENABLED: 'true' })).toThrow();
    expect(() =>
      validateEnvironment({
        GOOGLE_OAUTH_ENABLED: 'true',
        GOOGLE_CLIENT_ID: 'REPLACE.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'GOCSPX-a-real-looking-local-test-secret',
        GOOGLE_CALLBACK_URL: 'http://localhost:5173/api/v1/auth/customer/google/callback',
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        GOOGLE_OAUTH_ENABLED: 'true',
        GOOGLE_CLIENT_ID: '1234567890-example.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'GOCSPX-a-real-looking-local-test-secret',
        GOOGLE_CALLBACK_URL: 'http://localhost:5173/api/v1/auth/customer/google/callback?code=x',
      }),
    ).toThrow();
    expect(() => validateEnvironment({ PASSWORD_RESET_TTL_MINUTES: '61' })).toThrow();
  });

  it('requires the exact HTTPS storefront callback for Google OAuth in production', () => {
    const oauthEnvironment = {
      ...productionEnvironment,
      GOOGLE_OAUTH_ENABLED: 'true',
      GOOGLE_CLIENT_ID: '1234567890-example.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: '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cret',
      GOOGLE_CALLBACK_URL: 'https://store.example.tn/api/v1/auth/customer/google/callback',
    };
    expect(validateEnvironment(oauthEnvironment).GOOGLE_OAUTH_ENABLED).toBe(true);
    expect(() =>
      validateEnvironment({
        ...oauthEnvironment,
        GOOGLE_CALLBACK_URL: 'https://api.example.tn/api/v1/auth/customer/google/callback',
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...oauthEnvironment,
        GOOGLE_CALLBACK_URL: 'http://store.example.tn/api/v1/auth/customer/google/callback',
      }),
    ).toThrow();
  });

  it('accepts an explicitly configured S3-compatible media backend and upload limits', () => {
    expect(
      validateEnvironment({
        MEDIA_STORAGE_DRIVER: 's3',
        S3_ENDPOINT: 'http://127.0.0.1:9000',
        S3_REGION: 'eu-south-2',
        S3_BUCKET: 'catalog-media',
        S3_ACCESS_KEY: 'local-minio-access',
        S3_SECRET_KEY: 'local-minio-secret',
        S3_FORCE_PATH_STYLE: 'true',
        UPLOAD_MAX_BYTES: '2097152',
        UPLOAD_MAX_PIXELS: '12000000',
      }),
    ).toMatchObject({
      MEDIA_STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'http://127.0.0.1:9000',
      S3_REGION: 'eu-south-2',
      S3_BUCKET: 'catalog-media',
      S3_ACCESS_KEY: 'local-minio-access',
      S3_SECRET_KEY: 'local-minio-secret',
      S3_FORCE_PATH_STYLE: true,
      UPLOAD_MAX_BYTES: 2_097_152,
      UPLOAD_MAX_PIXELS: 12_000_000,
    });
  });

  it('rejects partial S3 credentials and unsafe upload limits', () => {
    expect(() => validateEnvironment({ S3_ACCESS_KEY: 'access-without-secret' })).toThrow();
    expect(() => validateEnvironment({ S3_SECRET_KEY: 'secret-without-access' })).toThrow();
    expect(() => validateEnvironment({ UPLOAD_MAX_BYTES: '1023' })).toThrow();
    expect(() => validateEnvironment({ UPLOAD_MAX_PIXELS: '64000001' })).toThrow();
    expect(() => validateEnvironment({ MEDIA_STORAGE_DRIVER: 'filesystem' })).toThrow();
  });

  it('normalizes exact operator media hostnames and rejects URL-shaped entries', () => {
    expect(
      validateEnvironment({
        CATALOG_IMPORT_MEDIA_HOSTS: 'media.example.tn, CDN.EXAMPLE.TN,media.example.tn',
      }).CATALOG_IMPORT_MEDIA_HOSTS,
    ).toEqual(['media.example.tn', 'cdn.example.tn']);
    expect(() =>
      validateEnvironment({ CATALOG_IMPORT_MEDIA_HOSTS: 'https://media.example.tn' }),
    ).toThrow();
    expect(() =>
      validateEnvironment({ CATALOG_IMPORT_MEDIA_HOSTS: 'media.example.tn/path' }),
    ).toThrow();
    expect(() => validateEnvironment({ CATALOG_IMPORT_MEDIA_HOSTS: '8.8.8.8' })).toThrow();
  });

  it('uses one browser origin locally and separate exact origins when configured', () => {
    const local = validateEnvironment({});
    expect(allowedBrowserOrigins(local)).toEqual(['http://localhost:5173']);

    const split = validateEnvironment(productionEnvironment);
    expect(storefrontOrigin(split)).toBe('https://store.example.tn');
    expect(adminOrigin(split)).toBe('https://admin.example.tn');
    expect(allowedBrowserOrigins(split)).toEqual([
      'https://store.example.tn',
      'https://admin.example.tn',
    ]);
    expect(browserOriginForPath(split, '/api/v1/catalog/products')).toBe(
      'https://store.example.tn',
    );
    expect(browserOriginForPath(split, '/api/v1/admin/orders?page=1')).toBe(
      'https://admin.example.tn',
    );
    expect(browserOriginForPath(split, '/api/v1/auth/admin/login')).toBe(
      'https://admin.example.tn',
    );
    expect(browserOriginForPath(split, '/api/docs')).toBe('https://admin.example.tn');
    expect(browserOriginForPath(split, '/api/docs-json')).toBe('https://admin.example.tn');
  });

  it('rejects unsafe or non-separated production browser origins', () => {
    expect(() =>
      validateEnvironment({ ...productionEnvironment, ADMIN_WEB_URL: undefined }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        ADMIN_WEB_URL: productionEnvironment.WEB_URL,
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({ ...productionEnvironment, STOREFRONT_HOST: 'wrong.example.tn' }),
    ).toThrow();
    expect(() =>
      validateEnvironment({ ...productionEnvironment, ADMIN_HOST: 'admin.example.tn;include' }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        WEB_URL: 'https://store.example.tn:8443',
        ADMIN_WEB_URL: 'https://store.example.tn:9443',
        ADMIN_HOST: 'store.example.tn',
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        ADMIN_WEB_URL: 'http://admin.example.tn',
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        WEB_URL: 'https://store.example.tn/untrusted-path',
      }),
    ).toThrow();
  });

  it('rejects production credential placeholders and plaintext object-storage endpoints', () => {
    for (const override of [
      { DATABASE_URL: 'mysql://app_user:REPLACE_WITH_PASSWORD@mysql.internal:3306/vape_store' },
      { REDIS_URL: 'redis://:REPLACE_WITH_PASSWORD@redis.internal:6379/0' },
      { COOKIE_SECRET: 'REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS' },
      { FIELD_ENCRYPTION_KEY: 'placeholder' },
    ]) {
      expect(() => validateEnvironment({ ...productionEnvironment, ...override })).toThrow();
    }
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        MEDIA_STORAGE_DRIVER: 's3',
        S3_ENDPOINT: 'http://objects.internal',
        S3_ACCESS_KEY: 'scoped-access-key',
        S3_SECRET_KEY: 'scoped-secret-key',
      }),
    ).toThrow();
  });

  it('keeps OpenAPI convenient locally but disabled by default in production', () => {
    expect(openApiEnabled(validateEnvironment({}))).toBe(true);
    expect(openApiEnabled(validateEnvironment(productionEnvironment))).toBe(false);
    expect(
      openApiEnabled(validateEnvironment({ ...productionEnvironment, OPENAPI_ENABLED: 'true' })),
    ).toBe(true);
    expect(() =>
      validateEnvironment({ ...productionEnvironment, OPENAPI_ENABLED: 'yes' }),
    ).toThrow();
  });
});
