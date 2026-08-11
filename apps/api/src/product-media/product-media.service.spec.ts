import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import type { ProductImageValidatorService } from './product-image-validator.service';
import {
  ProductMediaService,
  publicProductImageRenditionUrls,
  type ProductMediaMutationContext,
} from './product-media.service';
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
  originalFilename: 'safe-image.png',
  byteSize: Buffer.byteLength('decoded-image'),
  checksumSha256: createHash('sha256').update('decoded-image').digest('hex'),
  width: 320,
  height: 240,
  renditions: [],
};

const productImageRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'image-1',
  productId: 'product-1',
  variantId: null,
  objectKey: 'products/product-1/product/random.png',
  objectKeyHash: 'a'.repeat(64),
  bucket: 'test-media',
  contentType: 'image/png',
  originalFilename: validated.originalFilename,
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
  updatedAt: new Date('2026-07-20T00:05:00.000Z'),
  deletedAt: null,
  product: { id: 'product-1', version: 1 },
  variant: null,
  renditions: [],
  ...overrides,
});

const completeRenditionManifest = (
  productImageId: string,
  requestedOverride: Partial<{
    byteSize: number;
    checksumSha256: string;
    width: number;
    height: number;
  }> = {},
) =>
  ['thumbnail', 'card', 'detail', 'high-resolution'].flatMap((name) =>
    ['webp', 'jpeg'].map((format) => ({
      productImageId,
      name,
      format,
      profileVersion: 1,
      byteSize: 1,
      checksumSha256: '0'.repeat(64),
      width: 1,
      height: 1,
      ...(name === 'card' && format === 'webp' ? requestedOverride : {}),
    })),
  );

const validator = () =>
  ({ validate: vi.fn().mockResolvedValue(validated) }) as unknown as ProductImageValidatorService;

const storage = (bytes = validated.bytes) =>
  ({
    bucket: 'test-media',
    put: vi.fn<(input: StoreMediaObjectInput) => Promise<void>>().mockResolvedValue(undefined),
    get: vi
      .fn<(objectKey: string, maximumBytes: number) => Promise<Buffer>>()
      .mockResolvedValue(bytes),
    delete: vi.fn().mockResolvedValue(undefined),
  }) satisfies MediaStorage;

describe('ProductMediaService', () => {
  it('advertises optimized public URLs only for a complete current-profile manifest', () => {
    const objectKeyHash = 'a'.repeat(64);

    expect(publicProductImageRenditionUrls(objectKeyHash, [])).toEqual({
      thumbnail: `/api/v1/media/${objectKeyHash}`,
      card: `/api/v1/media/${objectKeyHash}`,
      detail: `/api/v1/media/${objectKeyHash}`,
      highResolution: `/api/v1/media/${objectKeyHash}`,
    });
    expect(
      publicProductImageRenditionUrls(objectKeyHash, completeRenditionManifest('image-1')),
    ).toEqual({
      thumbnail: `/api/v1/media/${objectKeyHash}/thumbnail/v1`,
      card: `/api/v1/media/${objectKeyHash}/card/v1`,
      detail: `/api/v1/media/${objectKeyHash}/detail/v1`,
      highResolution: `/api/v1/media/${objectKeyHash}/high-resolution/v1`,
    });
  });

  it('stores an approved product image under a generated key and audits the committed mutation', async () => {
    const created = productImageRecord();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'product-1' }]),
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      productImage: {
        findFirst: vi.fn().mockResolvedValue(null),
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
    const renditionBytes = Buffer.from('card-webp');
    const imageValidator = {
      validate: vi.fn().mockResolvedValue({
        ...validated,
        renditions: [
          {
            name: 'card',
            format: 'webp',
            contentType: 'image/webp',
            extension: 'webp',
            bytes: renditionBytes,
            byteSize: renditionBytes.length,
            checksumSha256: createHash('sha256').update(renditionBytes).digest('hex'),
            width: 320,
            height: 240,
          },
        ],
      }),
    } as unknown as ProductImageValidatorService;
    const service = new ProductMediaService(prisma, imageValidator, mediaStorage);

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

    expect(mediaStorage.put).toHaveBeenCalledTimes(2);
    expect(mediaStorage.put).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        objectKey: expect.stringMatching(
          /^products\/product-1\/product\/[a-f0-9]{36}\.png$/,
        ) as string,
        bytes: validated.bytes,
        contentType: 'image/png',
        checksumSha256: validated.checksumSha256,
      }),
    );
    const originalObjectKey = vi.mocked(mediaStorage.put).mock.calls[0]?.[0].objectKey;
    expect(mediaStorage.put).toHaveBeenNthCalledWith(2, {
      objectKey: `${originalObjectKey}.renditions/v1/card.webp`,
      bytes: renditionBytes,
      contentType: 'image/webp',
      checksumSha256: createHash('sha256').update(renditionBytes).digest('hex'),
    });
    expect(transaction.productImage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'product-1',
          variantId: null,
          originalFilename: 'safe-image.png',
          moderationStatus: 'APPROVED',
          isPrimary: true,
          sortOrder: 0,
          renditions: {
            create: [
              expect.objectContaining({
                name: 'card',
                format: 'webp',
                profileVersion: 1,
                byteSize: renditionBytes.length,
                checksumSha256: createHash('sha256').update(renditionBytes).digest('hex'),
              }),
            ],
          },
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
      originalFilename: 'safe-image.png',
      updatedAt: '2026-07-20T00:05:00.000Z',
      url: '/api/v1/admin/products/product-1/images/image-1/content',
      renditions: {
        thumbnail: '/api/v1/admin/products/product-1/images/image-1/content',
        card: '/api/v1/admin/products/product-1/images/image-1/content',
        detail: '/api/v1/admin/products/product-1/images/image-1/content',
        highResolution: '/api/v1/admin/products/product-1/images/image-1/content',
      },
    });
  });

  it('rejects duplicate processed bytes within one owner and removes the staged object', async () => {
    const duplicate = { id: 'existing-image' };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'product-1' }]),
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 1 }),
        updateMany: vi.fn(),
      },
      productImage: {
        findFirst: vi.fn().mockResolvedValue(duplicate),
        count: vi.fn(),
        create: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 1 }) },
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
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
    ).rejects.toMatchObject({ response: { code: 'PRODUCT_IMAGE_DUPLICATE' } });

    expect(transaction.productImage.findFirst).toHaveBeenCalledWith({
      where: {
        productId: 'product-1',
        variantId: null,
        checksumSha256: validated.checksumSha256,
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(transaction.productImage.count).not.toHaveBeenCalled();
    expect(transaction.productImage.create).not.toHaveBeenCalled();
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
    expect(mediaStorage.delete).toHaveBeenCalledOnce();
  });

  it('rejects a byte-identical replacement after locking its owner and removes the staged object', async () => {
    const current = productImageRecord();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'product-1' }]),
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 1 }),
        updateMany: vi.fn(),
      },
      productImage: {
        findFirst: vi.fn().mockResolvedValue(current),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      auditLog: { create: vi.fn() },
      outboxEvent: { upsert: vi.fn() },
    };
    const prisma = {
      productImage: { findFirst: vi.fn().mockResolvedValue(current) },
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const mediaStorage = storage();
    const service = new ProductMediaService(prisma, validator(), mediaStorage);

    await expect(
      service.replace(
        'product-1',
        current.id,
        { expectedOwnerVersion: 1 },
        { buffer: validated.bytes, mimetype: 'image/png', originalname: 'same.png', size: 13 },
        context,
      ),
    ).rejects.toMatchObject({ response: { code: 'PRODUCT_IMAGE_UNCHANGED' } });

    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.productImage.create).not.toHaveBeenCalled();
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
    expect(transaction.outboxEvent.upsert).not.toHaveBeenCalled();
    expect(mediaStorage.delete).toHaveBeenCalledOnce();
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
      where: { deterministicKey: 'media-object-delete:v2:image-1' },
      update: {},
      create: expect.objectContaining({
        aggregateType: 'ProductImage',
        aggregateId: 'image-1',
        eventType: 'media.object.delete.requested',
        payload: {
          objectKeys: expect.arrayContaining([
            current.objectKey,
            `${current.objectKey}.renditions/thumbnail.webp`,
            `${current.objectKey}.renditions/high-resolution.jpg`,
          ]) as string[],
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
    expect(mediaStorage.get).toHaveBeenCalledWith(
      'products/product-1/product/public.png',
      bytes.length,
    );
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

  it('fails cheaply when a complete manifest points to a missing immutable rendition object', async () => {
    const expected = Buffer.from('expected-webp');
    const record = {
      id: 'image-1',
      objectKey: 'products/product-1/product/public.png',
      contentType: 'image/png',
      byteSize: 20,
      checksumSha256: '1'.repeat(64),
      renditions: completeRenditionManifest('image-1', {
        byteSize: expected.length,
        checksumSha256: createHash('sha256').update(expected).digest('hex'),
        width: 720,
        height: 480,
      }),
    };
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const mediaStorage = storage();
    vi.mocked(mediaStorage.get).mockRejectedValueOnce(missing);
    const createRendition = vi.fn();
    const createRenditions = vi.fn();
    const imageValidator = {
      validate: vi.fn(),
      createRendition,
      createRenditions,
    } as unknown as ProductImageValidatorService;
    const createMany = vi.fn();
    const findMany = vi.fn();
    const prisma = {
      productImage: { findFirst: vi.fn().mockResolvedValue(record) },
      productImageRendition: { createMany, findMany },
    } as unknown as PrismaService;
    const service = new ProductMediaService(prisma, imageValidator, mediaStorage);

    await expect(service.readPublicRendition('e'.repeat(64), 'card', 'webp')).rejects.toMatchObject(
      {
        response: { code: 'MEDIA_NOT_FOUND' },
      },
    );
    expect(mediaStorage.get).toHaveBeenCalledWith(
      `${record.objectKey}.renditions/v1/card.webp`,
      expected.length,
    );
    expect(mediaStorage.get).toHaveBeenCalledOnce();
    expect(mediaStorage.put).not.toHaveBeenCalled();
    expect(createRendition).not.toHaveBeenCalled();
    expect(createRenditions).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('does not backfill or enqueue work for a legacy image without a persisted rendition manifest', async () => {
    const record = {
      id: 'legacy-image',
      objectKey: 'products/product-1/product/legacy.png',
      contentType: 'image/png',
      byteSize: 20,
      checksumSha256: '1'.repeat(64),
      renditions: [],
    };
    const mediaStorage = storage();
    const createRendition = vi.fn();
    const createRenditions = vi.fn();
    const imageValidator = {
      createRendition,
      createRenditions,
    } as unknown as ProductImageValidatorService;
    const createMany = vi.fn();
    const findMany = vi.fn();
    const prisma = {
      productImage: { findFirst: vi.fn().mockResolvedValue(record) },
      productImageRendition: { createMany, findMany },
    } as unknown as PrismaService;
    const service = new ProductMediaService(prisma, imageValidator, mediaStorage);

    await expect(service.readPublicRendition('b'.repeat(64), 'card', 'webp')).rejects.toMatchObject(
      {
        response: { code: 'MEDIA_NOT_FOUND' },
      },
    );
    expect(mediaStorage.get).not.toHaveBeenCalled();
    expect(mediaStorage.put).not.toHaveBeenCalled();
    expect(createRendition).not.toHaveBeenCalled();
    expect(createRenditions).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('serves a cached rendition only when it matches the deterministic rendition checksum', async () => {
    const original = Buffer.from('stored-public-image');
    const generated = Buffer.from('generated-webp');
    const record = {
      id: 'image-1',
      objectKey: 'products/product-1/product/public.png',
      contentType: 'image/png',
      byteSize: original.length,
      checksumSha256: createHash('sha256').update(original).digest('hex'),
      renditions: completeRenditionManifest('image-1', {
        byteSize: generated.length,
        checksumSha256: createHash('sha256').update(generated).digest('hex'),
        width: 720,
        height: 480,
      }),
    };
    const mediaStorage = storage();
    vi.mocked(mediaStorage.get).mockResolvedValueOnce(generated);
    const createRendition = vi.fn();
    const imageValidator = {
      createRendition,
    } as unknown as ProductImageValidatorService;
    const prisma = {
      productImage: { findFirst: vi.fn().mockResolvedValue(record) },
    } as unknown as PrismaService;
    const service = new ProductMediaService(prisma, imageValidator, mediaStorage);

    await expect(service.readPublicRendition('f'.repeat(64), 'card', 'webp')).resolves.toEqual({
      bytes: generated,
      contentType: 'image/webp',
      byteSize: generated.length,
    });
    expect(mediaStorage.get).toHaveBeenCalledOnce();
    expect(createRendition).not.toHaveBeenCalled();
    expect(mediaStorage.put).not.toHaveBeenCalled();
  });

  it('rejects a structurally valid cached rendition with different image bytes', async () => {
    const original = Buffer.from('stored-public-image');
    const expected = Buffer.from('expected-webp');
    const alternate = Buffer.from('replaced-webp');
    const record = {
      id: 'image-1',
      objectKey: 'products/product-1/product/public.png',
      contentType: 'image/png',
      byteSize: original.length,
      checksumSha256: createHash('sha256').update(original).digest('hex'),
      renditions: completeRenditionManifest('image-1', {
        byteSize: expected.length,
        checksumSha256: createHash('sha256').update(expected).digest('hex'),
        width: 720,
        height: 480,
      }),
    };
    const mediaStorage = storage();
    vi.mocked(mediaStorage.get).mockResolvedValueOnce(alternate);
    const createRendition = vi.fn();
    const imageValidator = {
      createRendition,
    } as unknown as ProductImageValidatorService;
    const prisma = {
      productImage: { findFirst: vi.fn().mockResolvedValue(record) },
    } as unknown as PrismaService;
    const service = new ProductMediaService(prisma, imageValidator, mediaStorage);

    await expect(service.readPublicRendition('a'.repeat(64), 'card', 'webp')).rejects.toMatchObject(
      {
        response: { code: 'MEDIA_INTEGRITY_FAILURE' },
      },
    );
    expect(createRendition).not.toHaveBeenCalled();
    expect(mediaStorage.put).not.toHaveBeenCalled();
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

  it('atomically stages operator-imported media as pending, non-primary, and checkpointed', async () => {
    const pending = productImageRecord({
      moderationStatus: 'PENDING',
      isPrimary: false,
      product: { id: 'product-1', version: 4 },
    });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'product-1' }]),
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 4 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      productImage: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: null } }),
        create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          ...pending,
          ...data,
          product: { id: 'product-1', version: 4 },
          variant: null,
        })),
        updateMany: vi.fn(),
      },
      catalogImportRow: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      catalogSourceRecord: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'source-prior',
          imageId: 'image-prior',
        }),
        update: vi.fn().mockResolvedValue({ id: 'source-prior' }),
        create: vi.fn().mockResolvedValue({ id: 'source-current' }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-import' }) },
    };
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 4 }) },
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const mediaStorage = storage();
    const service = new ProductMediaService(prisma, validator(), mediaStorage);

    const result = await service.uploadImported(
      'product-1',
      {
        expectedOwnerVersion: 4,
        altTextFr: 'Image importée',
        altTextAr: 'صورة مستوردة',
        isPrimary: false,
      },
      { buffer: validated.bytes, mimetype: 'image/png', originalname: 'source.png', size: 13 },
      {
        source: 'ADMIN_UPLOAD',
        externalKey: 'product-key:primary',
        sourceUrl: 'https://media.example.com/source.png',
        sourceUrlHash: '1'.repeat(64),
        originalChecksumSha256: '2'.repeat(64),
        expectedProductVersion: 4,
        productCheckpointRowIds: ['row-1'],
      },
      context,
    );

    expect(transaction.productImage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          moderationStatus: 'PENDING',
          isPrimary: false,
        }) as object,
      }),
    );
    expect(transaction.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'product-1', deletedAt: null, version: 4 },
      data: { version: { increment: 1 }, needsMediaReview: true },
    });
    expect(transaction.catalogImportRow.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['row-1'] } },
      data: { productPostVersion: 5 },
    });
    expect(transaction.catalogSourceRecord.update).toHaveBeenCalledWith({
      where: { id: 'source-prior' },
      data: { externalKey: 'history::source-prior' },
    });
    expect(transaction.catalogSourceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'ADMIN_UPLOAD',
          verifiedAt: null,
          imageId: 'image-1',
        }) as object,
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          afterSummary: expect.objectContaining({
            sourceRecordId: 'source-current',
            sourceUrlHash: '1'.repeat(64),
            originalChecksumSha256: '2'.repeat(64),
            supersededSourceRecordId: 'source-prior',
            supersededImageId: 'image-prior',
          }) as object,
        }) as object,
      }),
    );
    expect(JSON.stringify(transaction.auditLog.create.mock.calls[0]?.[0])).not.toContain(
      'https://media.example.com/source.png',
    );
    expect(result).toMatchObject({
      data: { id: 'image-1', moderationStatus: 'PENDING', isPrimary: false, ownerVersion: 5 },
      productVersion: 5,
    });
    expect(mediaStorage.put).toHaveBeenCalledOnce();
  });

  it('atomically checkpoints a pending variant import and flags the parent product', async () => {
    const pending = productImageRecord({
      id: 'image-variant-1',
      productId: null,
      variantId: 'variant-1',
      moderationStatus: 'PENDING',
      isPrimary: false,
      product: null,
      variant: { id: 'variant-1', productId: 'product-1', version: 6 },
    });
    const checkpointRows = vi
      .fn()
      .mockImplementation(({ where }: { where: { id: string | { in: string[] } } }) =>
        Promise.resolve({ count: typeof where.id === 'string' ? 1 : where.id.in.length }),
      );
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked-owner' }]),
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 4 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      productVariant: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'variant-1', productId: 'product-1', version: 6 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      productImage: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: null } }),
        create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          ...pending,
          ...data,
          product: null,
          variant: { id: 'variant-1', productId: 'product-1', version: 6 },
        })),
      },
      catalogImportRow: { updateMany: checkpointRows },
      catalogSourceRecord: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'source-variant-1' }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-variant-import' }) },
    };
    const runTransaction = vi.fn((callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    );
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 4 }) },
      productVariant: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'variant-1', productId: 'product-1', version: 6 }),
      },
      $transaction: runTransaction,
    } as unknown as PrismaService;
    const mediaStorage = storage();
    const service = new ProductMediaService(prisma, validator(), mediaStorage);

    const result = await service.uploadImported(
      'product-1',
      {
        variantId: 'variant-1',
        expectedOwnerVersion: 6,
        altTextFr: 'Image de variante importÃ©e',
        altTextAr: 'ØµÙˆØ±Ø© Ù…Ø³ØªÙˆØ±Ø¯Ø© Ù„Ù„Ù†Ø³Ø®Ø©',
        isPrimary: false,
      },
      { buffer: validated.bytes, mimetype: 'image/png', originalname: 'variant.png', size: 13 },
      {
        source: 'ADMIN_UPLOAD',
        externalKey: 'variant-key:primary',
        sourceUrl: 'https://media.example.com/variant.png',
        sourceUrlHash: '3'.repeat(64),
        originalChecksumSha256: '4'.repeat(64),
        expectedProductVersion: 4,
        productCheckpointRowIds: ['row-product', 'row-variant'],
        variantCheckpointRowId: 'row-variant',
      },
      context,
    );

    expect(runTransaction).toHaveBeenCalledOnce();
    expect(transaction.productImage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: null,
          variantId: 'variant-1',
          moderationStatus: 'PENDING',
          isPrimary: false,
        }) as object,
      }),
    );
    expect(transaction.productVariant.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'variant-1',
        productId: 'product-1',
        deletedAt: null,
        version: 6,
      },
      data: { version: { increment: 1 } },
    });
    expect(transaction.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'product-1', version: 4, deletedAt: null },
      data: { needsMediaReview: true, version: { increment: 1 } },
    });
    expect(checkpointRows).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ['row-product', 'row-variant'] } },
      data: { productPostVersion: 5 },
    });
    expect(checkpointRows).toHaveBeenNthCalledWith(2, {
      where: { id: 'row-variant' },
      data: { postVersion: 7 },
    });
    expect(result).toMatchObject({
      data: {
        id: 'image-variant-1',
        variantId: 'variant-1',
        moderationStatus: 'PENDING',
        isPrimary: false,
        ownerVersion: 7,
      },
      productVersion: 5,
    });
    expect(mediaStorage.put).toHaveBeenCalledOnce();
  });

  it('reviews variant-owned media while versioning both the variant and its parent product', async () => {
    const pending = productImageRecord({
      id: 'image-variant-1',
      productId: null,
      variantId: 'variant-1',
      moderationStatus: 'PENDING',
      isPrimary: false,
      product: null,
      variant: { id: 'variant-1', productId: 'product-1', version: 6 },
    });
    const approved = productImageRecord({
      ...pending,
      moderationStatus: 'APPROVED',
      isPrimary: false,
    });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked-owner' }]),
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 4 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      productVariant: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'variant-1', productId: 'product-1', version: 6 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      productImage: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(pending)
          .mockResolvedValueOnce({ id: 'existing-primary' })
          .mockResolvedValueOnce(approved),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-variant-review' }) },
    };
    const prisma = {
      productImage: { findFirst: vi.fn().mockResolvedValue(pending) },
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new ProductMediaService(prisma, validator(), storage());

    await expect(
      service.review(
        'product-1',
        'image-variant-1',
        {
          expectedOwnerVersion: 6,
          decision: 'APPROVE',
          confirmation: 'REVIEW_IMPORTED_PRODUCT_IMAGE',
        },
        context,
      ),
    ).resolves.toMatchObject({
      data: {
        id: 'image-variant-1',
        variantId: 'variant-1',
        moderationStatus: 'APPROVED',
        isPrimary: false,
        ownerVersion: 7,
      },
    });

    expect(transaction.productVariant.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'variant-1',
        productId: 'product-1',
        deletedAt: null,
        version: 6,
      },
      data: { version: { increment: 1 } },
    });
    expect(transaction.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'product-1', version: 4, deletedAt: null },
      data: { needsMediaReview: true, version: { increment: 1 } },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'catalog.product_image.review',
          afterSummary: expect.objectContaining({
            decision: 'APPROVE',
            ownerVersion: 7,
            productVersion: 5,
          }) as object,
        }) as object,
      }),
    );
  });

  it('approves a pending import without demoting an existing approved primary', async () => {
    const pending = productImageRecord({
      moderationStatus: 'PENDING',
      isPrimary: false,
      product: { id: 'product-1', version: 4 },
    });
    const approved = productImageRecord({
      moderationStatus: 'APPROVED',
      isPrimary: false,
      product: { id: 'product-1', version: 4 },
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'product-1' }]),
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 4 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      productImage: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(pending)
          .mockResolvedValueOnce({ id: 'manual-primary' })
          .mockResolvedValueOnce(approved),
        updateMany,
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-review' }) },
    };
    const prisma = {
      productImage: { findFirst: vi.fn().mockResolvedValue(pending) },
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new ProductMediaService(prisma, validator(), storage());

    await expect(
      service.review(
        'product-1',
        'image-1',
        {
          expectedOwnerVersion: 4,
          decision: 'APPROVE',
          confirmation: 'REVIEW_IMPORTED_PRODUCT_IMAGE',
        },
        context,
      ),
    ).resolves.toMatchObject({
      data: { moderationStatus: 'APPROVED', isPrimary: false, ownerVersion: 5 },
    });

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ moderationStatus: 'PENDING' }) as object,
        data: { moderationStatus: 'APPROVED', isPrimary: false },
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'catalog.product_image.review',
          afterSummary: expect.objectContaining({ decision: 'APPROVE' }) as object,
        }) as object,
      }),
    );
  });

  it('rejects repeated review of an image that is no longer pending', async () => {
    const approved = productImageRecord({ product: { id: 'product-1', version: 4 } });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'product-1' }]),
      product: { findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 4 }) },
      productImage: { findFirst: vi.fn().mockResolvedValue(approved), updateMany: vi.fn() },
    };
    const prisma = {
      productImage: { findFirst: vi.fn().mockResolvedValue(approved) },
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new ProductMediaService(prisma, validator(), storage());

    await expect(
      service.review(
        'product-1',
        'image-1',
        {
          expectedOwnerVersion: 4,
          decision: 'REJECT',
          confirmation: 'REVIEW_IMPORTED_PRODUCT_IMAGE',
        },
        context,
      ),
    ).rejects.toMatchObject({ response: { code: 'PRODUCT_IMAGE_REVIEW_NOT_PENDING' } });
    expect(transaction.productImage.updateMany).not.toHaveBeenCalled();
  });

  it('records an explicit rejection and never makes the pending image primary', async () => {
    const pending = productImageRecord({
      moderationStatus: 'PENDING',
      isPrimary: false,
      product: { id: 'product-1', version: 4 },
    });
    const rejected = productImageRecord({
      moderationStatus: 'REJECTED',
      isPrimary: false,
      product: { id: 'product-1', version: 4 },
    });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'product-1' }]),
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: 'product-1', version: 4 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      productImage: {
        findFirst: vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(rejected),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-reject' }) },
    };
    const prisma = {
      productImage: { findFirst: vi.fn().mockResolvedValue(pending) },
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new ProductMediaService(prisma, validator(), storage());

    await expect(
      service.review(
        'product-1',
        'image-1',
        {
          expectedOwnerVersion: 4,
          decision: 'REJECT',
          confirmation: 'REVIEW_IMPORTED_PRODUCT_IMAGE',
        },
        context,
      ),
    ).resolves.toMatchObject({
      data: { moderationStatus: 'REJECTED', isPrimary: false, ownerVersion: 5 },
    });
    expect(transaction.productImage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { moderationStatus: 'REJECTED', isPrimary: false },
      }),
    );
  });

  it('rejects a stale pending-image review before opening a transaction', async () => {
    const pending = productImageRecord({
      moderationStatus: 'PENDING',
      isPrimary: false,
      product: { id: 'product-1', version: 5 },
    });
    const transaction = vi.fn();
    const prisma = {
      productImage: { findFirst: vi.fn().mockResolvedValue(pending) },
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new ProductMediaService(prisma, validator(), storage());

    await expect(
      service.review(
        'product-1',
        'image-1',
        {
          expectedOwnerVersion: 4,
          decision: 'APPROVE',
          confirmation: 'REVIEW_IMPORTED_PRODUCT_IMAGE',
        },
        context,
      ),
    ).rejects.toMatchObject({ response: { code: 'PRODUCT_MEDIA_VERSION_CONFLICT' } });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('lets administrators inspect pending bytes without making them publicly readable', async () => {
    const pending = productImageRecord({
      moderationStatus: 'PENDING',
      isPrimary: false,
      product: { id: 'product-1', version: 4 },
    });
    const findFirst = vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(null);
    const prisma = { productImage: { findFirst } } as unknown as PrismaService;
    const mediaStorage = storage(validated.bytes);
    const service = new ProductMediaService(prisma, validator(), mediaStorage);

    await expect(service.readAdmin('product-1', 'image-1')).resolves.toMatchObject({
      bytes: validated.bytes,
      contentType: 'image/png',
    });
    await expect(service.readPublic('a'.repeat(64))).rejects.toMatchObject({
      response: { code: 'MEDIA_NOT_FOUND' },
    });
    expect(mediaStorage.get).toHaveBeenCalledOnce();
  });
});
