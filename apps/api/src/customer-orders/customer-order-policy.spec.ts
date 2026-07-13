import { OrderStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { canCustomerCancelOrder, CUSTOMER_CANCELLATION_STATUSES } from './customer-order-policy';

describe('customer order cancellation policy', () => {
  it('allows only the initial reserved pre-custody state', () => {
    expect([...CUSTOMER_CANCELLATION_STATUSES]).toEqual([OrderStatus.PENDING_CONFIRMATION]);
    expect(canCustomerCancelOrder(OrderStatus.PENDING_CONFIRMATION)).toBe(true);
    expect(canCustomerCancelOrder(OrderStatus.CONFIRMED)).toBe(false);
    expect(canCustomerCancelOrder(OrderStatus.HANDED_TO_COURIER)).toBe(false);
    expect(canCustomerCancelOrder(OrderStatus.DELIVERED)).toBe(false);
    expect(canCustomerCancelOrder(OrderStatus.CANCELLED)).toBe(false);
  });
});
