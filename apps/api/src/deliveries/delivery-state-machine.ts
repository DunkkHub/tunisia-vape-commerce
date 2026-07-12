export type DeliveryStatus =
  | 'CREATED'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED'
  | 'REFUSED'
  | 'RETURN_TO_SENDER'
  | 'RETURNED';

const transitions: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  CREATED: ['ASSIGNED'],
  ASSIGNED: ['PICKED_UP', 'FAILED'],
  PICKED_UP: ['OUT_FOR_DELIVERY', 'FAILED', 'RETURN_TO_SENDER'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED', 'REFUSED', 'RETURN_TO_SENDER'],
  DELIVERED: [],
  FAILED: ['ASSIGNED', 'RETURN_TO_SENDER'],
  REFUSED: ['RETURN_TO_SENDER'],
  RETURN_TO_SENDER: ['RETURNED'],
  RETURNED: [],
};

export const canTransitionDelivery = (from: DeliveryStatus, to: DeliveryStatus): boolean =>
  transitions[from].includes(to);

export const assertDeliveryTransition = (from: DeliveryStatus, to: DeliveryStatus): void => {
  if (!canTransitionDelivery(from, to)) {
    throw new Error(`Invalid delivery transition: ${from} -> ${to}`);
  }
};
