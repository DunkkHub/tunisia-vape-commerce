export interface CheckoutPolicyInput {
  checkoutEnabled: boolean;
  legalReviewCompleted: boolean;
  maintenanceMode: boolean;
  prelaunchMode: boolean;
  minimumAge: number | null;
  hasPublishedRequiredLegalDocuments: boolean;
  hasStoreInformation: boolean;
  hasDeliveryMethod: boolean;
}

export type CheckoutBlocker =
  | 'CHECKOUT_DISABLED'
  | 'LEGAL_REVIEW_REQUIRED'
  | 'MAINTENANCE_MODE'
  | 'PRELAUNCH_MODE'
  | 'MINIMUM_AGE_NOT_CONFIGURED'
  | 'LEGAL_DOCUMENTS_MISSING'
  | 'STORE_INFORMATION_MISSING'
  | 'DELIVERY_METHOD_MISSING';

export const evaluateCheckoutPolicy = (input: CheckoutPolicyInput): CheckoutBlocker[] => {
  const blockers: CheckoutBlocker[] = [];
  if (!input.checkoutEnabled) blockers.push('CHECKOUT_DISABLED');
  if (!input.legalReviewCompleted) blockers.push('LEGAL_REVIEW_REQUIRED');
  if (input.maintenanceMode) blockers.push('MAINTENANCE_MODE');
  if (input.prelaunchMode) blockers.push('PRELAUNCH_MODE');
  if (input.minimumAge === null || input.minimumAge < 18) {
    blockers.push('MINIMUM_AGE_NOT_CONFIGURED');
  }
  if (!input.hasPublishedRequiredLegalDocuments) blockers.push('LEGAL_DOCUMENTS_MISSING');
  if (!input.hasStoreInformation) blockers.push('STORE_INFORMATION_MISSING');
  if (!input.hasDeliveryMethod) blockers.push('DELIVERY_METHOD_MISSING');
  return blockers;
};
