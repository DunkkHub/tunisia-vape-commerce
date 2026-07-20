import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { CartService } from './cart.service';

describe('CartService product media serialization', () => {
  it('returns only the selected approved image with localized alternative text', async () => {
    const transaction = {
      customerProfile: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: 'customer-1' })
          .mockResolvedValueOnce({ id: 'customer-1' }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'customer-1' }]),
      cart: {
        findFirst: vi.fn().mockResolvedValue({ id: 'cart-1', expiresAt: null }),
      },
      cartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const findCart = vi.fn().mockResolvedValue({
      id: 'cart-1',
      items: [
        {
          id: 'cart-item-1',
          quantity: 2,
          variant: {
            id: 'variant-1',
            nameFr: 'Violet',
            nameAr: 'بنفسجي',
            sku: 'SKU-VIOLET',
            priceMillimes: 12_000,
            promotionalPriceMillimes: null,
            lowStockThreshold: 2,
            images: [
              {
                id: 'variant-image-1',
                objectKeyHash: 'b'.repeat(64),
                altTextFr: 'Variante violette',
                altTextAr: 'النسخة البنفسجية',
                width: 600,
                height: 900,
              },
            ],
            product: {
              id: 'product-1',
              nameFr: 'Produit',
              nameAr: 'منتج',
              slug: 'produit',
              shortDescriptionFr: 'Description',
              shortDescriptionAr: 'وصف',
              productType: 'DISPOSABLE',
              flavor: 'Berry',
              containsNicotine: true,
              minimumAge: 18,
              brand: { name: 'PUFFJET', slug: 'puffjet' },
              images: [],
            },
            inventoryItems: [],
          },
        },
      ],
    });
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
      cart: { findFirst: findCart },
    } as unknown as PrismaService;

    const response = await new CartService(prisma).get('user-1', 'ar');

    expect(response.data.items[0]).toMatchObject({
      product: {
        primaryImage: {
          id: 'variant-image-1',
          url: `/api/v1/media/${'b'.repeat(64)}`,
          altText: 'النسخة البنفسجية',
          width: 600,
          height: 900,
        },
      },
      variant: {
        image: {
          id: 'variant-image-1',
          url: `/api/v1/media/${'b'.repeat(64)}`,
          altText: 'النسخة البنفسجية',
        },
      },
    });
    const query = findCart.mock.calls[0]?.[0] as
      | {
          select?: {
            items?: {
              select?: {
                variant?: {
                  select?: {
                    images?: { where?: unknown; orderBy?: unknown; take?: number };
                  };
                };
              };
            };
          };
        }
      | undefined;
    expect(query?.select?.items?.select?.variant?.select?.images).toMatchObject({
      where: { deletedAt: null, moderationStatus: 'APPROVED' },
      take: 1,
    });
    expect(query?.select?.items?.select?.variant?.select?.images?.orderBy).toEqual([
      { isPrimary: 'desc' },
      { sortOrder: 'asc' },
      { id: 'asc' },
    ]);
  });
});
