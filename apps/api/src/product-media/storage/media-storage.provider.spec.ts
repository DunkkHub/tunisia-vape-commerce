import type { FactoryProvider } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Environment } from '../../config/environment';
import { LocalMediaStorage } from './local-media-storage';
import { productMediaStorageProvider } from './media-storage.provider';
import type { MediaStorage } from './media-storage';
import { S3MediaStorage } from './s3-media-storage';

const provider = productMediaStorageProvider as FactoryProvider<MediaStorage>;

const configuration = (values: Partial<Environment>) =>
  ({ get: vi.fn((key: keyof Environment) => values[key]) }) as unknown as ConfigService<
    Environment,
    true
  >;

describe('productMediaStorageProvider', () => {
  it('selects the local development adapter', () => {
    const storage = provider.useFactory(
      configuration({ MEDIA_STORAGE_DRIVER: 'local', MEDIA_LOCAL_ROOT: '.data/test-media' }),
    );
    expect(storage).toBeInstanceOf(LocalMediaStorage);
  });

  it('selects the S3-compatible adapter without changing catalog behavior', () => {
    const storage = provider.useFactory(
      configuration({
        MEDIA_STORAGE_DRIVER: 's3',
        S3_ENDPOINT: 'http://127.0.0.1:9000',
        S3_REGION: 'us-east-1',
        S3_BUCKET: 'catalog-media',
        S3_ACCESS_KEY: 'minio-access',
        S3_SECRET_KEY: 'minio-secret',
        S3_FORCE_PATH_STYLE: true,
      }),
    );
    expect(storage).toBeInstanceOf(S3MediaStorage);
    (storage as S3MediaStorage).onModuleDestroy();
  });
});
