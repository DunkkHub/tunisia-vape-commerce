import { addMillimes, calculateBasisPoints, multiplyMillimes } from '../common/money/money';

export interface QuoteLineInput {
  listUnitPriceMillimes: number;
  promotionalUnitPriceMillimes: number | null;
  quantity: number;
  taxRateBps: number;
}

export interface QuoteLineCalculation {
  listSubtotalMillimes: number;
  discountMillimes: number;
  taxableSubtotalMillimes: number;
  taxMillimes: number;
  totalMillimes: number;
  effectiveUnitPriceMillimes: number;
}

export const calculateQuoteLine = (input: QuoteLineInput): QuoteLineCalculation => {
  if (
    input.listUnitPriceMillimes < 0 ||
    (input.promotionalUnitPriceMillimes !== null &&
      (input.promotionalUnitPriceMillimes < 0 ||
        input.promotionalUnitPriceMillimes > input.listUnitPriceMillimes))
  ) {
    throw new RangeError('Invalid catalog price');
  }
  const effectiveUnitPriceMillimes =
    input.promotionalUnitPriceMillimes ?? input.listUnitPriceMillimes;
  const listSubtotalMillimes = multiplyMillimes(input.listUnitPriceMillimes, input.quantity);
  const effectiveSubtotal = multiplyMillimes(effectiveUnitPriceMillimes, input.quantity);
  const discountMillimes = addMillimes(listSubtotalMillimes, -effectiveSubtotal);
  const taxMillimes = calculateBasisPoints(effectiveSubtotal, input.taxRateBps);
  return {
    listSubtotalMillimes,
    discountMillimes,
    taxableSubtotalMillimes: effectiveSubtotal,
    taxMillimes,
    totalMillimes: addMillimes(effectiveSubtotal, taxMillimes),
    effectiveUnitPriceMillimes,
  };
};

export type QuoteRateType =
  | 'BASE'
  | 'GOVERNORATE'
  | 'DELEGATION'
  | 'LOCALITY'
  | 'REMOTE_SURCHARGE'
  | 'WEIGHT_SURCHARGE'
  | 'OVERSIZE_SURCHARGE'
  | 'EXPRESS_SURCHARGE';

export interface QuoteRateCandidate {
  id: string;
  type: QuoteRateType;
  priority: number;
  feeMillimes: number;
  deliveryZoneId: string | null;
  governorateId: string | null;
  delegationId: string | null;
  localityId: string | null;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
  minOrderMillimes: number | null;
  maxOrderMillimes: number | null;
  maxCodMillimes: number | null;
  express: boolean;
}

export interface RateContext {
  deliveryZoneId: string;
  governorateId: string;
  delegationId: string;
  localityId: string;
  orderMillimes: number;
  weightGrams: number;
  express: boolean;
}

export class RateResolutionError extends Error {
  constructor(readonly code: 'DELIVERY_RATE_MISSING' | 'DELIVERY_RATE_AMBIGUOUS') {
    super(code);
  }
}

const withinBounds = (rate: QuoteRateCandidate, context: RateContext): boolean =>
  (rate.minOrderMillimes === null || context.orderMillimes >= rate.minOrderMillimes) &&
  (rate.maxOrderMillimes === null || context.orderMillimes <= rate.maxOrderMillimes) &&
  (rate.maxCodMillimes === null || context.orderMillimes <= rate.maxCodMillimes) &&
  (rate.minWeightGrams === null || context.weightGrams >= rate.minWeightGrams) &&
  (rate.maxWeightGrams === null || context.weightGrams <= rate.maxWeightGrams);

const geographicRank = (rate: QuoteRateCandidate, context: RateContext): number => {
  if (rate.localityId === context.localityId) return 5;
  if (rate.delegationId === context.delegationId && rate.localityId === null) return 4;
  if (
    rate.governorateId === context.governorateId &&
    rate.delegationId === null &&
    rate.localityId === null
  ) {
    return 3;
  }
  if (
    rate.deliveryZoneId === context.deliveryZoneId &&
    rate.governorateId === null &&
    rate.delegationId === null &&
    rate.localityId === null
  ) {
    return 2;
  }
  if (
    rate.deliveryZoneId === null &&
    rate.governorateId === null &&
    rate.delegationId === null &&
    rate.localityId === null
  ) {
    return 1;
  }
  return -1;
};

const baseTypeMatchesRank = (rate: QuoteRateCandidate, rank: number): boolean =>
  (rank === 5 && rate.type === 'LOCALITY') ||
  (rank === 4 && rate.type === 'DELEGATION') ||
  (rank === 3 && rate.type === 'GOVERNORATE') ||
  ((rank === 2 || rank === 1) && rate.type === 'BASE');

const chooseUnique = (
  ranked: Array<{ rate: QuoteRateCandidate; rank: number }>,
  required: boolean,
): QuoteRateCandidate | null => {
  ranked.sort(
    (left, right) =>
      right.rank - left.rank ||
      right.rate.priority - left.rate.priority ||
      left.rate.id.localeCompare(right.rate.id),
  );
  const first = ranked[0];
  if (!first) {
    if (required) throw new RateResolutionError('DELIVERY_RATE_MISSING');
    return null;
  }
  const second = ranked[1];
  if (second && second.rank === first.rank && second.rate.priority === first.rate.priority) {
    throw new RateResolutionError('DELIVERY_RATE_AMBIGUOUS');
  }
  return first.rate;
};

export const selectBaseRate = (
  rates: QuoteRateCandidate[],
  context: RateContext,
): QuoteRateCandidate => {
  const selected = chooseUnique(
    rates.flatMap((rate) => {
      const rank = geographicRank(rate, context);
      return rank > 0 && baseTypeMatchesRank(rate, rank) && withinBounds(rate, context)
        ? [{ rate, rank }]
        : [];
    }),
    true,
  );
  if (!selected) throw new RateResolutionError('DELIVERY_RATE_MISSING');
  return selected;
};

export const selectSurchargeRate = (
  rates: QuoteRateCandidate[],
  context: RateContext,
  type: Exclude<QuoteRateType, 'BASE' | 'GOVERNORATE' | 'DELEGATION' | 'LOCALITY'>,
): QuoteRateCandidate | null =>
  chooseUnique(
    rates.flatMap((rate) => {
      const rank = geographicRank(rate, context);
      const expressAllowed = type !== 'EXPRESS_SURCHARGE' || context.express;
      return rate.type === type && rank > 0 && expressAllowed && withinBounds(rate, context)
        ? [{ rate, rank }]
        : [];
    }),
    false,
  );
