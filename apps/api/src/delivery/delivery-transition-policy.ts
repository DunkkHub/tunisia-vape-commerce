import { DeliveryAttemptOutcome, DeliveryStatus } from '@prisma/client';

export const DELIVERY_TRANSITIONS = {
  PENDING_CONFIRMATION: [],
  CONFIRMED: [DeliveryStatus.ON_HOLD, DeliveryStatus.PREPARING],
  ON_HOLD: [DeliveryStatus.CONFIRMED],
  PREPARING: [DeliveryStatus.READY_FOR_PICKUP, DeliveryStatus.ASSIGNED_TO_COURIER],
  READY_FOR_PICKUP: [DeliveryStatus.DELIVERED],
  ASSIGNED_TO_COURIER: [DeliveryStatus.HANDED_TO_COURIER],
  HANDED_TO_COURIER: [DeliveryStatus.IN_TRANSIT],
  IN_TRANSIT: [DeliveryStatus.OUT_FOR_DELIVERY],
  OUT_FOR_DELIVERY: [
    DeliveryStatus.DELIVERY_ATTEMPTED,
    DeliveryStatus.RESCHEDULED,
    DeliveryStatus.DELIVERED,
    DeliveryStatus.REFUSED,
    DeliveryStatus.FAILED,
  ],
  DELIVERY_ATTEMPTED: [DeliveryStatus.RESCHEDULED],
  RESCHEDULED: [DeliveryStatus.OUT_FOR_DELIVERY],
  DELIVERED: [],
  REFUSED: [DeliveryStatus.RETURN_TO_SENDER],
  FAILED: [DeliveryStatus.RETURN_TO_SENDER],
  RETURN_TO_SENDER: [DeliveryStatus.RETURNED],
  RETURNED: [],
  CANCELLED: [],
} as const satisfies Record<DeliveryStatus, readonly DeliveryStatus[]>;

export const OPERATIONAL_DELIVERY_TARGETS = [
  DeliveryStatus.ON_HOLD,
  DeliveryStatus.CONFIRMED,
  DeliveryStatus.PREPARING,
  DeliveryStatus.READY_FOR_PICKUP,
  DeliveryStatus.ASSIGNED_TO_COURIER,
  DeliveryStatus.HANDED_TO_COURIER,
  DeliveryStatus.IN_TRANSIT,
  DeliveryStatus.OUT_FOR_DELIVERY,
  DeliveryStatus.RETURN_TO_SENDER,
] as const;

export const DELIVERY_ASSIGNMENT_STATUSES = new Set<DeliveryStatus>([
  DeliveryStatus.CONFIRMED,
  DeliveryStatus.PREPARING,
  DeliveryStatus.ASSIGNED_TO_COURIER,
]);

export const FAILED_ATTEMPT_OUTCOMES = [
  DeliveryAttemptOutcome.CUSTOMER_UNAVAILABLE,
  DeliveryAttemptOutcome.ADDRESS_NOT_FOUND,
  DeliveryAttemptOutcome.CUSTOMER_REFUSED,
  DeliveryAttemptOutcome.FAILED_AGE_VERIFICATION,
  DeliveryAttemptOutcome.PARTIAL_CASH_NOT_ALLOWED,
  DeliveryAttemptOutcome.RESCHEDULED,
  DeliveryAttemptOutcome.OTHER_FAILED,
] as const;

export const ATTEMPT_OUTCOME_STATUS = {
  CUSTOMER_UNAVAILABLE: DeliveryStatus.DELIVERY_ATTEMPTED,
  ADDRESS_NOT_FOUND: DeliveryStatus.FAILED,
  CUSTOMER_REFUSED: DeliveryStatus.REFUSED,
  FAILED_AGE_VERIFICATION: DeliveryStatus.FAILED,
  PARTIAL_CASH_NOT_ALLOWED: DeliveryStatus.FAILED,
  RESCHEDULED: DeliveryStatus.RESCHEDULED,
  OTHER_FAILED: DeliveryStatus.FAILED,
} as const satisfies Record<(typeof FAILED_ATTEMPT_OUTCOMES)[number], DeliveryStatus>;

export const canTransitionDelivery = (from: DeliveryStatus, to: DeliveryStatus): boolean =>
  (DELIVERY_TRANSITIONS[from] as readonly DeliveryStatus[]).includes(to);
