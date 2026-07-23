import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@prisma/client';
import type { CheckoutPolicyService } from '../checkout/checkout-policy.service';
import type { PrismaService } from '../database/prisma.service';
import { AdminProductsService } from './admin-products.service';

const context = { userId: 'admin-1', requestId: 'request-1' };

const checkoutPolicyFixture = (blockers: string[] = []) => {
  const evaluate = vi.fn().mockResolvedValue({ blockers });
  return {
    evaluate,
    service: { evaluate } as unknown as CheckoutPolicyService,
  };
};

const checkoutPolicies = (blockers: string[] = []) => checkoutPolicyFixture(blockers).service;

const productRecord = (overrides: Partial<Product> = {}): Product => ({
  id: 'product-1',
  brandId: null,
  categoryId: 'category-1',
  nameFr: 'Produit test',
  nameAr: 'منتج تجريبي',
  slug: 'produit-test',
  sku: null,
  barcode: null,
  productType: 'E_LIQUID',
  family: null,
  model: null,
  shortDescriptionFr: null,
  shortDescriptionAr: null,
  descriptionFr: null,
  descriptionAr: null,
  containsNicotine: false,
  nicotineStrengthMg: null,
  flavor: null,
  deviceType: null,
  puffCount: null,
  coilResistanceOhm: null,
  liquidCapacityMl: null,
  deviceCompatibility: null,
  baseCostMillimes: null,
  basePriceMillimes: 25_000,
  promotionalPriceMillimes: null,
  taxCategory: null,
  taxRateBps: 0,
  warningFr: null,
  warningAr: null,
  minimumAge: 18,
  publicationStatus: 'DRAFT',
  featured: false,
  requiresPricing: false,
  requiresStock: false,
  needsMediaReview: false,
  seoTitleFr: null,
  seoTitleAr: null,
  seoDescriptionFr: null,
  seoDescriptionAr: null,
  publishedAt: null,
  suspendedAt: null,
  archivedAt: null,
  deletedAt: null,
  version: 1,
  createdAt: new Date('2026-07-20T10:00:00.000Z'),
  updatedAt: new Date('2026-07-20T10:00:00.000Z'),
  ...overrides,
});

const sellableVariant = (overrides: Record<string, unknown> = {}) => ({
  id: 'variant-1',
  sku: 'SKU-1',
  priceMillimes: 25_000,
  promotionalPriceMillimes: null,
  images: [],
  inventoryItems: [{ onHandQuantity: 3, reservations: [{ quantity: 1 }] }],
  ...overrides,
});

const record = {
  id: 'product-1',
  nameFr: 'Produit test',
  nameAr: 'منتج تجريبي',
  slug: 'produit-test',
  sku: null,
  productType: 'E_LIQUID' as const,
  flavor: 'Menthe',
  publicationStatus: 'DRAFT' as const,
  basePriceMillimes: 25_000,
  promotionalPriceMillimes: 20_000,
  version: 1,
  createdAt: new Date('2026-07-12T10:00:00.000Z'),
  updatedAt: new Date('2026-07-12T11:00:00.000Z'),
  brand: { name: 'Marque test' },
  variants: [
    {
      sku: 'VARIANT-1',
      priceMillimes: 22_000,
      promotionalPriceMillimes: null,
      inventoryItems: [
        {
          onHandQuantity: 8,
          reservations: [{ quantity: 3 }],
        },
      ],
    },
  ],
};

const serviceWith = (records = [record], total = records.length) => {
  const findMany = vi.fn().mockResolvedValue(records);
  const count = vi.fn().mockResolvedValue(total);
  const transaction = vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
  const prisma = {
    product: { findMany, count },
    $transaction: transaction,
  } as unknown as PrismaService;
  return { service: new AdminProductsService(prisma, checkoutPolicies()), findMany };
};

describe('AdminProductsService list', () => {
  it('returns the bounded localized admin contract with authoritative available stock', async () => {
    const { service, findMany } = serviceWith();

    await expect(service.list({ page: 1, limit: 20 }, 'fr')).resolves.toEqual({
      data: {
        items: [
          {
            id: 'product-1',
            sku: 'VARIANT-1',
            name: 'Produit test',
            slug: 'produit-test',
            brandName: 'Marque test',
            productType: 'E_LIQUID',
            flavor: 'Menthe',
            publicationStatus: 'DRAFT',
            availableQuantity: 5,
            sellingPriceMillimes: 20_000,
            version: 1,
            createdAt: '2026-07-12T10:00:00.000Z',
            updatedAt: '2026-07-12T11:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20, where: { deletedAt: null } }),
    );
  });

  it('normalizes search and localizes Arabic names', async () => {
    const { service, findMany } = serviceWith();

    const result = await service.list({ page: 2, limit: 10, q: '  test   sku  ' }, 'ar');

    expect(result.data.items[0]?.name).toBe('منتج تجريبي');
    const input = findMany.mock.calls[0]?.[0] as unknown as {
      skip: number;
      take: number;
      where: { deletedAt: null; OR?: unknown[] };
    };
    expect(input).toMatchObject({ skip: 10, take: 10, where: { deletedAt: null } });
    expect(input.where.OR).toHaveLength(6);
  });
});

describe('AdminProductsService publication readiness', () => {
  const publicationPrisma = ({
    current = productRecord(),
    variants = [sellableVariant()],
    productImageCount = 1,
    unresolvedImageCount = 0,
    changed = productRecord({
      publicationStatus: 'PUBLISHED',
      publishedAt: new Date('2026-07-20T12:00:00.000Z'),
      version: 2,
    }),
  }: {
    current?: Product;
    variants?: Array<ReturnType<typeof sellableVariant>>;
    productImageCount?: number;
    unresolvedImageCount?: number;
    changed?: Product;
  } = {}) => {
    const productFindFirst = vi.fn().mockResolvedValue(current);
    const categoryFindFirst = vi.fn().mockResolvedValue({ id: 'category-1' });
    const brandFindFirst = vi.fn().mockResolvedValue({ id: 'brand-1' });
    const variantFindMany = vi.fn().mockResolvedValue(variants);
    const variantCount = vi.fn().mockResolvedValue(variants.length);
    const imageCount = vi.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        typeof where.moderationStatus === 'object' ? unresolvedImageCount : productImageCount,
      ),
    );
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: current.id }]),
      product: {
        findFirst: productFindFirst,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(changed),
      },
      category: { findFirst: categoryFindFirst },
      brand: { findFirst: brandFindFirst },
      productVariant: { findMany: variantFindMany, count: variantCount },
      productImage: { count: imageCount },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prismaTransaction = vi.fn((callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    );
    const prisma = {
      product: { findFirst: productFindFirst },
      category: { findFirst: categoryFindFirst },
      brand: { findFirst: brandFindFirst },
      productVariant: { findMany: variantFindMany, count: variantCount },
      productImage: { count: imageCount },
      $transaction: prismaTransaction,
    } as unknown as PrismaService;
    return { prisma, transaction, prismaTransaction, variantFindMany, imageCount };
  };

  it('publishes a reviewed, priced, stocked and imaged product with operational delivery', async () => {
    const { prisma, transaction, prismaTransaction } = publicationPrisma();
    const policy = checkoutPolicyFixture(['STORE_INFORMATION_MISSING', 'CHECKOUT_DISABLED']);
    const policies = policy.service;
    const service = new AdminProductsService(prisma, policies);

    await expect(
      service.update('product-1', { version: 1, publicationStatus: 'PUBLISHED' }, context),
    ).resolves.toMatchObject({
      data: { id: 'product-1', publicationStatus: 'PUBLISHED', version: 2 },
    });

    expect(transaction.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'product-1', version: 1, deletedAt: null },
        data: expect.objectContaining({
          publicationStatus: 'PUBLISHED',
          requiresPricing: false,
          requiresStock: false,
          needsMediaReview: false,
        }) as object,
      }),
    );
    expect(prismaTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 10_000,
    });
    expect(policy.evaluate).toHaveBeenLastCalledWith(expect.any(Date), transaction);
  });

  it('revalidates stock from the serializable transaction before publishing', async () => {
    const { prisma, transaction, variantFindMany } = publicationPrisma();
    variantFindMany
      .mockResolvedValueOnce([sellableVariant()])
      .mockResolvedValueOnce([sellableVariant({ inventoryItems: [] })]);
    const service = new AdminProductsService(prisma, checkoutPolicies());

    await expect(
      service.update('product-1', { version: 1, publicationStatus: 'PUBLISHED' }, context),
    ).rejects.toMatchObject({
      response: {
        code: 'PRODUCT_PUBLICATION_NOT_READY',
        blockers: ['AVAILABLE_STOCK_MISSING'],
      },
    });

    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
  });

  it('returns the existing version conflict when MySQL aborts publication serialization', async () => {
    const { prisma, transaction, prismaTransaction } = publicationPrisma();
    prismaTransaction.mockRejectedValueOnce(
      Object.assign(new Error('serialization conflict'), { code: 'P2034' }),
    );
    const service = new AdminProductsService(prisma, checkoutPolicies());

    await expect(
      service.update('product-1', { version: 1, publicationStatus: 'PUBLISHED' }, context),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });

    expect(transaction.product.updateMany).not.toHaveBeenCalled();
  });

  it('does not re-run operational publication checks for an already-published product edit', async () => {
    const current = productRecord({ publicationStatus: 'PUBLISHED' });
    const { prisma } = publicationPrisma({ current });
    const policies = checkoutPolicies(['DELIVERY_METHOD_MISSING']);
    const service = new AdminProductsService(prisma, policies);

    await expect(
      service.update('product-1', { version: 1, nameFr: 'Nom corrigé' }, context),
    ).resolves.toMatchObject({ data: { id: 'product-1', version: 2 } });
  });

  it('keeps a draft imported product blocked while review flags remain set', async () => {
    const { prisma, transaction } = publicationPrisma({
      current: productRecord({
        basePriceMillimes: null,
        requiresPricing: true,
        requiresStock: true,
        needsMediaReview: true,
      }),
      variants: [sellableVariant({ priceMillimes: 0, inventoryItems: [] })],
      productImageCount: 0,
    });
    const service = new AdminProductsService(prisma, checkoutPolicies());

    await expect(
      service.update('product-1', { version: 1, publicationStatus: 'PUBLISHED' }, context),
    ).rejects.toMatchObject({
      response: {
        code: 'PRODUCT_PUBLICATION_NOT_READY',
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
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
  });

  it('reports invalid SKUs, zero prices, absent stock/media and missing delivery together', async () => {
    const { prisma, transaction } = publicationPrisma({
      current: productRecord({ basePriceMillimes: 0 }),
      productImageCount: 0,
      variants: [
        sellableVariant({
          id: 'variant-blank',
          sku: '   ',
          priceMillimes: 0,
          inventoryItems: [],
        }),
        sellableVariant({ id: 'variant-a', sku: 'SKU-A' }),
        sellableVariant({ id: 'variant-b', sku: ' sku-a ' }),
      ],
    });
    const service = new AdminProductsService(prisma, checkoutPolicies(['DELIVERY_METHOD_MISSING']));

    await expect(
      service.update('product-1', { version: 1, publicationStatus: 'PUBLISHED' }, context),
    ).rejects.toMatchObject({
      response: {
        code: 'PRODUCT_PUBLICATION_NOT_READY',
        blockers: [
          'NON_POSITIVE_PRICE',
          'VARIANT_SKU_INVALID',
          'AVAILABLE_STOCK_MISSING',
          'VARIANT_SKU_DUPLICATE',
          'APPROVED_IMAGE_MISSING',
          'DELIVERY_METHOD_MISSING',
        ],
      },
    });
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
  });

  it('blocks publication when unresolved media exists even if the review flag was not set', async () => {
    const { prisma, transaction } = publicationPrisma({ unresolvedImageCount: 1 });
    const service = new AdminProductsService(prisma, checkoutPolicies());

    await expect(
      service.update('product-1', { version: 1, publicationStatus: 'PUBLISHED' }, context),
    ).rejects.toMatchObject({
      response: {
        code: 'PRODUCT_PUBLICATION_NOT_READY',
        blockers: ['MEDIA_REVIEW_PENDING'],
      },
    });
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
  });

  it('clears a resolved media-review flag only after an explicit publication assertion', async () => {
    const current = productRecord({ needsMediaReview: true });
    const changed = productRecord({
      needsMediaReview: false,
      publicationStatus: 'PUBLISHED',
      publishedAt: new Date('2026-07-20T12:00:00.000Z'),
      version: 2,
    });
    const { prisma, transaction } = publicationPrisma({ current, changed });
    const service = new AdminProductsService(prisma, checkoutPolicies());

    await expect(
      service.update(
        'product-1',
        {
          version: 1,
          publicationStatus: 'PUBLISHED',
          mediaReviewConfirmed: true,
        },
        context,
      ),
    ).resolves.toMatchObject({ data: { needsMediaReview: false, version: 2 } });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          beforeSummary: expect.objectContaining({ needsMediaReview: true }) as object,
          afterSummary: expect.objectContaining({
            needsMediaReview: false,
            mediaReviewConfirmed: true,
          }) as object,
        }) as object,
      }),
    );
  });

  it('requires the same explicit assertion before clearing review on an already-published product', async () => {
    const current = productRecord({ publicationStatus: 'PUBLISHED', needsMediaReview: true });
    const blocked = publicationPrisma({ current });
    const blockedService = new AdminProductsService(blocked.prisma, checkoutPolicies());

    await expect(
      blockedService.update('product-1', { version: 1, nameFr: 'Nom corrigé' }, context),
    ).rejects.toMatchObject({
      response: {
        code: 'PRODUCT_PUBLICATION_NOT_READY',
        blockers: ['MEDIA_REVIEW_CONFIRMATION_REQUIRED'],
      },
    });

    const allowed = publicationPrisma({
      current,
      changed: productRecord({
        publicationStatus: 'PUBLISHED',
        needsMediaReview: false,
        version: 2,
      }),
    });
    const allowedService = new AdminProductsService(allowed.prisma, checkoutPolicies());
    await expect(
      allowedService.update(
        'product-1',
        { version: 1, nameFr: 'Nom corrigé', mediaReviewConfirmed: true },
        context,
      ),
    ).resolves.toMatchObject({ data: { needsMediaReview: false, version: 2 } });
  });

  it('does not clear review on a published product after every candidate was rejected', async () => {
    const current = productRecord({ publicationStatus: 'PUBLISHED', needsMediaReview: true });
    const { prisma, transaction } = publicationPrisma({ current, productImageCount: 0 });
    const service = new AdminProductsService(prisma, checkoutPolicies());

    await expect(
      service.update(
        'product-1',
        { version: 1, nameFr: 'Nom corrigé', mediaReviewConfirmed: true },
        context,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'PRODUCT_PUBLICATION_NOT_READY',
        blockers: ['APPROVED_IMAGE_MISSING'],
      },
    });
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
  });

  it('does not treat an approved image on a draft variant as public product media', async () => {
    const current = productRecord({ publicationStatus: 'PUBLISHED', needsMediaReview: true });
    const { prisma, transaction, imageCount } = publicationPrisma({
      current,
      productImageCount: 0,
    });
    const service = new AdminProductsService(prisma, checkoutPolicies());

    await expect(
      service.update(
        'product-1',
        { version: 1, nameFr: 'Nom corrigé', mediaReviewConfirmed: true },
        context,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'PRODUCT_PUBLICATION_NOT_READY',
        blockers: ['APPROVED_IMAGE_MISSING'],
      },
    });

    const approvedCall = imageCount.mock.calls.find(
      ([input]) => input.where.moderationStatus === 'APPROVED',
    );
    expect(approvedCall?.[0].where.OR).toEqual([
      { productId: 'product-1', variantId: null },
      {
        productId: null,
        variant: {
          is: {
            productId: 'product-1',
            publicationStatus: 'PUBLISHED',
            archivedAt: null,
            deletedAt: null,
          },
        },
      },
    ]);
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
  });

  it('confirms media review on a draft without publishing or clearing other readiness flags', async () => {
    const current = productRecord({
      needsMediaReview: true,
      requiresPricing: true,
      requiresStock: true,
    });
    const changed = productRecord({
      needsMediaReview: false,
      requiresPricing: true,
      requiresStock: true,
      version: 2,
    });
    const { prisma, transaction, prismaTransaction, imageCount } = publicationPrisma({
      current,
      changed,
    });
    const service = new AdminProductsService(prisma, checkoutPolicies());

    await expect(
      service.confirmMediaReview(
        'product-1',
        {
          version: 1,
          reason: '  Every imported candidate matches its exact model and flavour.  ',
          confirmation: 'CONFIRM_PRODUCT_MEDIA_REVIEW',
        },
        context,
      ),
    ).resolves.toMatchObject({
      data: {
        publicationStatus: 'DRAFT',
        needsMediaReview: false,
        requiresPricing: true,
        requiresStock: true,
        version: 2,
      },
    });

    expect(transaction.product.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'product-1',
        version: 1,
        publicationStatus: 'DRAFT',
        needsMediaReview: true,
        deletedAt: null,
      },
      data: { needsMediaReview: false, version: { increment: 1 } },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'catalog.product.media_review.confirm',
          beforeSummary: expect.objectContaining({
            publicationStatus: 'DRAFT',
            needsMediaReview: true,
          }) as object,
          afterSummary: expect.objectContaining({
            publicationStatus: 'DRAFT',
            needsMediaReview: false,
            approvedImageCount: 1,
            unresolvedImageCount: 0,
            reason: 'Every imported candidate matches its exact model and flavour.',
          }) as object,
        }) as object,
      }),
    );
    expect(prismaTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 10_000,
    });
    const approvedCall = imageCount.mock.calls.find(
      ([input]) => input.where.moderationStatus === 'APPROVED',
    );
    expect(approvedCall?.[0].where.OR).toEqual([
      { productId: 'product-1', variantId: null },
      {
        productId: null,
        variant: {
          is: {
            productId: 'product-1',
            publicationStatus: { in: ['DRAFT', 'PUBLISHED'] },
            archivedAt: null,
            deletedAt: null,
          },
        },
      },
    ]);
  });

  it('keeps draft media review open while pending or quarantined media exists', async () => {
    const current = productRecord({ needsMediaReview: true });
    const { prisma, transaction } = publicationPrisma({ current, unresolvedImageCount: 1 });
    const service = new AdminProductsService(prisma, checkoutPolicies());

    await expect(
      service.confirmMediaReview(
        'product-1',
        {
          version: 1,
          reason: 'Reviewed all visible candidates.',
          confirmation: 'CONFIRM_PRODUCT_MEDIA_REVIEW',
        },
        context,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'PRODUCT_MEDIA_REVIEW_NOT_READY',
        blockers: ['MEDIA_REVIEW_PENDING'],
      },
    });
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('requires an approved image before completing draft media review', async () => {
    const current = productRecord({ needsMediaReview: true });
    const { prisma, transaction } = publicationPrisma({ current, productImageCount: 0 });
    const service = new AdminProductsService(prisma, checkoutPolicies());

    await expect(
      service.confirmMediaReview(
        'product-1',
        {
          version: 1,
          reason: 'Every rejected candidate was checked.',
          confirmation: 'CONFIRM_PRODUCT_MEDIA_REVIEW',
        },
        context,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'PRODUCT_MEDIA_REVIEW_NOT_READY',
        blockers: ['APPROVED_IMAGE_MISSING'],
      },
    });
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
  });

  it('does not use the draft review transition on a published product', async () => {
    const current = productRecord({ publicationStatus: 'PUBLISHED', needsMediaReview: true });
    const { prisma, transaction } = publicationPrisma({ current });
    const service = new AdminProductsService(prisma, checkoutPolicies());

    await expect(
      service.confirmMediaReview(
        'product-1',
        {
          version: 1,
          reason: 'Reviewed every imported candidate.',
          confirmation: 'CONFIRM_PRODUCT_MEDIA_REVIEW',
        },
        context,
      ),
    ).rejects.toMatchObject({ response: { code: 'PRODUCT_MEDIA_REVIEW_REQUIRES_DRAFT' } });
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
  });
});
