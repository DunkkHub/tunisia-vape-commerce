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

  async get(objectKey: string, maximumBytes: number): Promise<Buffer> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new TypeError('A positive media read limit is required.');
    }
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Range: `bytes=0-${maximumBytes}`,
      }),
    );
    if (!response.Body) throw new Error('The media object response had no body.');
    if (response.ContentLength !== undefined && response.ContentLength > maximumBytes) {
      throw new Error('The stored media object exceeded its recorded size.');
    }
    const stream = response.Body as unknown as AsyncIterable<Uint8Array> & {
      destroy?: () => void;
    };
    if (typeof stream[Symbol.asyncIterator] !== 'function') {
      throw new Error('The media object response was not streamable.');
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      total += bytes.length;
      if (total > maximumBytes) {
        stream.destroy?.();
        throw new Error('The stored media object exceeded its recorded size.');
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, total);
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
