const FORMULA_PREFIX = /^[\t\r ]*[=+\-@]/;

export const neutralizeCsvFormula = (value: string): string =>
  FORMULA_PREFIX.test(value) ? `'${value}` : value;

export const escapeCsvCell = (value: string): string => {
  const neutralized = neutralizeCsvFormula(value);
  return /[",\r\n]/.test(neutralized) ? `"${neutralized.replaceAll('"', '""')}"` : neutralized;
};

export type CsvCell = string | number | boolean | null | undefined;

/** Serializes a bounded caller-provided data set as UTF-8 CSV with an Excel-compatible BOM. */
export const serializeCsv = (
  headers: readonly string[],
  rows: readonly (readonly CsvCell[])[],
): string => {
  const line = (values: readonly CsvCell[]) =>
    values
      .map((value) => escapeCsvCell(value === null || value === undefined ? '' : String(value)))
      .join(',');
  return `\uFEFF${[line(headers), ...rows.map(line)].join('\r\n')}\r\n`;
};
