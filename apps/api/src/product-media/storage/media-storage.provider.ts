import { ConfigService } from '@nestjs/config';
import type { Provider } from '@nestjs/common';
import type { Environment } from '../../config/environment';
import { LocalMediaStorage } from './local-media-storage';
import { PRODUCT_MEDIA_STORAGE, type MediaStorage } from './media-storage';
import { S3MediaStorage } from './s3-media-storage';

export const productMediaStorageProvider: Provider<MediaStorage> = {
  provide: PRODUCT_MEDIA_STORAGE,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Environment, true>): MediaStorage => {
    if (config.get('MEDIA_STORAGE_DRIVER', { infer: true }) === 'local') {
      return new LocalMediaStorage(config.get('MEDIA_LOCAL_ROOT', { infer: true }));
    }
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    const accessKey = config.get('S3_ACCESS_KEY', { infer: true });
    const secretKey = config.get('S3_SECRET_KEY', { infer: true });
    return new S3MediaStorage({
      region: config.get('S3_REGION', { infer: true }),
      bucket: config.get('S3_BUCKET', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      ...(endpoint ? { endpoint } : {}),
      ...(accessKey ? { accessKey } : {}),
      ...(secretKey ? { secretKey } : {}),
    });
  },
};
