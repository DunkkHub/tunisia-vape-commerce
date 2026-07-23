import type { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RedisService } from '../cache/redis.service';
import type { Environment } from '../config/environment';
import type { PrismaService } from '../database/prisma.service';
import type { ProductMediaService } from '../product-media/product-media.service';
import type { CatalogImportRowInput } from './catalog-import-contract';
import { sha256 } from './catalog-identity';
import { CatalogMediaImportService } from './catalog-media-import.service';

const actor = { userId: 'admin-1', requestId: 'request-1' };
const input = {
  productKey: 'wotofo-product',
  variantKey: 'variant-a',
  nameFr: 'Produit Wotofo',
  nameAr: 'منتج ووتوفو',
  variantNameFr: 'Saveur A',
  variantNameAr: 'نكهة أ',
  productImageUrl: 'https://cdn.shopify.com/s/files/product.jpg',
  variantImageUrl: null,
} as CatalogImportRowInput;
const applied = {
  id: 'row-1',
  rowNumber: 1,
  productId: 'product-1',
  variantId: 'variant-1',
  productPostVersion: 4,
  postVersion: 6,
};

const testable = (service: CatalogMediaImportService) =>
  service as unknown as {
    importProductGroup: (
      group: Array<{ input: CatalogImportRowInput; applied: typeof applied }>,
      context: typeof actor,
      source: 'ADMIN_UPLOAD' | 'WOTOFO_OFFICIAL',
      overrideImages: boolean,
      lockGuard?: () => Promise<void>,
    ) => Promise<{
      rejected: Array<{ code?: string }>;
      duplicates: Array<{ code?: string }>;
      manualReview: boolean;
    }>;
    assertBoundedMediaWork: (
      groups: Array<Array<{ input: CatalogImportRowInput; applied: typeof applied }>>,
    ) => void;
    renewLock: (batchId: string, token: string) => Promise<void>;
  };

const serviceWith = (
  prisma: Record<string, unknown>,
  media: Record<string, unknown>,
  redis: Record<string, unknown> = {
    connect: vi.fn(),
    client: { set: vi.fn().mockResolvedValue('OK'), eval: vi.fn().mockResolvedValue(1) },
  },
) =>
  new CatalogMediaImportService(
    prisma as unknown as PrismaService,
    {
      get: vi.fn((key: keyof Environment) =>
        key === 'CATALOG_IMPORT_MEDIA_HOSTS' ? [] : 10 * 1_024 * 1_024,
      ),
    } as unknown as ConfigService<Environment, true>,
    media as unknown as ProductMediaService,
    redis as unknown as RedisService,
  );

describe('CatalogMediaImportService rollback integrity', () => {
  it('refuses media work when a product changed after catalogue apply', async () => {
    const media = { upload: vi.fn(), remove: vi.fn() };
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ version: 5 }) },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      $transaction: vi.fn(),
    };

    const report = await testable(serviceWith(prisma, media)).importProductGroup(
      [{ input, applied }],
      actor,
      'WOTOFO_OFFICIAL',
      false,
    );

    expect(report.rejected).toContainEqual({
      owner: 'PRODUCT',
      productKey: 'wotofo-product',
      code: 'IMPORT_OWNER_VERSION_CHANGED',
    });
    expect(media.upload).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not churn owner versions when verified media is replayed', async () => {
    const rowUpdate = vi.fn().mockResolvedValue({});
    const productUpdate = vi.fn();
    const transaction = {
      product: {
        findFirst: vi.fn().mockResolvedValue({ version: 4, needsMediaReview: false }),
        updateMany: productUpdate,
      },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      productImage: { count: vi.fn().mockResolvedValue(0) },
      catalogImportRow: { update: rowUpdate },
    };
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ version: 4 }) },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      catalogSourceRecord: {
        findUnique: vi.fn().mockResolvedValue({
          sourceUrlHash: sha256(input.productImageUrl!),
          image: { id: 'image-1', deletedAt: null, moderationStatus: 'APPROVED' },
        }),
        findFirst: vi.fn().mockResolvedValue({ id: 'source-1' }),
      },
      productImage: { findFirst: vi.fn() },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        Promise.resolve(operation(transaction)),
      ),
    };
    const media = { upload: vi.fn(), remove: vi.fn() };

    const report = await testable(serviceWith(prisma, media)).importProductGroup(
      [{ input, applied }],
      actor,
      'WOTOFO_OFFICIAL',
      false,
    );

    expect(report.duplicates).toContainEqual(expect.objectContaining({ code: 'ALREADY_IMPORTED' }));
    expect(report.manualReview).toBe(false);
    expect(productUpdate).not.toHaveBeenCalled();
    expect(rowUpdate).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { productPostVersion: 4, postVersion: 6 },
    });
    expect(media.upload).not.toHaveBeenCalled();
  });

  it('keeps Wotofo review open when another source left unresolved media on the product', async () => {
    const rowUpdate = vi.fn().mockResolvedValue({});
    const productUpdate = vi.fn();
    const unresolvedImageCount = vi.fn().mockResolvedValue(1);
    const transaction = {
      product: {
        findFirst: vi.fn().mockResolvedValue({ version: 4, needsMediaReview: true }),
        updateMany: productUpdate,
      },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      productImage: { count: unresolvedImageCount },
      catalogImportRow: { update: rowUpdate },
    };
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ version: 4 }) },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      catalogSourceRecord: {
        findUnique: vi.fn().mockResolvedValue({
          sourceUrlHash: sha256(input.productImageUrl!),
          image: { id: 'wotofo-image', deletedAt: null, moderationStatus: 'APPROVED' },
        }),
        findFirst: vi.fn().mockResolvedValue({ id: 'verified-wotofo-source' }),
      },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        Promise.resolve(operation(transaction)),
      ),
    };
    const media = { upload: vi.fn(), remove: vi.fn() };

    const report = await testable(serviceWith(prisma, media)).importProductGroup(
      [{ input, applied }],
      actor,
      'WOTOFO_OFFICIAL',
      false,
    );

    expect(report.duplicates).toContainEqual(expect.objectContaining({ code: 'ALREADY_IMPORTED' }));
    expect(report.manualReview).toBe(true);
    expect(unresolvedImageCount).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        moderationStatus: { in: ['PENDING', 'QUARANTINED'] },
        OR: [
          { productId: 'product-1', variantId: null },
          {
            productId: null,
            variant: { is: { productId: 'product-1', deletedAt: null } },
          },
        ],
      },
    });
    expect(productUpdate).not.toHaveBeenCalled();
    expect(rowUpdate).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { productPostVersion: 4, postVersion: 6 },
    });
    expect(media.upload).not.toHaveBeenCalled();
  });

  it('does not absorb a concurrent manual edit into the rollback baseline', async () => {
    const rowUpdate = vi.fn();
    const transaction = {
      product: {
        findFirst: vi.fn().mockResolvedValue({ version: 5, needsMediaReview: false }),
        updateMany: vi.fn(),
      },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      catalogImportRow: { update: rowUpdate },
    };
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ version: 4 }) },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      catalogSourceRecord: {
        findUnique: vi.fn().mockResolvedValue({
          sourceUrlHash: sha256(input.productImageUrl!),
          image: { id: 'image-1', deletedAt: null, moderationStatus: 'APPROVED' },
        }),
        findFirst: vi.fn().mockResolvedValue({ id: 'source-1' }),
      },
      productImage: { findFirst: vi.fn() },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        Promise.resolve(operation(transaction)),
      ),
    };

    const report = await testable(
      serviceWith(prisma, { upload: vi.fn(), remove: vi.fn() }),
    ).importProductGroup([{ input, applied }], actor, 'WOTOFO_OFFICIAL', false);

    expect(report.rejected).toContainEqual(
      expect.objectContaining({ code: 'IMPORT_OWNER_VERSION_CHANGED' }),
    );
    expect(rowUpdate).not.toHaveBeenCalled();
  });

  it('keeps media review required when a supplied official variant image is rejected', async () => {
    const rowUpdate = vi.fn().mockResolvedValue({});
    const productUpdate = vi.fn();
    const transaction = {
      product: {
        findFirst: vi.fn().mockResolvedValue({ version: 4, needsMediaReview: true }),
        updateMany: productUpdate,
      },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      catalogImportRow: { update: rowUpdate },
    };
    const inputWithVariantImage = {
      ...input,
      variantImageUrl: 'https://cdn.shopify.com/s/files/variant-a.jpg',
    } as CatalogImportRowInput;
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ version: 4 }) },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      catalogSourceRecord: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            sourceUrlHash: sha256(input.productImageUrl!),
            image: { id: 'product-image', deletedAt: null, moderationStatus: 'APPROVED' },
          })
          .mockResolvedValueOnce(null),
        findFirst: vi.fn().mockResolvedValue({ id: 'verified-product-source' }),
      },
      productImage: { findFirst: vi.fn().mockResolvedValue({ id: 'manual-variant-image' }) },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        Promise.resolve(operation(transaction)),
      ),
    };

    const report = await testable(
      serviceWith(prisma, { upload: vi.fn(), remove: vi.fn() }),
    ).importProductGroup(
      [{ input: inputWithVariantImage, applied }],
      actor,
      'WOTOFO_OFFICIAL',
      false,
    );

    expect(report.rejected).toContainEqual(
      expect.objectContaining({ owner: 'VARIANT', code: 'MANUAL_IMAGE_PRESERVED' }),
    );
    expect(report.manualReview).toBe(true);
    expect(productUpdate).not.toHaveBeenCalled();
    expect(rowUpdate).toHaveBeenCalled();
  });

  it('preserves an existing image unless an administrator explicitly selected image override', async () => {
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ version: 4 }) },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      catalogSourceRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      productImage: {
        findFirst: vi.fn().mockResolvedValue({ id: 'manual-image' }),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn().mockResolvedValue({
        synchronized: true,
        mediaReviewResolved: false,
      }),
    };
    const media = { upload: vi.fn(), remove: vi.fn() };

    const report = await testable(serviceWith(prisma, media)).importProductGroup(
      [{ input, applied }],
      actor,
      'ADMIN_UPLOAD',
      false,
    );

    expect(report.rejected).toContainEqual(
      expect.objectContaining({ code: 'MANUAL_IMAGE_PRESERVED' }),
    );
    expect(media.upload).not.toHaveBeenCalled();
  });

  it('stores explicitly overridden operator media as unverified provenance', async () => {
    const rowUpdate = vi.fn().mockResolvedValue({});
    const transaction = {
      product: {
        findFirst: vi.fn().mockResolvedValue({ version: 5, needsMediaReview: true }),
        updateMany: vi.fn(),
      },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      catalogImportRow: { update: rowUpdate },
    };
    const prisma = {
      product: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ version: 4 })
          .mockResolvedValue({ needsMediaReview: true }),
      },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      catalogSourceRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      productImage: {
        findFirst: vi.fn().mockResolvedValue({ id: 'manual-image' }),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        Promise.resolve(operation(transaction)),
      ),
    };
    const media = {
      uploadImported: vi.fn().mockResolvedValue({
        data: { id: 'operator-image', ownerVersion: 5, checksumSha256: 'stored-checksum' },
        productVersion: 5,
      }),
    };
    const service = serviceWith(prisma, media);
    const downloadImage = vi.fn().mockResolvedValue({
      bytes: Buffer.from('raster'),
      contentType: 'image/png',
      originalFilename: 'catalog.png',
      sourceUrl: input.productImageUrl,
      checksumSha256: 'source-checksum',
    });
    (
      service as unknown as {
        operatorSource: { downloadImage: typeof downloadImage };
      }
    ).operatorSource = { downloadImage };

    const report = await testable(service).importProductGroup(
      [{ input, applied }],
      actor,
      'ADMIN_UPLOAD',
      true,
    );

    expect(report.manualReview).toBe(true);
    expect(report.rejected).toHaveLength(0);
    expect(report.duplicates).toHaveLength(0);
    expect(media.uploadImported).toHaveBeenCalledWith(
      'product-1',
      expect.objectContaining({ expectedOwnerVersion: 4, isPrimary: false }),
      expect.objectContaining({ originalname: 'catalog.png' }),
      expect.objectContaining({
        source: 'ADMIN_UPLOAD',
        externalKey: 'wotofo-product:primary',
        expectedProductVersion: 4,
        productCheckpointRowIds: ['row-1'],
      }),
      actor,
    );
    expect(rowUpdate).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { productPostVersion: 5, postVersion: 6 },
    });
  });

  it('rejects a second concurrent media run for the same batch', async () => {
    const service = serviceWith(
      {},
      {},
      {
        connect: vi.fn(),
        client: { set: vi.fn().mockResolvedValue(null), eval: vi.fn() },
      },
    );

    await expect(service.importBatch('batch-1', actor)).rejects.toMatchObject({
      response: { code: 'CATALOG_MEDIA_IMPORT_IN_PROGRESS' },
    });
  });

  it('releases its token-owned Redis lock when media execution fails', async () => {
    const release = vi.fn().mockResolvedValue(1);
    const service = serviceWith(
      {
        catalogImportBatch: {
          findUnique: vi.fn().mockRejectedValue(new Error('database unavailable')),
        },
      },
      {},
      {
        connect: vi.fn(),
        client: { set: vi.fn().mockResolvedValue('OK'), eval: release },
      },
    );

    await expect(service.importBatch('batch-1', actor)).rejects.toThrow('database unavailable');
    expect(release).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get'"),
      2,
      'catalog-media-import:batch-1',
      'catalog-media-import:global',
      expect.any(String),
    );
  });

  it('rejects a distinct batch while the global remote-media capacity lease is occupied', async () => {
    const release = vi.fn().mockResolvedValue(1);
    const service = serviceWith(
      {},
      {},
      {
        connect: vi.fn(),
        client: {
          set: vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null),
          eval: release,
        },
      },
    );

    await expect(service.importBatch('batch-2', actor)).rejects.toMatchObject({
      response: { code: 'CATALOG_MEDIA_IMPORT_CAPACITY_IN_USE' },
    });
    expect(release).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get'"),
      2,
      'catalog-media-import:batch-2',
      'catalog-media-import:global',
      expect.any(String),
    );
  });

  it('renews both token-owned batch and global capacity leases together', async () => {
    const evaluate = vi.fn().mockResolvedValue(1);
    const service = testable(
      serviceWith(
        {},
        {},
        {
          connect: vi.fn(),
          client: { set: vi.fn(), eval: evaluate },
        },
      ),
    );

    await expect(service.renewLock('batch-3', 'token-3')).resolves.toBeUndefined();
    expect(evaluate).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('pexpire', KEYS[2]"),
      2,
      'catalog-media-import:batch-3',
      'catalog-media-import:global',
      'token-3',
      600_000,
    );
  });

  it('stops before upload and final receipt work when the lease is lost during download', async () => {
    const prisma = {
      product: { findFirst: vi.fn().mockResolvedValue({ version: 4 }) },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      catalogSourceRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      productImage: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(),
    };
    const media = { uploadImported: vi.fn() };
    const service = serviceWith(prisma, media);
    const downloadImage = vi.fn().mockResolvedValue({
      bytes: Buffer.from('raster'),
      contentType: 'image/png',
      originalFilename: 'catalog.png',
      sourceUrl: input.productImageUrl,
      checksumSha256: 'source-checksum',
    });
    (
      service as unknown as {
        operatorSource: { downloadImage: typeof downloadImage };
      }
    ).operatorSource = { downloadImage };
    const leaseLost = new ConflictException({
      code: 'CATALOG_MEDIA_IMPORT_LOCK_LOST',
      message: 'lease lost',
    });
    const lockGuard = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(leaseLost);

    const report = await testable(service).importProductGroup(
      [{ input, applied }],
      actor,
      'ADMIN_UPLOAD',
      true,
      lockGuard,
    );

    expect(report.rejected).toContainEqual(
      expect.objectContaining({ code: 'CATALOG_MEDIA_IMPORT_LOCK_LOST' }),
    );
    expect(media.uploadImported).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps the Wotofo CLI entry point restricted to official batches', async () => {
    const service = serviceWith(
      {
        catalogImportBatch: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'operator-batch',
            dryRun: false,
            source: 'ADMIN_UPLOAD',
            status: 'APPLIED',
            rows: [],
          }),
        },
      },
      {},
    );

    await expect(service.importWotofo('operator-batch', actor)).rejects.toMatchObject({
      response: { code: 'CATALOG_MEDIA_IMPORT_NOT_APPLICABLE' },
    });
  });

  it('does not re-open review when an unchanged operator image was already approved', async () => {
    const rowUpdate = vi.fn().mockResolvedValue({});
    const productUpdate = vi.fn();
    const transaction = {
      product: {
        findFirst: vi.fn().mockResolvedValue({ version: 4, needsMediaReview: false }),
        updateMany: productUpdate,
      },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      catalogImportRow: { update: rowUpdate },
    };
    const prisma = {
      product: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ version: 4 })
          .mockResolvedValue({ needsMediaReview: false }),
      },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([{ id: 'variant-1', version: 6 }]),
      },
      catalogSourceRecord: {
        findUnique: vi.fn().mockResolvedValue({
          sourceUrlHash: sha256(input.productImageUrl!),
          image: { id: 'operator-image', deletedAt: null, moderationStatus: 'APPROVED' },
        }),
      },
      productImage: { count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        Promise.resolve(operation(transaction)),
      ),
    };
    const media = { uploadImported: vi.fn() };

    const report = await testable(serviceWith(prisma, media)).importProductGroup(
      [{ input, applied }],
      actor,
      'ADMIN_UPLOAD',
      false,
    );

    expect(report.duplicates).toContainEqual(expect.objectContaining({ code: 'ALREADY_IMPORTED' }));
    expect(report.manualReview).toBe(false);
    expect(productUpdate).not.toHaveBeenCalled();
    expect(media.uploadImported).not.toHaveBeenCalled();
  });

  it('bounds synchronous work per product and per batch', () => {
    const service = testable(serviceWith({}, {}));
    const group = (productKey: string, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        input: {
          ...input,
          productKey,
          variantKey: `variant-${index}`,
          productImageUrl: null,
          variantImageUrl: `https://media.example.com/${productKey}-${index}.png`,
        },
        applied: {
          ...applied,
          id: `${productKey}-row-${index}`,
          rowNumber: index + 1,
          productId: productKey,
          variantId: `${productKey}-variant-${index}`,
        },
      }));

    let productLimitError: unknown;
    try {
      service.assertBoundedMediaWork([group('oversized', 31)]);
    } catch (error) {
      productLimitError = error;
    }
    expect(productLimitError).toMatchObject({
      response: { code: 'CATALOG_MEDIA_PRODUCT_LIMIT_EXCEEDED' },
    });

    let batchLimitError: unknown;
    try {
      service.assertBoundedMediaWork(
        Array.from({ length: 6 }, (_, index) => group(`product-${index}`, 26)),
      );
    } catch (error) {
      batchLimitError = error;
    }
    expect(batchLimitError).toMatchObject({
      response: { code: 'CATALOG_MEDIA_BATCH_LIMIT_EXCEEDED' },
    });
  });
});
