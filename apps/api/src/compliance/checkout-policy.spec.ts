import { describe, expect, it } from 'vitest';
import { evaluateCheckoutPolicy } from './checkout-policy';

describe('checkout operational policy', () => {
  it('does not depend on a legal-review approval flag', () => {
    const blockers = evaluateCheckoutPolicy({
      checkoutEnabled: true,
      maintenanceMode: false,
      prelaunchMode: false,
      minimumAge: 18,
      hasStoreInformation: true,
      hasDeliveryMethod: true,
    });
    expect(blockers).toEqual([]);
  });

  it('allows the policy layer when all gates are satisfied', () => {
    expect(
      evaluateCheckoutPolicy({
        checkoutEnabled: true,
        maintenanceMode: false,
        prelaunchMode: false,
        minimumAge: 18,
        hasStoreInformation: true,
        hasDeliveryMethod: true,
      }),
    ).toEqual([]);
  });

  it('keeps genuine operational prerequisites fail-closed', () => {
    expect(
      evaluateCheckoutPolicy({
        checkoutEnabled: true,
        maintenanceMode: false,
        prelaunchMode: false,
        minimumAge: 18,
        hasStoreInformation: false,
        hasDeliveryMethod: false,
      }),
    ).toEqual(['STORE_INFORMATION_MISSING', 'DELIVERY_METHOD_MISSING']);
  });

  it('accepts an operator-configured positive minimum age without hard-coding legal advice', () => {
    expect(
      evaluateCheckoutPolicy({
        checkoutEnabled: true,
        maintenanceMode: false,
        prelaunchMode: false,
        minimumAge: 16,
        hasStoreInformation: true,
        hasDeliveryMethod: true,
      }),
    ).toEqual([]);
  });

  it('does not make a disabled age feature a technical launch blocker', () => {
    expect(
      evaluateCheckoutPolicy({
        checkoutEnabled: true,
        maintenanceMode: false,
        prelaunchMode: false,
        minimumAge: null,
        minimumAgeRequired: false,
        hasStoreInformation: true,
        hasDeliveryMethod: true,
      }),
    ).toEqual([]);
  });
});
