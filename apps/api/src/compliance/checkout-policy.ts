export interface CheckoutPolicyInput {
  checkoutEnabled: boolean;
  maintenanceMode: boolean;
  prelaunchMode: boolean;
  minimumAge: number | null;
  minimumAgeRequired?: boolean;
  hasStoreInformation: boolean;
  hasDeliveryMethod: boolean;
}

export type CheckoutBlocker =
  | 'CHECKOUT_DISABLED'
  | 'MAINTENANCE_MODE'
  | 'PRELAUNCH_MODE'
  | 'MINIMUM_AGE_NOT_CONFIGURED'
  | 'STORE_INFORMATION_MISSING'
  | 'DELIVERY_METHOD_MISSING';

export const evaluateCheckoutPolicy = (input: CheckoutPolicyInput): CheckoutBlocker[] => {
  const blockers: CheckoutBlocker[] = [];
  if (!input.checkoutEnabled) blockers.push('CHECKOUT_DISABLED');
  if (input.maintenanceMode) blockers.push('MAINTENANCE_MODE');
  if (input.prelaunchMode) blockers.push('PRELAUNCH_MODE');
  if (input.minimumAgeRequired !== false && (input.minimumAge === null || input.minimumAge < 1)) {
    blockers.push('MINIMUM_AGE_NOT_CONFIGURED');
  }
  if (!input.hasStoreInformation) blockers.push('STORE_INFORMATION_MISSING');
  if (!input.hasDeliveryMethod) blockers.push('DELIVERY_METHOD_MISSING');
  return blockers;
};
