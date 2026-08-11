const MAX_COURIER_FEE_MILLIMES = 1_000_000;

type CourierFeeError = 'format' | 'precision' | 'nonNegative' | 'maximum';

export type OptionalCourierFeeResult =
  { value: number | null; error: null } | { value: null; error: CourierFeeError };

export function parseOptionalCourierFeeTnd(input: string): OptionalCourierFeeResult {
  const normalized = input.trim();
  if (!normalized) return { value: null, error: null };
  if (normalized.startsWith('-')) return { value: null, error: 'nonNegative' };
  if (!/^\d+(?:[.,]\d*)?$/.test(normalized)) return { value: null, error: 'format' };
  const [whole = '', decimals = ''] = normalized.replace(',', '.').split('.');
  if (decimals.length > 3) return { value: null, error: 'precision' };
  const value = Number(whole) * 1_000 + Number(decimals.padEnd(3, '0'));
  if (!Number.isSafeInteger(value)) return { value: null, error: 'format' };
  if (value > MAX_COURIER_FEE_MILLIMES) return { value: null, error: 'maximum' };
  return { value, error: null };
}
