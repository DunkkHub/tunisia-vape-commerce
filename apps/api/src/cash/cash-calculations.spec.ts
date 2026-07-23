import { describe, expect, it } from 'vitest';
import { assertMillimes, cashDifference, sumMillimes } from './cash-calculations';

describe('integer cash calculations', () => {
  it('sums and compares integer Tunisian millimes without floating point', () => {
    expect(sumMillimes([12_000, 3_500, 500])).toBe(16_000);
    expect(cashDifference(16_000, 15_500)).toBe(-500);
    expect(cashDifference(16_000, 16_250)).toBe(250);
  });

  it('rejects negative, fractional, unsafe, and database-overflowing values', () => {
    expect(() => assertMillimes(-1)).toThrow('INVALID_MILLIMES');
    expect(() => assertMillimes(1.5)).toThrow('INVALID_MILLIMES');
    expect(() => assertMillimes(Number.MAX_SAFE_INTEGER)).toThrow('INVALID_MILLIMES');
    expect(() => sumMillimes([2_000_000_000, 1])).toThrow('INVALID_MILLIMES');
  });
});
