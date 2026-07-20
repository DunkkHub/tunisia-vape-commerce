import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import type { ProductImageValidatorService } from './product-image-validator.service';
import { ProductMediaService, type ProductMediaMutationContext } from './product-media.service';
import type { MediaStorage, StoreMediaObjectInput } from './storage/media-storage';

const context: ProductMediaMutationContext = {
  userId: 'administrator-1',
  requestId: 'request-1',
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

const validated = {
  bytes: Buffer.from('decoded-image'),
  contentType: 'image/png' as const,
  extension: 'png' as const,
  byteSize: Buffer.byteLength('decoded-image'),
  checksumSha256: createHash('sha256').update('decoded-image').digest('hex'),
  width: 320,
  height: 240,
};

const productImageRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'image-1',
  productId: 'product-1',
  variantId: null,
  objectKey: 'products/product-1/product/random.png',
  objectKeyHash: 'a'.repeat(64),
  bucket: 'test-media',
  contentType: 'image/png',
  byteSize: validated.byteSize,
  checksumSha256: validated.checksumSha256,
  width: 320,
  height: 240,
  altTextFr: 'Produit violet',
  altTextAr: 'منتج بنفسجي',
  sortOrder: 0,
  isPrimary: true,
  moderationStatus: 'APPROVED',
  createdAt: new Date('2026-07-20T00:00:00.000Z'),
  deletedAt: null,
  product: { id: 'product-1', version: 1 },
  variant: null,
  ...overrides,
});

const validator = () =>
  ({ validate: vi.fn().mockResolvedValue(validated) }) as unknown as ProductImageValidatorService;

const storage = (bytes = validated.bytes) =>
  ({
    bucket: 'test-media',
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(bytes),
    delete: vi.fn().mockResolvedValue(undefined),
  }) satisfies MediaStorage;

describe('ProductMediaService', () => {
  it('stores an approved product image under a generated key and audits the committed mutation', async () => {
    const created = productImageRecord();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'product-1' }]),
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      productImage: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: null } }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          ...created,
          objectKey: data.objectKey,
          objectKeyHash: data.objectKeyHash,
        })),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 1 }) },
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const mediaStorage = storage();
    const service = new ProductMediaService(prisma, validator(), mediaStorage);

    const response = await service.upload(
      'product-1',
      {
        expectedOwnerVersion: 1,
        altTextFr: 'Produit violet',
        altTextAr: 'منتج بنفسجي',
      },
      { buffer: validated.bytes, mimetype: 'image/png', originalname: '../../evil.exe', size: 13 },
      context,
    );

    expect(mediaStorage.put).toHaveBeenCalledOnce();
    expect(mediaStorage.put).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: expect.stringMatching(
          /^products\/product-1\/product\/[a-f0-9]{36}\.png$/,
        ) as string,
        bytes: validated.bytes,
        contentType: 'image/png',
        checksumSha256: validated.checksumSha256,
      }),
    );
    expect(transaction.productImage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'product-1',
          variantId: null,
          moderationStatus: 'APPROVED',
          isPrimary: true,
          sortOrder: 0,
        }) as object,
      }),
    );
    expect(transaction.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'product-1', deletedAt: null, version: 1 },
      data: { version: { increment: 1 } },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'administrator-1',
          action: 'catalog.product_image.upload',
          resourceType: 'ProductImage',
        }) as object,
      }),
    );
    expect(response.data).toMatchObject({
      id: 'image-1',
      ownerVersion: 2,
      url: expect.stringMatching(/^\/api\/v1\/media\/[a-f0-9]{64}$/) as string,
    });
  });

  it('deletes a staged object when the database transaction fails', async () => {
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 1 }) },
      $transaction: vi.fn().mockRejectedValue(new Error('database unavailable')),
    } as unknown as PrismaService;
    const mediaStorage = storage();
    const service = new ProductMediaService(prisma, validator(), mediaStorage);

    await expect(
      service.upload(
        'product-1',
        { expectedOwnerVersion: 1, altTextFr: 'Image', altTextAr: 'صورة' },
        { buffer: validated.bytes, mimetype: 'image/png', originalname: 'image.png', size: 13 },
        context,
      ),
    ).rejects.toThrow('database unavailable');

    const putCall = vi.mocked(mediaStorage.put).mock.calls[0] as
      [StoreMediaObjectInput] | undefined;
    const stagedKey = putCall?.[0].objectKey;
    expect(stagedKey).toBeDefined();
    expect(mediaStorage.delete).toHaveBeenCalledWith(stagedKey);
  });

  it('commits a deterministic cleanup event before deleting a soft-deleted object', async () => {
    const current = productImageRecord();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'product-1' }]),
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      productImage: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(current)
          .mockResolvedValueOnce(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-delete' }) },
      outboxEvent: { upsert: vi.fn().mockResolvedValue({ id: 'outbox-delete' }) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const mediaStorage = storage();
    const service = new ProductMediaService(prisma, validator(), mediaStorage);

    await expect(service.remove('product-1', 'image-1', 1, context)).resolves.toMatchObject({
      data: { id: 'image-1', deleted: true, ownerVersion: 2 },
    });

    expect(transaction.outboxEvent.upsert).toHaveBeenCalledWith({
      where: { deterministicKey: 'media-object-delete:v1:image-1' },
      update: {},
      create: expect.objectContaining({
        aggregateType: 'ProductImage',
        aggregateId: 'image-1',
        eventType: 'media.object.delete.requested',
        payload: {
          objectKey: current.objectKey,
          bucket: current.bucket,
        },
      }) as object,
    });
    expect(mediaStorage.delete).toHaveBeenCalledWith(current.objectKey);
  });

  it('rejects stale owner state before creating an object', async () => {
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 4 }) },
    } as unknown as PrismaService;
    const mediaStorage = storage();
    const service = new ProductMediaService(prisma, validator(), mediaStorage);

    await expect(
      service.upload(
        'product-1',
        { expectedOwnerVersion: 3, altTextFr: 'Image', altTextAr: 'صورة' },
        { buffer: validated.bytes, mimetype: 'image/png', originalname: 'image.png', size: 13 },
        context,
      ),
    ).rejects.toMatchObject({ response: { code: 'PRODUCT_MEDIA_VERSION_CONFLICT' } });
    expect(mediaStorage.put).not.toHaveBeenCalled();
  });

  it('does not disclose or mutate an image owned by another product', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const transaction = {
      productImage: { findFirst, updateMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const mediaStorage = storage();
    const service = new ProductMediaService(prisma, validator(), mediaStorage);

    await expect(
      service.updateMetadata(
        'product-requested',
        'image-owned-elsewhere',
        { expectedOwnerVersion: 1, altTextFr: 'Nouvelle description' },
        context,
      ),
    ).rejects.toMatchObject({ response: { code: 'PRODUCT_IMAGE_NOT_FOUND' } });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'image-owned-elsewhere',
          deletedAt: null,
          OR: [
            { productId: 'product-requested', variantId: null },
            {
              productId: null,
              variant: { is: { productId: 'product-requested' } },
            },
          ],
        }) as object,
      }),
    );
    expect(transaction.productImage.updateMany).not.toHaveBeenCalled();
    expect(mediaStorage.delete).not.toHaveBeenCalled();
  });

  it('reads only approved public media and verifies stored bytes before returning them', async () => {
    const bytes = Buffer.from('stored-public-image');
    const checksumSha256 = createHash('sha256').update(bytes).digest('hex');
    const findFirst = vi.fn().mockResolvedValue({
      objectKey: 'products/product-1/product/public.png',
      contentType: 'image/png',
      byteSize: bytes.length,
      checksumSha256,
    });
    const prisma = { productImage: { findFirst } } as unknown as PrismaService;
    const mediaStorage = storage(bytes);
    const service = new ProductMediaService(prisma, validator(), mediaStorage);

    await expect(service.readPublic('b'.repeat(64))).resolves.toEqual({
      bytes,
      contentType: 'image/png',
      byteSize: bytes.length,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          objectKeyHash: 'b'.repeat(64),
          bucket: 'test-media',
          deletedAt: null,
          moderationStatus: 'APPROVED',
          OR: expect.any(Array) as Prisma.ProductImageWhereInput[],
        }) as object,
      }),
    );
    expect(mediaStorage.get).toHaveBeenCalledWith('products/product-1/product/public.png');
  });

  it('returns the same not-found result for invalid, unpublished, or missing public media', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { productImage: { findFirst } } as unknown as PrismaService;
    const mediaStorage = storage();
    const service = new ProductMediaService(prisma, validator(), mediaStorage);

    await expect(service.readPublic('../secret')).rejects.toMatchObject({
      response: { code: 'MEDIA_NOT_FOUND' },
    });
    await expect(service.readPublic('c'.repeat(64))).rejects.toMatchObject({
      response: { code: 'MEDIA_NOT_FOUND' },
    });
    expect(findFirst).toHaveBeenCalledOnce();
    expect(mediaStorage.get).not.toHaveBeenCalled();
  });

  it('fails closed when stored media no longer matches its immutable checksum', async () => {
    const bytes = Buffer.from('tampered');
    const prisma = {
      productImage: {
        findFirst: vi.fn().mockResolvedValue({
          objectKey: 'products/product-1/product/public.png',
          contentType: 'image/png',
          byteSize: bytes.length,
          checksumSha256: '0'.repeat(64),
        }),
      },
    } as unknown as PrismaService;
    const service = new ProductMediaService(prisma, validator(), storage(bytes));

    await expect(service.readPublic('d'.repeat(64))).rejects.toMatchObject({
      response: { code: 'MEDIA_INTEGRITY_FAILURE' },
    });
  });
});
