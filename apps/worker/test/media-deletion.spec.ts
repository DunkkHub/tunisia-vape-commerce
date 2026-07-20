import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWorkerEnvironment } from '../src/environment.js';
import {
  ConfiguredMediaDeletionAdapter,
  type MediaDeletionAdapter,
} from '../src/media-deletion-adapter.js';
import { OUTBOX_EVENT_TYPES, WorkerDomainError } from '../src/outbox-contracts.js';
import { OutboxProcessor } from '../src/outbox-processor.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

const environment = (root = 'uploads/media') =>
  parseWorkerEnvironment({
    DATABASE_URL: 'mysql://worker:secret@localhost:3306/store',
    WORKER_INSTANCE_ID: 'worker-media-test',
    MEDIA_STORAGE_DRIVER: 'local',
    MEDIA_LOCAL_ROOT: root,
  });

const event = {
  id: 'event-media-1',
  deterministicKey: 'media-object-delete:v1:image-1',
  aggregateType: 'ProductImage',
  aggregateId: 'image-1',
  eventType: OUTBOX_EVENT_TYPES.MEDIA_OBJECT_DELETE,
  eventVersion: 1,
  payload: { bucket: 'local-media', objectKey: 'products/product-1/image.png' },
  status: 'PUBLISHED',
  attemptCount: 1,
  maxAttempts: 8,
};

describe('media deletion adapter', () => {
  it('idempotently deletes only a safe object below the configured local root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vape-media-cleanup-'));
    temporaryRoots.push(root);
    const objectKey = 'products/product-1/image.png';
    const path = join(root, ...objectKey.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'image');
    const adapter = new ConfiguredMediaDeletionAdapter(environment(root));

    await adapter.deleteObject({ bucket: 'local-media', objectKey });
    await adapter.deleteObject({ bucket: 'local-media', objectKey });
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(adapter.deleteObject({ bucket: 'other-bucket', objectKey })).rejects.toMatchObject(
      { safeCode: 'MEDIA_BUCKET_MISMATCH' },
    );
    await expect(
      adapter.deleteObject({ bucket: 'local-media', objectKey: '../outside' }),
    ).rejects.toMatchObject({ safeCode: 'MEDIA_OBJECT_KEY_INVALID' });
  });
});

describe('media deletion outbox processing', () => {
  it('claims, deletes, and marks an object event processed without holding a database transaction', async () => {
    const claimTransaction = {
      $queryRaw: vi.fn().mockResolvedValue([event]),
      outboxEvent: { update: vi.fn().mockResolvedValue({}) },
    };
    const completeTransaction = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ status: 'PROCESSING', eventType: event.eventType, eventVersion: 1 }]),
      outboxEvent: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementationOnce((callback: (value: typeof claimTransaction) => unknown) =>
          callback(claimTransaction),
        )
        .mockImplementationOnce((callback: (value: typeof completeTransaction) => unknown) =>
          callback(completeTransaction),
        ),
    };
    const repository = { scheduleRetry: vi.fn() };
    const media = {
      deleteObject: vi.fn().mockResolvedValue(undefined),
    } satisfies MediaDeletionAdapter;
    const logger = { info: vi.fn(), warn: vi.fn() };
    const processor = new OutboxProcessor(
      prisma as never,
      repository as never,
      environment(),
      logger as never,
      undefined,
      media,
    );

    await processor.process({
      outboxEventId: event.id,
      eventType: event.eventType,
      eventVersion: 1,
    });

    expect(media.deleteObject).toHaveBeenCalledWith(event.payload);
    expect(claimTransaction.outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSING' }) as object,
      }),
    );
    expect(completeTransaction.outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) as object }),
    );
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
  });

  it('schedules a bounded durable retry when object storage is unavailable', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([event]),
      outboxEvent: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const repository = { scheduleRetry: vi.fn().mockResolvedValue('RETRY') };
    const media = {
      deleteObject: vi.fn().mockRejectedValue(new WorkerDomainError('MEDIA_OBJECT_DELETE_FAILED')),
    } satisfies MediaDeletionAdapter;
    const processor = new OutboxProcessor(
      prisma as never,
      repository as never,
      environment(),
      { info: vi.fn(), warn: vi.fn() } as never,
      undefined,
      media,
    );

    await processor.process({
      outboxEventId: event.id,
      eventType: event.eventType,
      eventVersion: 1,
    });

    expect(repository.scheduleRetry).toHaveBeenCalledWith(event.id, 'MEDIA_OBJECT_DELETE_FAILED');
  });
});
