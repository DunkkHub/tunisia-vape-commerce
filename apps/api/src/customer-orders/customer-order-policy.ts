import { OrderStatus } from '@prisma/client';

/**
 * Customer self-service cancellation is deliberately narrower than administrator cancellation.
 * Confirmation consumes reservations and decrements on-hand stock, so only the initial reserved
 * state can be cancelled without fabricating a physical stock return.
 */
export const CUSTOMER_CANCELLATION_STATUSES = new Set<OrderStatus>([
  OrderStatus.PENDING_CONFIRMATION,
]);

export const canCustomerCancelOrder = (status: OrderStatus): boolean =>
  CUSTOMER_CANCELLATION_STATUSES.has(status);
