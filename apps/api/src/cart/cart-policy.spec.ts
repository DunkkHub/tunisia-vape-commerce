import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  availableCartQuantity,
  cartLineTotal,
  cartSubtotal,
  effectiveCartUnitPrice,
} from './cart-policy';

describe('customer cart policy', () => {
  it('derives the effective price only from authoritative integer-millime catalog values', () => {
    expect(effectiveCartUnitPrice(12_000, 10_000)).toEqual({
      listPriceMillimes: 12_000,
      promotionalPriceMillimes: 10_000,
      unitPriceMillimes: 10_000,
    });
    expect(effectiveCartUnitPrice(12_000, 13_000).unitPriceMillimes).toBe(12_000);
    expect(effectiveCartUnitPrice(12_000, -1).unitPriceMillimes).toBe(12_000);
  });

  it('rejects corrupt list prices instead of producing a cart total', () => {
    expect(() => effectiveCartUnitPrice(-1, null)).toThrow(ServiceUnavailableException);
    expect(() => effectiveCartUnitPrice(1.5, null)).toThrow(ServiceUnavailableException);
  });

  it('subtracts only supplied active reservations without editing reservation state', () => {
    expect(
      availableCartQuantity([
        { onHandQuantity: 5, reservations: [{ quantity: 2 }] },
        { onHandQuantity: 3, reservations: [{ quantity: 1 }] },
      ]),
    ).toBe(5);
  });

  it('fails closed when reservation data would imply negative availability', () => {
    expect(() =>
      availableCartQuantity([{ onHandQuantity: 1, reservations: [{ quantity: 2 }] }]),
    ).toThrow(ServiceUnavailableException);
  });

  it('calculates line and cart totals as safe integer millimes', () => {
    expect(cartLineTotal(3_333, 3)).toBe(9_999);
    expect(cartSubtotal([9_999, 2_001])).toBe(12_000);
  });
});
