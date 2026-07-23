import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { WishlistService } from './wishlist.service';

const wishlistProduct = {
  id: 'product-1',
  nameFr: 'Produit',
  nameAr: 'منتج',
  slug: 'produit',
  shortDescriptionFr: 'Description',
  shortDescriptionAr: 'وصف',
  containsNicotine: false,
  productType: ProductType.DEVICE,
  flavor: null,
  basePriceMillimes: 10_000,
  promotionalPriceMillimes: 9_000,
  minimumAge: null,
  brand: { name: 'Brand', slug: 'brand' },
  variants: [
    {
      priceMillimes: 11_000,
      promotionalPriceMillimes: null,
      lowStockThreshold: 2,
      inventoryItems: [
        {
          onHandQuantity: 5,
          reservations: [{ quantity: 1 }],
        },
      ],
    },
  ],
};

describe('customer wishlist service', () => {
  it('returns a bounded page of only public wishlist products in the requested locale', async () => {
    const findMany = vi.fn().mockResolvedValue([{ variant: { product: wishlistProduct } }]);
    const count = vi.fn().mockResolvedValue(1);
    const prisma = {
      customerProfile: { findFirst: vi.fn().mockResolvedValue({ id: 'customer-1' }) },
      wishlistItem: { findMany, count },
      $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
    } as unknown as PrismaService;
    const service = new WishlistService(prisma);

    const result = await service.list('user-1', { page: 1, pageSize: 20 }, 'ar');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
        where: expect.objectContaining({
          wishlist: { is: { customerId: 'customer-1', name: 'default' } },
          variant: {
            is: expect.objectContaining({
              publicationStatus: 'PUBLISHED',
              archivedAt: null,
              deletedAt: null,
            }) as unknown,
          },
        }) as unknown,
      }),
    );
    expect(result.data).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(result.data.items[0]).toMatchObject({
      id: 'product-1',
      name: 'منتج',
      priceMillimes: 10_000,
      promotionalPriceMillimes: 9_000,
      availableQuantity: 4,
    });
  });

  it('rejects adding an unpublished or unavailable variant before creating a wishlist', async () => {
    const upsertWishlist = vi.fn();
    const transaction = {
      customerProfile: { findFirst: vi.fn().mockResolvedValue({ id: 'customer-1' }) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'customer-1' }]),
      productVariant: { findFirst: vi.fn().mockResolvedValue(null) },
      wishlist: { upsert: upsertWishlist },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new WishlistService(prisma);

    const error = await service
      .add('user-1', { variantId: 'variant-1' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'WISHLIST_PRODUCT_UNAVAILABLE',
    });
    expect(upsertWishlist).not.toHaveBeenCalled();
  });

  it('returns the same not-found result for a missing or another customer’s wishlist item', async () => {
    const deleteItem = vi.fn();
    const transaction = {
      customerProfile: { findFirst: vi.fn().mockResolvedValue({ id: 'customer-1' }) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'customer-1' }]),
      wishlistItem: { findFirst: vi.fn().mockResolvedValue(null), delete: deleteItem },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new WishlistService(prisma);

    const error = await service
      .remove('user-1', 'variant-owned-by-user-2')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({
      code: 'WISHLIST_ITEM_NOT_FOUND',
    });
    expect(deleteItem).not.toHaveBeenCalled();
  });
});
