import { describe, expect, it } from 'vitest';
import {
  RateResolutionError,
  selectBaseRate,
  type QuoteRateCandidate,
  type RateContext,
} from '../checkout/checkout-pricing';

const context: RateContext = {
  deliveryZoneId: 'zone-1',
  governorateId: 'governorate-1',
  delegationId: 'delegation-1',
  localityId: 'locality-1',
  orderMillimes: 50_000,
  weightGrams: 500,
  express: false,
};

const rate = (overrides: Partial<QuoteRateCandidate> = {}): QuoteRateCandidate => ({
  id: 'global',
  type: 'BASE',
  priority: 0,
  feeMillimes: 7_000,
  deliveryZoneId: null,
  governorateId: null,
  delegationId: null,
  localityId: null,
  minWeightGrams: null,
  maxWeightGrams: null,
  minOrderMillimes: null,
  maxOrderMillimes: null,
  maxCodMillimes: null,
  express: false,
  ...overrides,
});

describe('delivery rate resolver compatibility', () => {
  it('deterministically prefers the most specific configured base rate', () => {
    const selected = selectBaseRate(
      [
        rate(),
        rate({ id: 'zone', deliveryZoneId: 'zone-1' }),
        rate({
          id: 'governorate',
          type: 'GOVERNORATE',
          governorateId: 'governorate-1',
        }),
        rate({ id: 'locality', type: 'LOCALITY', localityId: 'locality-1' }),
      ],
      context,
    );

    expect(selected.id).toBe('locality');
  });

  it('fails closed if legacy data still contains an equal-priority ambiguity', () => {
    expect(() =>
      selectBaseRate(
        [
          rate({ id: 'zone-a', deliveryZoneId: 'zone-1', priority: 20 }),
          rate({ id: 'zone-b', deliveryZoneId: 'zone-1', priority: 20 }),
        ],
        context,
      ),
    ).toThrowError(new RateResolutionError('DELIVERY_RATE_AMBIGUOUS'));
  });
});
