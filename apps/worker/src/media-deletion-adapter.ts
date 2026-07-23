import { DeleteObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { WorkerEnvironment } from './environment.js';
import { WorkerDomainError } from './outbox-contracts.js';

const SAFE_OBJECT_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,1023}$/;

export interface MediaObjectDeletion {
  bucket: string;
  objectKey: string;
}

export interface MediaDeletionAdapter {
  deleteObject(input: MediaObjectDeletion): Promise<void>;
  close?(): void;
}

export class ConfiguredMediaDeletionAdapter implements MediaDeletionAdapter {
  private readonly bucket: string;
  private readonly localRoot: string;
  private readonly s3?: S3Client;

  constructor(private readonly environment: WorkerEnvironment) {
    this.bucket =
      environment.MEDIA_STORAGE_DRIVER === 'local' ? 'local-media' : environment.S3_BUCKET;
    this.localRoot = resolve(environment.MEDIA_LOCAL_ROOT);
    if (environment.MEDIA_STORAGE_DRIVER === 's3') {
      const configuration: S3ClientConfig = {
        region: environment.S3_REGION,
        forcePathStyle: environment.S3_FORCE_PATH_STYLE,
        ...(environment.S3_ENDPOINT ? { endpoint: environment.S3_ENDPOINT } : {}),
        ...(environment.S3_ACCESS_KEY && environment.S3_SECRET_KEY
          ? {
              credentials: {
                accessKeyId: environment.S3_ACCESS_KEY,
                secretAccessKey: environment.S3_SECRET_KEY,
              },
            }
          : {}),
      };
      this.s3 = new S3Client(configuration);
    }
  }

  async deleteObject(input: MediaObjectDeletion): Promise<void> {
    if (input.bucket !== this.bucket) throw new WorkerDomainError('MEDIA_BUCKET_MISMATCH');
    if (!this.safeObjectKey(input.objectKey)) {
      throw new WorkerDomainError('MEDIA_OBJECT_KEY_INVALID');
    }
    try {
      if (this.environment.MEDIA_STORAGE_DRIVER === 'local') {
        await unlink(this.objectPath(input.objectKey)).catch((error: unknown) => {
          if (!isMissingFile(error)) throw error;
        });
        return;
      }
      await this.s3!.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: input.objectKey }));
    } catch (error) {
      if (error instanceof WorkerDomainError) throw error;
      throw new WorkerDomainError('MEDIA_OBJECT_DELETE_FAILED');
    }
  }

  close(): void {
    this.s3?.destroy();
  }

  private safeObjectKey(objectKey: string): boolean {
    return (
      SAFE_OBJECT_KEY.test(objectKey) &&
      !objectKey.includes('\\') &&
      !objectKey.split('/').some((segment) => segment === '.' || segment === '..')
    );
  }

  private objectPath(objectKey: string): string {
    const destination = resolve(this.localRoot, ...objectKey.split('/'));
    const fromRoot = relative(this.localRoot, destination);
    if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || isAbsolute(fromRoot)) {
      throw new WorkerDomainError('MEDIA_OBJECT_KEY_INVALID');
    }
    return destination;
  }
}

const isMissingFile = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 'ENOENT';
