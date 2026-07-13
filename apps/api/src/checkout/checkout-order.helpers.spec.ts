import { describe, expect, it } from 'vitest';
import {
  allocateInventory,
  checkoutRequestFingerprint,
  scopedIdempotencyKeyHash,
  validateIdempotencyKey,
} from './checkout-order.helpers';
import type { CheckoutOrderDto } from './dto/checkout-order.dto';

const request = (items: CheckoutOrderDto['items']): CheckoutOrderDto => ({
  items,
  localityId: 'locality-1',
  customerName: 'Customer Name',
  phone: '+21620111222',
  address: { street: '1 Example Street', postalCode: '1000' },
  consent: { ageConfirmed: true, termsAccepted: true, privacyAccepted: true },
});

describe('checkout order idempotency', () => {
  it('accepts bounded opaque keys and rejects missing or unsafe values', () => {
    expect(validateIdempotencyKey('checkout_0123456789abcdef')).toBe('checkout_0123456789abcdef');
    expect(validateIdempotencyKey(undefined)).toBeNull();
    expect(validateIdempotencyKey('short')).toBeNull();
    expect(validateIdempotencyKey('contains whitespace 123456')).toBeNull();
  });

  it('fingerprints equivalent item ordering identically and detects changed quantities', () => {
    const first = request([
      { variantId: 'variant-b', quantity: 2 },
      { variantId: 'variant-a', quantity: 1 },
    ]);
    const reordered = request([
      { variantId: 'variant-a', quantity: 1 },
      { variantId: 'variant-b', quantity: 2 },
    ]);
    const changed = request([
      { variantId: 'variant-a', quantity: 1 },
      { variantId: 'variant-b', quantity: 3 },
    ]);

    expect(checkoutRequestFingerprint(first)).toBe(checkoutRequestFingerprint(reordered));
    expect(checkoutRequestFingerprint(first)).toBe(
      checkoutRequestFingerprint({ ...first, express: false }),
    );
    expect(checkoutRequestFingerprint(first)).not.toBe(checkoutRequestFingerprint(changed));
  });

  it('scopes the same client key to the authenticated customer', () => {
    expect(scopedIdempotencyKeyHash('customer:a', 'checkout_0123456789abcdef')).not.toBe(
      scopedIdempotencyKeyHash('customer:b', 'checkout_0123456789abcdef'),
    );
  });
});

describe('checkout inventory allocation', () => {
  it('allocates deterministically across locked buckets without exceeding availability', () => {
    expect(
      allocateInventory(
        [{ variantId: 'variant-a', quantity: 3 }],
        [
          { id: 'inventory-b', variantId: 'variant-a', availableQuantity: 2 },
          { id: 'inventory-a', variantId: 'variant-a', availableQuantity: 2 },
        ],
      ),
    ).toEqual([
      { inventoryItemId: 'inventory-a', variantId: 'variant-a', quantity: 2 },
      { inventoryItemId: 'inventory-b', variantId: 'variant-a', quantity: 1 },
    ]);
  });

  it('fails atomically when a requested variant cannot be fully allocated', () => {
    expect(
      allocateInventory(
        [{ variantId: 'variant-a', quantity: 3 }],
        [{ id: 'inventory-a', variantId: 'variant-a', availableQuantity: 2 }],
      ),
    ).toBeNull();
  });

  it('never reuses the same availability across repeated allocation inputs', () => {
    expect(
      allocateInventory(
        [
          { variantId: 'variant-a', quantity: 2 },
          { variantId: 'variant-a', quantity: 1 },
        ],
        [{ id: 'inventory-a', variantId: 'variant-a', availableQuantity: 2 }],
      ),
    ).toBeNull();
  });
});
