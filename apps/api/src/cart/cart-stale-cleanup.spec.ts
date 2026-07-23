import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { CartService } from './cart.service';

describe('CartService stale line cleanup', () => {
  it('removes unavailable owned lines and increments the cart version before returning it', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const update = vi.fn().mockResolvedValue({ id: 'cart-1' });
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
        update,
      },
      cartItem: { deleteMany },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
      cart: { findFirst: vi.fn().mockResolvedValue({ id: 'cart-1', items: [] }) },
    } as unknown as PrismaService;

    await expect(new CartService(prisma).get('user-1', 'fr')).resolves.toEqual({
      data: { id: 'cart-1', items: [], itemCount: 0, subtotalMillimes: 0 },
    });

    const cleanupArgument: unknown = deleteMany.mock.calls[0]?.[0];
    expect(cleanupArgument).toMatchObject({
      where: {
        cartId: 'cart-1',
        variant: { isNot: { publicationStatus: 'PUBLISHED' } },
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'cart-1' },
      data: { version: { increment: 1 } },
    });
  });
});
