import { DeliveryRateType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  databaseTime,
  deliveryConfigurationToken,
  formatDatabaseTime,
  rateScopeKey,
  rateValidityOverlaps,
  type RateScope,
} from './delivery-config-policy';

const rate = (overrides: Partial<RateScope> = {}): RateScope => ({
  type: DeliveryRateType.BASE,
  deliveryZoneId: 'zone-1',
  governorateId: null,
  delegationId: null,
  localityId: null,
  priority: 10,
  validFrom: null,
  validUntil: null,
  ...overrides,
});

describe('delivery configuration policy helpers', () => {
  it('builds a deterministic key from specificity, scope and priority', () => {
    expect(rateScopeKey(rate())).toBe('BASE:zone-1:-:-:-:10');
    expect(rateScopeKey(rate({ localityId: 'locality-1', deliveryZoneId: null }))).toBe(
      'BASE:-:-:-:locality-1:10',
    );
  });

  it('detects overlapping validity periods but permits adjacent half-open periods', () => {
    const first = rate({
      validFrom: new Date('2026-07-01T00:00:00.000Z'),
      validUntil: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(
      rateValidityOverlaps(
        first,
        rate({
          validFrom: new Date('2026-07-15T00:00:00.000Z'),
          validUntil: new Date('2026-09-01T00:00:00.000Z'),
        }),
      ),
    ).toBe(true);
    expect(
      rateValidityOverlaps(
        first,
        rate({
          validFrom: new Date('2026-08-01T00:00:00.000Z'),
          validUntil: null,
        }),
      ),
    ).toBe(false);
  });

  it('uses change-sensitive deterministic state tokens for rows without a schema version', () => {
    const original = deliveryConfigurationToken({ id: 'pickup-1', active: false });
    expect(original).toBe(deliveryConfigurationToken({ id: 'pickup-1', active: false }));
    expect(original).not.toBe(deliveryConfigurationToken({ id: 'pickup-1', active: true }));
    expect(original).toMatch(/^[a-f0-9]{64}$/);
  });

  it('round-trips schema TIME values without a server-timezone dependency', () => {
    expect(formatDatabaseTime(databaseTime('09:30'))).toBe('09:30:00');
    expect(formatDatabaseTime(databaseTime('23:59:58'))).toBe('23:59:58');
  });
});
