import type { StorefrontDeliveryMetadata } from '../../api/types';

export type DisplayableDeliveryMetadata = Partial<StorefrontDeliveryMetadata>;

function nullableNonNegativeInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Copies only customer-safe delivery fields from an untrusted navigation/API object.
 * Operational assignment, driver communication and review fields are deliberately ignored.
 */
export function readDisplayableDeliveryMetadata(
  value: unknown,
): DisplayableDeliveryMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const metadata: DisplayableDeliveryMetadata = {};
  const estimatedMinDays = nullableNonNegativeInteger(source.estimatedMinDays);
  const estimatedMaxDays = nullableNonNegativeInteger(source.estimatedMaxDays);
  const estimatedMinMinutes = nullableNonNegativeInteger(source.estimatedMinMinutes);
  const estimatedMaxMinutes = nullableNonNegativeInteger(source.estimatedMaxMinutes);
  if (estimatedMinDays !== undefined) metadata.estimatedMinDays = estimatedMinDays;
  if (estimatedMaxDays !== undefined) metadata.estimatedMaxDays = estimatedMaxDays;
  if (estimatedMinMinutes !== undefined) metadata.estimatedMinMinutes = estimatedMinMinutes;
  if (estimatedMaxMinutes !== undefined) metadata.estimatedMaxMinutes = estimatedMaxMinutes;
  if (source.paymentMethod === 'CASH_ON_DELIVERY') {
    metadata.paymentMethod = 'CASH_ON_DELIVERY';
  }
  if (typeof source.phoneConfirmationRequired === 'boolean') {
    metadata.phoneConfirmationRequired = source.phoneConfirmationRequired;
  }

  return Object.values(metadata).some((item) => item !== undefined) ? metadata : undefined;
}
