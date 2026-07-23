import { DeliveryAttemptOutcome, DeliveryStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  ATTEMPT_OUTCOME_STATUS,
  canTransitionDelivery,
  DELIVERY_TRANSITIONS,
  FAILED_ATTEMPT_OUTCOMES,
} from './delivery-transition-policy';

describe('manual delivery transition policy', () => {
  it('defines a deny-by-default transition entry for every Prisma delivery status', () => {
    expect(Object.keys(DELIVERY_TRANSITIONS).sort()).toEqual(Object.values(DeliveryStatus).sort());
    expect(DELIVERY_TRANSITIONS.DELIVERED).toEqual([]);
    expect(DELIVERY_TRANSITIONS.RETURNED).toEqual([]);
    expect(DELIVERY_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('allows only the documented manual fulfillment sequence', () => {
    expect(canTransitionDelivery(DeliveryStatus.CONFIRMED, DeliveryStatus.PREPARING)).toBe(true);
    expect(
      canTransitionDelivery(DeliveryStatus.ASSIGNED_TO_COURIER, DeliveryStatus.HANDED_TO_COURIER),
    ).toBe(true);
    expect(canTransitionDelivery(DeliveryStatus.FAILED, DeliveryStatus.DELIVERED)).toBe(false);
    expect(canTransitionDelivery(DeliveryStatus.DELIVERED, DeliveryStatus.RETURNED)).toBe(false);
  });

  it('excludes success from failure-attempt intake and maps every controlled outcome', () => {
    expect(FAILED_ATTEMPT_OUTCOMES).not.toContain(DeliveryAttemptOutcome.DELIVERED);
    expect(Object.keys(ATTEMPT_OUTCOME_STATUS).sort()).toEqual([...FAILED_ATTEMPT_OUTCOMES].sort());
    expect(ATTEMPT_OUTCOME_STATUS.FAILED_AGE_VERIFICATION).toBe(DeliveryStatus.FAILED);
  });
});
