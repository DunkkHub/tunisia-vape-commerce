import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { S3MediaStorage } from './s3-media-storage';

interface StubClient {
  send(command: unknown): Promise<unknown>;
  destroy(): void;
}

describe('S3MediaStorage', () => {
  it('uses S3-compatible commands for immutable write, read, and delete operations', async () => {
    const bytes = Buffer.from('image-content');
    const send = vi.fn((command: unknown) => {
      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: { transformToByteArray: () => Promise.resolve(Uint8Array.from(bytes)) },
        });
      }
      return Promise.resolve({});
    });
    const destroy = vi.fn();
    const storage = new S3MediaStorage({
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      bucket: 'catalog-media',
      accessKey: 'minio-access',
      secretKey: 'minio-secret',
      forcePathStyle: true,
    });
    (storage as unknown as { client: StubClient }).client = { send, destroy };

    await storage.put({
      objectKey: 'products/product-1/product/random.png',
      bytes,
      contentType: 'image/png',
      checksumSha256: 'a'.repeat(64),
    });
    await expect(storage.get('products/product-1/product/random.png')).resolves.toEqual(bytes);
    await storage.delete('products/product-1/product/random.png');
    storage.onModuleDestroy();

    const [put, get, remove] = send.mock.calls.map(([command]) => command);
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect((put as PutObjectCommand).input).toMatchObject({
      Bucket: 'catalog-media',
      Key: 'products/product-1/product/random.png',
      Body: bytes,
      ContentLength: bytes.length,
      ContentType: 'image/png',
      Metadata: { checksum_sha256: 'a'.repeat(64) },
    });
    expect(get).toBeInstanceOf(GetObjectCommand);
    expect(remove).toBeInstanceOf(DeleteObjectCommand);
    expect(destroy).toHaveBeenCalledOnce();
  });
});
