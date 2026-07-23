import { createHash } from 'node:crypto';
import type { DeliveryRateType } from '@prisma/client';

export interface RateScope {
  type: DeliveryRateType;
  deliveryZoneId: string | null;
  governorateId: string | null;
  delegationId: string | null;
  localityId: string | null;
  priority: number;
  validFrom: Date | null;
  validUntil: Date | null;
}

export const rateScopeKey = (rate: RateScope): string =>
  [
    rate.type,
    rate.deliveryZoneId ?? '-',
    rate.governorateId ?? '-',
    rate.delegationId ?? '-',
    rate.localityId ?? '-',
    rate.priority,
  ].join(':');

export const rateValidityOverlaps = (left: RateScope, right: RateScope): boolean => {
  const leftStart = left.validFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
  const leftEnd = left.validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightStart = right.validFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightEnd = right.validUntil?.getTime() ?? Number.POSITIVE_INFINITY;
  return leftStart < rightEnd && rightStart < leftEnd;
};

export const deliveryConfigurationToken = (value: Record<string, unknown>): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const databaseTime = (value: string): Date =>
  new Date(`1970-01-01T${value.length === 5 ? `${value}:00` : value}Z`);

export const formatDatabaseTime = (value: Date): string =>
  [value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds()]
    .map((part) => part.toString().padStart(2, '0'))
    .join(':');
