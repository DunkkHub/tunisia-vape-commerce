import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { AdminProductsService } from './admin-products.service';

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
  return { service: new AdminProductsService(prisma), findMany };
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
