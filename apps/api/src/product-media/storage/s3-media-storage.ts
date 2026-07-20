import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import type { MediaStorage, StoreMediaObjectInput } from './media-storage';

export interface S3MediaStorageOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey?: string;
  secretKey?: string;
  forcePathStyle: boolean;
}

export class S3MediaStorage implements MediaStorage {
  readonly bucket: string;
  private readonly client: S3Client;

  constructor(options: S3MediaStorageOptions) {
    this.bucket = options.bucket;
    const configuration: S3ClientConfig = {
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.accessKey && options.secretKey
        ? {
            credentials: {
              accessKeyId: options.accessKey,
              secretAccessKey: options.secretKey,
            },
          }
        : {}),
    };
    this.client = new S3Client(configuration);
  }

  async put(input: StoreMediaObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        Body: input.bytes,
        ContentLength: input.bytes.length,
        ContentType: input.contentType,
        CacheControl: 'public, max-age=31536000, immutable',
        Metadata: { checksum_sha256: input.checksumSha256 },
      }),
    );
  }

  async get(objectKey: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    if (!response.Body) throw new Error('The media object response had no body.');
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
