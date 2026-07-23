import type { Request } from 'express';
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { checkoutRequestFingerprint } from './checkout-order.helpers';
import { CheckoutOrderService } from './checkout-order.service';
import type { CheckoutOrderDto } from './dto/checkout-order.dto';

const input: CheckoutOrderDto = {
  items: [{ variantId: 'variant-a', quantity: 1 }],
  localityId: 'locality-a',
  customerName: 'Customer Name',
  phone: '+21620111222',
  address: { street: '1 Example Street' },
  consent: { ageConfirmed: true, termsAccepted: true, privacyAccepted: true },
};

describe('checkout order replay', () => {
  it('returns the immutable creation response without re-running checkout policy or writes', async () => {
    const createdAt = new Date('2026-07-13T10:00:00.000Z');
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: 'claim-a',
          audienceScope: 'customer:user-a:checkout-order',
          requestHash: checkoutRequestFingerprint(input),
          orderId: 'order-a',
          completedAt: createdAt,
          expiresAt: new Date('2026-07-14T10:00:00.000Z'),
        },
      ]),
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'order-a',
          orderNumber: 'TJ-2026-00000001',
          status: 'CONFIRMED',
          paymentStatus: 'CASH_COLLECTED_BY_COURIER',
          currency: 'TND',
          subtotalMillimes: 10_000,
          discountTotalMillimes: 1_000,
          deliveryTotalMillimes: 2_000,
          taxTotalMillimes: 1_710,
          grandTotalMillimes: 12_710,
          expectedCodMillimes: 12_710,
          deliveryMethodType: 'COURIER',
          createdAt,
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const policies = { evaluate: vi.fn() };
    const service = new CheckoutOrderService(prisma as never, policies as never, {} as never);
    const request = {
      requestId: 'request-a',
      get: vi.fn(),
      socket: {},
    } as unknown as Request;

    await expect(
      service.create(input, 'checkout_0123456789abcdef', 'user-a', request),
    ).resolves.toEqual({
      data: {
        id: 'order-a',
        orderNumber: 'TJ-2026-00000001',
        status: 'PENDING_CONFIRMATION',
        paymentStatus: 'CASH_EXPECTED',
        currency: 'TND',
        subtotalMillimes: 10_000,
        discountTotalMillimes: 1_000,
        deliveryTotalMillimes: 2_000,
        taxTotalMillimes: 1_710,
        grandTotalMillimes: 12_710,
        expectedCodMillimes: 12_710,
        deliveryMethodType: 'COURIER',
        createdAt: '2026-07-13T10:00:00.000Z',
      },
    });
    expect(policies.evaluate).not.toHaveBeenCalled();
    expect(transaction.order.findUnique).toHaveBeenCalledTimes(1);
  });

  it('retries only P2034 transaction conflicts and stops after the bounded third attempt', async () => {
    const transactionConflict = Object.assign(new Error('transaction conflict'), { code: 'P2034' });
    const prisma = { $transaction: vi.fn().mockRejectedValue(transactionConflict) };
    const service = new CheckoutOrderService(
      prisma as never,
      { evaluate: vi.fn() } as never,
      {} as never,
    );
    const request = {
      requestId: 'request-a',
      get: vi.fn(),
      socket: {},
    } as unknown as Request;

    await expect(
      service.create(input, 'checkout_0123456789abcdef', 'user-a', request),
    ).rejects.toBe(transactionConflict);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry a different Prisma failure code', async () => {
    const failure = Object.assign(new Error('constraint failure'), { code: 'P2002' });
    const prisma = { $transaction: vi.fn().mockRejectedValue(failure) };
    const service = new CheckoutOrderService(
      prisma as never,
      { evaluate: vi.fn() } as never,
      {} as never,
    );
    const request = {
      requestId: 'request-a',
      get: vi.fn(),
      socket: {},
    } as unknown as Request;

    await expect(
      service.create(input, 'checkout_0123456789abcdef', 'user-a', request),
    ).rejects.toBe(failure);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of a customer-scoped key with a different fingerprint', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: 'claim-a',
          audienceScope: 'customer:user-a:checkout-order',
          requestHash: 'f'.repeat(64),
          orderId: 'order-a',
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      ]),
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const policies = { evaluate: vi.fn() };
    const service = new CheckoutOrderService(prisma as never, policies as never, {} as never);
    const request = {
      requestId: 'request-a',
      get: vi.fn(),
      socket: {},
    } as unknown as Request;

    const error = await service
      .create(input, 'checkout_0123456789abcdef', 'user-a', request)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error).toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(policies.evaluate).not.toHaveBeenCalled();
  });
});
