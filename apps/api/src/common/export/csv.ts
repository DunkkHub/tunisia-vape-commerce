const FORMULA_PREFIX = /^[\t\r ]*[=+\-@]/;

export const neutralizeCsvFormula = (value: string): string =>
  FORMULA_PREFIX.test(value) ? `'${value}` : value;

export const escapeCsvCell = (value: string): string => {
  const neutralized = neutralizeCsvFormula(value);
  return /[",\r\n]/.test(neutralized) ? `"${neutralized.replaceAll('"', '""')}"` : neutralized;
};
