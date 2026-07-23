import type { ProductVariant } from '@prisma/client';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { CheckoutPolicyService } from '../checkout/checkout-policy.service';
import type { PrismaService } from '../database/prisma.service';
import { AdminVariantsService } from './admin-variants.service';

const request = {
  auth: { userId: 'admin-1' },
  requestId: 'request-1',
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
  get: vi.fn().mockReturnValue('vitest'),
} as unknown as Request;

const checkoutPolicyFixture = (blockers: string[] = []) => {
  const evaluate = vi.fn().mockResolvedValue({ blockers });
  return {
    evaluate,
    service: { evaluate } as unknown as CheckoutPolicyService,
  };
};

const checkoutPolicies = (blockers: string[] = []) => checkoutPolicyFixture(blockers).service;

const variantRecord = (overrides: Partial<ProductVariant> = {}): ProductVariant => ({
  id: 'variant-1',
  productId: 'product-1',
  flavorId: null,
  nameFr: 'Variante test',
  nameAr: 'نسخة تجريبية',
  sku: 'SKU-1',
  barcode: null,
  color: null,
  nicotineStrengthMg: null,
  costMillimes: 10_000,
  priceMillimes: 25_000,
  promotionalPriceMillimes: null,
  taxRateBps: 0,
  weightGrams: 100,
  lengthMm: null,
  widthMm: null,
  heightMm: null,
  lowStockThreshold: 0,
  publicationStatus: 'DRAFT',
  sortOrder: 0,
  archivedAt: null,
  deletedAt: null,
  version: 1,
  createdAt: new Date('2026-07-20T10:00:00.000Z'),
  updatedAt: new Date('2026-07-20T10:00:00.000Z'),
  ...overrides,
});

const publicationPrisma = ({
  current = variantRecord(),
  parent = {
    id: 'product-1',
    archivedAt: null,
    requiresPricing: false,
    requiresStock: false,
    needsMediaReview: false,
  },
  duplicateSku = null as { id: string } | null,
  inventoryItems = [{ onHandQuantity: 4, reservations: [{ quantity: 1 }] }],
  imageCount = 1,
  unresolvedImageCount = 0,
}: {
  current?: ProductVariant;
  parent?: {
    id: string;
    archivedAt: Date | null;
    requiresPricing: boolean;
    requiresStock: boolean;
    needsMediaReview: boolean;
  };
  duplicateSku?: { id: string } | null;
  inventoryItems?: Array<{ onHandQuantity: number; reservations: Array<{ quantity: number }> }>;
  imageCount?: number;
  unresolvedImageCount?: number;
} = {}) => {
  const changed = variantRecord({
    ...current,
    publicationStatus: 'PUBLISHED',
    version: current.version + 1,
  });
  const productFindFirst = vi.fn().mockResolvedValue(parent);
  const variantFindFirst = vi
    .fn()
    .mockImplementation(({ where }: { where: { id?: string | { not: string } } }) =>
      Promise.resolve(typeof where.id === 'string' ? current : duplicateSku),
    );
  const inventoryFindMany = vi.fn().mockResolvedValue(inventoryItems);
  const countProductImages = vi.fn(({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve(typeof where.moderationStatus === 'object' ? unresolvedImageCount : imageCount),
  );
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
    product: { findFirst: productFindFirst },
    productVariant: {
      findFirst: variantFindFirst,
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue(changed),
    },
    inventoryItem: { findMany: inventoryFindMany },
    productImage: { count: countProductImages },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const prismaTransaction = vi.fn((callback: (client: typeof transaction) => unknown) =>
    callback(transaction),
  );
  const prisma = {
    productVariant: { findFirst: variantFindFirst },
    product: { findFirst: productFindFirst },
    inventoryItem: { findMany: inventoryFindMany },
    productImage: { count: countProductImages },
    $transaction: prismaTransaction,
  } as unknown as PrismaService;
  return { prisma, transaction, countProductImages, inventoryFindMany, prismaTransaction };
};

describe('AdminVariantsService publication readiness', () => {
  it('publishes a valid stocked variant with product-image fallback and operational delivery', async () => {
    const { prisma, transaction, prismaTransaction } = publicationPrisma();
    const policy = checkoutPolicyFixture(['STORE_INFORMATION_MISSING', 'CHECKOUT_DISABLED']);
    const policies = policy.service;
    const service = new AdminVariantsService(prisma, policies);

    await expect(
      service.update(
        'product-1',
        'variant-1',
        { version: 1, publicationStatus: 'PUBLISHED' },
        request,
      ),
    ).resolves.toMatchObject({
      data: { id: 'variant-1', publicationStatus: 'PUBLISHED', version: 2 },
    });

    expect(transaction.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: 'variant-1', productId: 'product-1', version: 1, deletedAt: null },
      data: {
        publicationStatus: 'PUBLISHED',
        archivedAt: null,
        version: { increment: 1 },
      },
    });
    expect(prismaTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 10_000,
    });
    expect(policy.evaluate).toHaveBeenLastCalledWith(expect.any(Date), transaction);
  });

  it('revalidates stock from the serializable transaction before publishing', async () => {
    const { prisma, transaction, inventoryFindMany } = publicationPrisma();
    inventoryFindMany
      .mockResolvedValueOnce([{ onHandQuantity: 4, reservations: [{ quantity: 1 }] }])
      .mockResolvedValueOnce([]);
    const service = new AdminVariantsService(prisma, checkoutPolicies());

    await expect(
      service.update(
        'product-1',
        'variant-1',
        { version: 1, publicationStatus: 'PUBLISHED' },
        request,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'VARIANT_PUBLICATION_NOT_READY',
        blockers: ['AVAILABLE_STOCK_MISSING'],
      },
    });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('returns the existing version conflict when MySQL aborts publication serialization', async () => {
    const { prisma, transaction, prismaTransaction } = publicationPrisma();
    prismaTransaction.mockRejectedValueOnce(
      Object.assign(new Error('serialization conflict'), { code: 'P2034' }),
    );
    const service = new AdminVariantsService(prisma, checkoutPolicies());

    await expect(
      service.update(
        'product-1',
        'variant-1',
        { version: 1, publicationStatus: 'PUBLISHED' },
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });

    expect(transaction.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('does not re-run operational publication checks for an already-published variant edit', async () => {
    const current = variantRecord({ publicationStatus: 'PUBLISHED' });
    const { prisma } = publicationPrisma({ current });
    const policies = checkoutPolicies(['DELIVERY_METHOD_MISSING']);
    const service = new AdminVariantsService(prisma, policies);

    await expect(
      service.update('product-1', 'variant-1', { version: 1, nameFr: 'Nom corrigé' }, request),
    ).resolves.toMatchObject({ data: { id: 'variant-1', version: 2 } });
  });

  it('still rejects a zero price when an already-published variant is edited', async () => {
    const current = variantRecord({ publicationStatus: 'PUBLISHED' });
    const { prisma, transaction } = publicationPrisma({ current });
    const policies = checkoutPolicies();
    const service = new AdminVariantsService(prisma, policies);

    await expect(
      service.update('product-1', 'variant-1', { version: 1, priceMillimes: 0 }, request),
    ).rejects.toMatchObject({
      response: {
        code: 'VARIANT_PUBLICATION_NOT_READY',
        blockers: ['NON_POSITIVE_PRICE'],
      },
    });

    expect(transaction.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('keeps an imported draft variant blocked while its product review flags remain set', async () => {
    const { prisma, transaction } = publicationPrisma({
      current: variantRecord({ priceMillimes: 0 }),
      parent: {
        id: 'product-1',
        archivedAt: null,
        requiresPricing: true,
        requiresStock: true,
        needsMediaReview: true,
      },
      inventoryItems: [],
      imageCount: 0,
    });
    const service = new AdminVariantsService(prisma, checkoutPolicies());

    await expect(
      service.update(
        'product-1',
        'variant-1',
        { version: 1, publicationStatus: 'PUBLISHED' },
        request,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'VARIANT_PUBLICATION_NOT_READY',
        blockers: [
          'PRICING_REVIEW_REQUIRED',
          'STOCK_REVIEW_REQUIRED',
          'MEDIA_REVIEW_REQUIRED',
          'MEDIA_REVIEW_CONFIRMATION_REQUIRED',
          'NON_POSITIVE_PRICE',
          'AVAILABLE_STOCK_MISSING',
          'APPROVED_IMAGE_MISSING',
        ],
      },
    });
    expect(transaction.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('requires the product-level media review assertion before publishing a variant', async () => {
    const { prisma, transaction } = publicationPrisma({
      parent: {
        id: 'product-1',
        archivedAt: null,
        requiresPricing: false,
        requiresStock: false,
        needsMediaReview: true,
      },
    });
    const service = new AdminVariantsService(prisma, checkoutPolicies());

    await expect(
      service.update(
        'product-1',
        'variant-1',
        { version: 1, publicationStatus: 'PUBLISHED' },
        request,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'VARIANT_PUBLICATION_NOT_READY',
        blockers: ['MEDIA_REVIEW_CONFIRMATION_REQUIRED'],
      },
    });
    expect(transaction.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('blocks publication when unresolved media exists anywhere on the owning product', async () => {
    const { prisma, transaction, countProductImages } = publicationPrisma({
      unresolvedImageCount: 1,
    });
    const service = new AdminVariantsService(prisma, checkoutPolicies());

    await expect(
      service.update(
        'product-1',
        'variant-1',
        { version: 1, publicationStatus: 'PUBLISHED' },
        request,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'VARIANT_PUBLICATION_NOT_READY',
        blockers: ['MEDIA_REVIEW_PENDING'],
      },
    });

    expect(countProductImages).toHaveBeenCalledWith({
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
    expect(transaction.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('denies a duplicate SKU, zero price, no stock/image and missing delivery before mutation', async () => {
    const { prisma, transaction } = publicationPrisma({
      duplicateSku: { id: 'variant-elsewhere' },
      inventoryItems: [],
      imageCount: 0,
    });
    const service = new AdminVariantsService(prisma, checkoutPolicies(['DELIVERY_METHOD_MISSING']));

    await expect(
      service.update(
        'product-1',
        'variant-1',
        {
          version: 1,
          sku: 'DUPLICATE-SKU',
          priceMillimes: 0,
          publicationStatus: 'PUBLISHED',
        },
        request,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'VARIANT_PUBLICATION_NOT_READY',
        blockers: [
          'VARIANT_SKU_DUPLICATE',
          'NON_POSITIVE_PRICE',
          'AVAILABLE_STOCK_MISSING',
          'APPROVED_IMAGE_MISSING',
          'DELIVERY_METHOD_MISSING',
        ],
      },
    });
    expect(transaction.productVariant.updateMany).not.toHaveBeenCalled();
  });
});
