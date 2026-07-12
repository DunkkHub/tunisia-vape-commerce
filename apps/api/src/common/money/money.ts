const assertMillimes = (value: number): void => {
  if (!Number.isSafeInteger(value))
    throw new RangeError('Money must be a safe integer in millimes');
};

export const addMillimes = (...values: number[]): number => {
  values.forEach(assertMillimes);
  const total = values.reduce((sum, value) => sum + value, 0);
  assertMillimes(total);
  return total;
};

export const multiplyMillimes = (unitPrice: number, quantity: number): number => {
  assertMillimes(unitPrice);
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new RangeError('Invalid quantity');
  const total = unitPrice * quantity;
  assertMillimes(total);
  return total;
};

export const calculateBasisPoints = (amount: number, basisPoints: number): number => {
  assertMillimes(amount);
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 100_000) {
    throw new RangeError('Invalid basis points');
  }
  const numerator = BigInt(amount) * BigInt(basisPoints);
  const denominator = 10_000n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded =
    remainder > 5_000n
      ? quotient + 1n
      : remainder < -5_000n
        ? quotient - 1n
        : remainder === 5_000n
          ? quotient + 1n
          : quotient;
  const result = Number(rounded);
  assertMillimes(result);
  return result;
};
