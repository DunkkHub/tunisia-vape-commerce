import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { MediaStorage, StoreMediaObjectInput } from './media-storage';

const SAFE_OBJECT_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,1023}$/;

export class LocalMediaStorage implements MediaStorage {
  readonly bucket = 'local-media';
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(input: StoreMediaObjectInput): Promise<void> {
    const destination = this.objectPath(input.objectKey);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, input.bytes, { flag: 'wx' });
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async get(objectKey: string, maximumBytes: number): Promise<Buffer> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new TypeError('A positive media read limit is required.');
    }
    const stream = createReadStream(this.objectPath(objectKey), { highWaterMark: 64 * 1_024 });
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      const bytes: Buffer = chunk;
      total += bytes.length;
      if (total > maximumBytes) {
        stream.destroy();
        throw new Error('The stored media object exceeded its recorded size.');
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, total);
  }

  async delete(objectKey: string): Promise<void> {
    try {
      await unlink(this.objectPath(objectKey));
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  private objectPath(objectKey: string): string {
    if (
      !SAFE_OBJECT_KEY.test(objectKey) ||
      objectKey.includes('\\') ||
      objectKey.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      throw new Error('Unsafe media object key.');
    }
    const destination = resolve(this.root, ...objectKey.split('/'));
    const fromRoot = relative(this.root, destination);
    if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || isAbsolute(fromRoot)) {
      throw new Error('Media object key escaped the configured root.');
    }
    return destination;
  }
}

const isMissingFile = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 'ENOENT';
