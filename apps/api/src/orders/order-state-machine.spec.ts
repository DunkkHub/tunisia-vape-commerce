import { OrderStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  canTransitionOrder,
  EARLY_CANCELLATION_STATUSES,
  ORDER_STATUS_TRANSITIONS,
} from './order-state-machine';

describe('order state machine', () => {
  it('has an explicit transition entry for every Prisma order status', () => {
    expect(Object.keys(ORDER_STATUS_TRANSITIONS).sort()).toEqual(Object.values(OrderStatus).sort());
  });

  it('allows intake confirmation only from pending confirmation', () => {
    expect(canTransitionOrder(OrderStatus.PENDING_CONFIRMATION, OrderStatus.CONFIRMED)).toBe(true);
    expect(canTransitionOrder(OrderStatus.CONFIRMED, OrderStatus.CONFIRMED)).toBe(false);
    expect(canTransitionOrder(OrderStatus.CANCELLED, OrderStatus.CONFIRMED)).toBe(false);
  });

  it('limits cancellation to explicit pre-custody states', () => {
    expect(EARLY_CANCELLATION_STATUSES.has(OrderStatus.PENDING_CONFIRMATION)).toBe(true);
    expect(EARLY_CANCELLATION_STATUSES.has(OrderStatus.ASSIGNED_TO_COURIER)).toBe(true);
    expect(EARLY_CANCELLATION_STATUSES.has(OrderStatus.HANDED_TO_COURIER)).toBe(false);
    expect(EARLY_CANCELLATION_STATUSES.has(OrderStatus.DELIVERED)).toBe(false);
  });
});
