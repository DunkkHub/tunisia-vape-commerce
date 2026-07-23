import { OrderStatus } from '@prisma/client';

export const ORDER_STATUS_TRANSITIONS = {
  PENDING_CONFIRMATION: [OrderStatus.CONFIRMED, OrderStatus.ON_HOLD, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.ON_HOLD, OrderStatus.PREPARING, OrderStatus.CANCELLED],
  ON_HOLD: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.CANCELLED],
  PREPARING: [OrderStatus.READY_FOR_PICKUP, OrderStatus.ASSIGNED_TO_COURIER, OrderStatus.CANCELLED],
  READY_FOR_PICKUP: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  ASSIGNED_TO_COURIER: [OrderStatus.HANDED_TO_COURIER, OrderStatus.CANCELLED],
  HANDED_TO_COURIER: [OrderStatus.IN_TRANSIT, OrderStatus.RETURN_TO_SENDER],
  IN_TRANSIT: [
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERY_ATTEMPTED,
    OrderStatus.RETURN_TO_SENDER,
  ],
  OUT_FOR_DELIVERY: [
    OrderStatus.DELIVERED,
    OrderStatus.DELIVERY_ATTEMPTED,
    OrderStatus.REFUSED,
    OrderStatus.FAILED,
  ],
  DELIVERY_ATTEMPTED: [
    OrderStatus.RESCHEDULED,
    OrderStatus.DELIVERED,
    OrderStatus.REFUSED,
    OrderStatus.FAILED,
    OrderStatus.RETURN_TO_SENDER,
  ],
  RESCHEDULED: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.RETURN_TO_SENDER],
  DELIVERED: [],
  REFUSED: [OrderStatus.RETURN_TO_SENDER],
  FAILED: [OrderStatus.RESCHEDULED, OrderStatus.RETURN_TO_SENDER],
  RETURN_TO_SENDER: [OrderStatus.RETURNED],
  RETURNED: [],
  CANCELLED: [],
} as const satisfies Record<OrderStatus, readonly OrderStatus[]>;

export const EARLY_CANCELLATION_STATUSES = new Set<OrderStatus>([
  OrderStatus.PENDING_CONFIRMATION,
  OrderStatus.CONFIRMED,
  OrderStatus.ON_HOLD,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.ASSIGNED_TO_COURIER,
]);

export const canTransitionOrder = (from: OrderStatus, to: OrderStatus): boolean =>
  (ORDER_STATUS_TRANSITIONS[from] as readonly OrderStatus[]).includes(to);
