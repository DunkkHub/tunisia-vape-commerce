import { describe, expect, it } from 'vitest';
import { evaluateCheckoutPolicy } from './checkout-policy';

describe('checkout compliance policy', () => {
  it('blocks checkout until every legal and operational gate is satisfied', () => {
    const blockers = evaluateCheckoutPolicy({
      checkoutEnabled: true,
      legalReviewCompleted: false,
      maintenanceMode: false,
      prelaunchMode: false,
      minimumAge: 18,
      hasPublishedRequiredLegalDocuments: true,
      hasStoreInformation: true,
      hasDeliveryMethod: true,
    });
    expect(blockers).toContain('LEGAL_REVIEW_REQUIRED');
  });

  it('allows the policy layer when all gates are satisfied', () => {
    expect(
      evaluateCheckoutPolicy({
        checkoutEnabled: true,
        legalReviewCompleted: true,
        maintenanceMode: false,
        prelaunchMode: false,
        minimumAge: 18,
        hasPublishedRequiredLegalDocuments: true,
        hasStoreInformation: true,
        hasDeliveryMethod: true,
      }),
    ).toEqual([]);
  });
});
