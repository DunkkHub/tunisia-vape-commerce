import { describe, expect, it } from 'vitest';
import { assertDeliveryTransition, canTransitionDelivery } from './delivery-state-machine';

describe('delivery state machine', () => {
  it('allows operationally valid transitions', () => {
    expect(canTransitionDelivery('ASSIGNED', 'PICKED_UP')).toBe(true);
    expect(canTransitionDelivery('OUT_FOR_DELIVERY', 'REFUSED')).toBe(true);
  });

  it('prevents skipping custody and terminal-state changes', () => {
    expect(() => assertDeliveryTransition('CREATED', 'DELIVERED')).toThrow();
    expect(() => assertDeliveryTransition('DELIVERED', 'FAILED')).toThrow();
  });
});
