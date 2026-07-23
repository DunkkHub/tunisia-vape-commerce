import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { CheckoutPolicyService } from '../../src/checkout/checkout-policy.service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminProductsService } from '../../src/catalog/admin-products.service';
import { PrismaService } from '../../src/database/prisma.service';

const databaseName = process.env.INTEGRATION_DATABASE_NAME;
if (!databaseName || !/^vape_it_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Integration tests require the disposable database runner');
}

const suffix = () => `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
const rollback = new Error('ROLL_BACK_MEDIA_REVIEW_INTEGRATION_FIXTURE');

describe.sequential('draft product media-review confirmation on disposable MySQL', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const withRolledBackFixture = async (
    assertion: (transaction: Prisma.TransactionClient) => Promise<void>,
  ) => {
    try {
      await prisma.$transaction(async (transaction) => {
        await assertion(transaction);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  };

  const serviceFor = (transaction: Prisma.TransactionClient) =>
    new AdminProductsService(
      {
        product: transaction.product,
        $transaction: <T>(callback: (client: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
          callback(transaction),
      } as unknown as PrismaService,
      {} as CheckoutPolicyService,
    );

  const createDraft = async (transaction: Prisma.TransactionClient, includePending: boolean) => {
    const fixture = suffix();
    const [category, administrator] = await Promise.all([
      transaction.category.create({
        data: {
          nameFr: `Media review ${fixture}`,
          nameAr: `Media review ${fixture}`,
          slug: `media-review-${fixture}`,
          publicationStatus: 'PUBLISHED',
        },
      }),
      transaction.user.create({
        data: {
          audience: 'ADMIN',
          email: `media-review-${fixture}@example.test`,
          emailNormalized: `media-review-${fixture}@example.test`,
          passwordHash: 'integration-only-not-a-login-credential',
          status: 'ACTIVE',
        },
      }),
    ]);
    const product = await transaction.product.create({
      data: {
        categoryId: category.id,
        nameFr: `Media review ${fixture}`,
        nameAr: `Media review ${fixture}`,
        slug: `media-review-product-${fixture}`,
        productType: 'PREFILLED_POD_KIT',
        publicationStatus: 'DRAFT',
        requiresPricing: true,
        requiresStock: true,
        needsMediaReview: true,
        variants: {
          create: {
            nameFr: `Variante ${fixture}`,
            nameAr: `Variante ${fixture}`,
            sku: `MEDIA-REVIEW-${fixture}`,
            priceMillimes: 0,
            publicationStatus: 'DRAFT',
            images: {
              create: [
                {
                  objectKey: `integration/${fixture}-approved.png`,
                  objectKeyHash: randomBytes(32).toString('hex'),
                  bucket: 'integration',
                  contentType: 'image/png',
                  byteSize: 1,
                  checksumSha256: randomBytes(32).toString('hex'),
                  width: 1,
                  height: 1,
                  altTextFr: `Image approuvée ${fixture}`,
                  altTextAr: `Image approuvée ${fixture}`,
                  isPrimary: true,
                  moderationStatus: 'APPROVED',
                },
                ...(includePending
                  ? [
                      {
                        objectKey: `integration/${fixture}-pending.png`,
                        objectKeyHash: randomBytes(32).toString('hex'),
                        bucket: 'integration',
                        contentType: 'image/png',
                        byteSize: 1,
                        checksumSha256: randomBytes(32).toString('hex'),
                        width: 1,
                        height: 1,
                        altTextFr: `Image en attente ${fixture}`,
                        altTextAr: `Image en attente ${fixture}`,
                        isPrimary: false,
                        moderationStatus: 'PENDING' as const,
                      },
                    ]
                  : []),
              ],
            },
          },
        },
      },
    });
    return { product, administrator };
  };

  it('clears only the review flag and records the explicit operator reason', async () => {
    await withRolledBackFixture(async (transaction) => {
      const { product, administrator } = await createDraft(transaction, false);
      const requestId = `media-review-${suffix()}`;
      const products = serviceFor(transaction);

      await expect(
        products.confirmMediaReview(
          product.id,
          {
            version: product.version,
            reason: 'Every candidate was compared with its exact model and flavour.',
            confirmation: 'CONFIRM_PRODUCT_MEDIA_REVIEW',
          },
          { userId: administrator.id, requestId },
        ),
      ).resolves.toMatchObject({
        data: {
          publicationStatus: 'DRAFT',
          needsMediaReview: false,
          requiresPricing: true,
          requiresStock: true,
          version: product.version + 1,
        },
      });

      await expect(
        transaction.product.findUniqueOrThrow({ where: { id: product.id } }),
      ).resolves.toMatchObject({
        publicationStatus: 'DRAFT',
        needsMediaReview: false,
        requiresPricing: true,
        requiresStock: true,
        version: product.version + 1,
      });
      await expect(
        transaction.auditLog.findFirstOrThrow({ where: { requestId } }),
      ).resolves.toMatchObject({
        action: 'catalog.product.media_review.confirm',
        resourceId: product.id,
        outcome: 'SUCCESS',
        afterSummary: expect.objectContaining({
          publicationStatus: 'DRAFT',
          needsMediaReview: false,
          approvedImageCount: 1,
          unresolvedImageCount: 0,
        }) as object,
      });
    });
  });

  it('keeps the review flag and audit ledger unchanged when pending media remains', async () => {
    await withRolledBackFixture(async (transaction) => {
      const { product, administrator } = await createDraft(transaction, true);
      const requestId = `media-review-blocked-${suffix()}`;
      const products = serviceFor(transaction);

      await expect(
        products.confirmMediaReview(
          product.id,
          {
            version: product.version,
            reason: 'Reviewed every currently visible candidate.',
            confirmation: 'CONFIRM_PRODUCT_MEDIA_REVIEW',
          },
          { userId: administrator.id, requestId },
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'PRODUCT_MEDIA_REVIEW_NOT_READY',
          blockers: ['MEDIA_REVIEW_PENDING'],
        },
      });

      await expect(
        transaction.product.findUniqueOrThrow({ where: { id: product.id } }),
      ).resolves.toMatchObject({
        publicationStatus: 'DRAFT',
        needsMediaReview: true,
        version: product.version,
      });
      await expect(transaction.auditLog.count({ where: { requestId } })).resolves.toBe(0);
    });
  });
});
