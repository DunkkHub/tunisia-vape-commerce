import { describe, expect, it } from 'vitest';
import { addMillimes, calculateBasisPoints, multiplyMillimes } from './money';

describe('integer money calculations', () => {
  it('calculates totals in millimes without floating point input', () => {
    expect(multiplyMillimes(12_500, 3)).toBe(37_500);
    expect(addMillimes(37_500, 7_000, -2_500)).toBe(42_000);
    expect(calculateBasisPoints(42_000, 1_900)).toBe(7_980);
  });

  it('rejects fractional and unsafe money values', () => {
    expect(() => addMillimes(1.5)).toThrow(RangeError);
    expect(() => multiplyMillimes(100, -1)).toThrow(RangeError);
  });

  it('avoids an unsafe intermediate when applying basis points', () => {
    const amount = Number.MAX_SAFE_INTEGER;
    const expected = Number((BigInt(amount) + 5_000n) / 10_000n);
    expect(calculateBasisPoints(amount, 1)).toBe(expected);
  });
});
