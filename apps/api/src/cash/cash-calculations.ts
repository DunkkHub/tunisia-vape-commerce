const MAX_MILLIMES = 2_000_000_000;

export const assertMillimes = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MILLIMES) {
    throw new RangeError('INVALID_MILLIMES');
  }
  return value;
};

export const sumMillimes = (values: readonly number[]): number => {
  const total = values.reduce((sum, value) => sum + assertMillimes(value), 0);
  return assertMillimes(total);
};

export const cashDifference = (expectedMillimes: number, actualMillimes: number): number =>
  assertMillimes(actualMillimes) - assertMillimes(expectedMillimes);
