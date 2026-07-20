import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalMediaStorage } from './local-media-storage';

describe('LocalMediaStorage', () => {
  let root: string;
  let storage: LocalMediaStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vape-media-test-'));
    storage = new LocalMediaStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('atomically stores, reads, and removes a generated object key', async () => {
    const bytes = Buffer.from('safe-raster-bytes');
    const objectKey = 'products/product-1/product/random.png';

    await storage.put({
      objectKey,
      bytes,
      contentType: 'image/png',
      checksumSha256: '0'.repeat(64),
    });

    await expect(storage.get(objectKey)).resolves.toEqual(bytes);
    await expect(readFile(join(root, ...objectKey.split('/')))).resolves.toEqual(bytes);
    await storage.delete(objectKey);
    await expect(storage.get(objectKey)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(storage.delete(objectKey)).resolves.toBeUndefined();
  });

  it.each(['../outside.png', 'products/../outside.png', '/absolute.png', 'products\\x.png'])(
    'rejects unsafe object key %s',
    async (objectKey) => {
      await expect(
        storage.put({
          objectKey,
          bytes: Buffer.from('x'),
          contentType: 'image/png',
          checksumSha256: '0'.repeat(64),
        }),
      ).rejects.toThrow('Unsafe media object key');
    },
  );
});
