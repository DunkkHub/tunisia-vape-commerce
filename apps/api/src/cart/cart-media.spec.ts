import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { CartService } from './cart.service';

interface MediaFixture {
  id: string;
  objectKeyHash: string;
  altTextFr: string;
  altTextAr: string;
  width: number;
  height: number;
}

const productImage: MediaFixture = {
  id: 'product-image-1',
  objectKeyHash: 'a'.repeat(64),
  altTextFr: 'Produit vu de face',
  altTextAr: 'Product front view',
  width: 800,
  height: 800,
};

const variantImage: MediaFixture = {
  id: 'variant-image-1',
  objectKeyHash: 'b'.repeat(64),
  altTextFr: 'Variante violette',
  altTextAr: 'Purple variant',
  width: 600,
  height: 900,
};

function cartServiceWithMedia(variantImages: MediaFixture[], productImages: MediaFixture[]) {
  const transaction = {
    customerProfile: {
      findFirst: vi.fn().mockResolvedValue({ id: 'customer-1' }),
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
          nameAr: 'Purple',
          sku: 'SKU-VIOLET',
          priceMillimes: 12_000,
          promotionalPriceMillimes: null,
          lowStockThreshold: 2,
          images: variantImages,
          product: {
            id: 'product-1',
            nameFr: 'Produit',
            nameAr: 'Product',
            slug: 'produit',
            shortDescriptionFr: 'Description',
            shortDescriptionAr: 'Description',
            productType: 'DISPOSABLE',
            flavor: 'Berry',
            containsNicotine: true,
            minimumAge: 18,
            brand: { name: 'PUFFJET', slug: 'puffjet' },
            images: productImages,
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

  return { service: new CartService(prisma), findCart };
}

describe('CartService product media serialization', () => {
  it('prioritizes the selected variant image over the product image', async () => {
    const { service, findCart } = cartServiceWithMedia([variantImage], [productImage]);

    const response = await service.get('user-1', 'fr');

    expect(response.data.items[0]).toMatchObject({
      product: {
        primaryImage: {
          id: 'variant-image-1',
          url: `/api/v1/media/${'b'.repeat(64)}`,
          altText: 'Variante violette',
          width: 600,
          height: 900,
        },
      },
      variant: {
        image: {
          id: 'variant-image-1',
          url: `/api/v1/media/${'b'.repeat(64)}`,
          altText: 'Variante violette',
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

  it('falls back to the product image when the selected variant has no image', async () => {
    const { service } = cartServiceWithMedia([], [productImage]);

    const response = await service.get('user-1', 'fr');

    expect(response.data.items[0]).toMatchObject({
      product: {
        primaryImage: {
          id: 'product-image-1',
          url: `/api/v1/media/${'a'.repeat(64)}`,
          altText: 'Produit vu de face',
          width: 800,
          height: 800,
        },
      },
      variant: { image: null },
    });
  });
});
