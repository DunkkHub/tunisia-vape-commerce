import { describe, expect, it } from 'vitest';
import {
  calculateQuoteLine,
  RateResolutionError,
  selectBaseRate,
  type QuoteRateCandidate,
  type RateContext,
} from './checkout-pricing';

const context: RateContext = {
  deliveryZoneId: 'zone-1',
  governorateId: 'gov-1',
  delegationId: 'del-1',
  localityId: 'loc-1',
  orderMillimes: 60_000,
  weightGrams: 500,
  express: false,
};

const rate = (overrides: Partial<QuoteRateCandidate>): QuoteRateCandidate => ({
  id: 'base',
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

describe('authoritative checkout pricing', () => {
  it('calculates discounts and tax from integer millimes', () => {
    expect(
      calculateQuoteLine({
        listUnitPriceMillimes: 12_500,
        promotionalUnitPriceMillimes: 10_000,
        quantity: 3,
        taxRateBps: 1_900,
      }),
    ).toEqual({
      listSubtotalMillimes: 37_500,
      discountMillimes: 7_500,
      taxableSubtotalMillimes: 30_000,
      taxMillimes: 5_700,
      totalMillimes: 35_700,
      effectiveUnitPriceMillimes: 10_000,
    });
  });

  it('selects locality before delegation, governorate, zone and global rates', () => {
    const selected = selectBaseRate(
      [
        rate({ id: 'global' }),
        rate({ id: 'zone', deliveryZoneId: 'zone-1' }),
        rate({ id: 'governorate', type: 'GOVERNORATE', governorateId: 'gov-1' }),
        rate({ id: 'locality', type: 'LOCALITY', localityId: 'loc-1' }),
      ],
      context,
    );
    expect(selected.id).toBe('locality');
  });

  it('blocks an ambiguous equal-specificity, equal-priority rate configuration', () => {
    expect(() =>
      selectBaseRate(
        [
          rate({ id: 'locality-a', type: 'LOCALITY', localityId: 'loc-1', priority: 10 }),
          rate({ id: 'locality-b', type: 'LOCALITY', localityId: 'loc-1', priority: 10 }),
        ],
        context,
      ),
    ).toThrowError(new RateResolutionError('DELIVERY_RATE_AMBIGUOUS'));
  });
});
