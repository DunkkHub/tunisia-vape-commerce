import { describe, expect, it } from 'vitest';

import { ApiError } from '../src/api/http';
import {
  checkoutOrderErrorFeedback,
  checkoutQuoteErrorKey,
} from '../src/pages/store/checkout-error-feedback';

describe('checkout quote feedback', () => {
  it('reports incomplete store configuration instead of blaming the delivery address', () => {
    const error = new ApiError(409, {
      code: 'CHECKOUT_UNAVAILABLE',
      blockers: ['STORE_INFORMATION_MISSING'],
    });

    expect(checkoutQuoteErrorKey(error)).toBe('checkout.quoteErrors.storeInformation');
  });

  it('keeps delivery and inventory failures distinct and actionable', () => {
    expect(checkoutQuoteErrorKey(new ApiError(409, { code: 'DELIVERY_AREA_UNSUPPORTED' }))).toBe(
      'checkout.quoteErrors.areaUnsupported',
    );
    expect(checkoutQuoteErrorKey(new ApiError(409, { code: 'OUT_OF_STOCK' }))).toBe(
      'checkout.quoteErrors.outOfStock',
    );
  });

  it('uses a safe generic message for unknown failures', () => {
    expect(checkoutQuoteErrorKey(new Error('network'))).toBe('checkout.quoteErrors.generic');
  });
});

describe('checkout order feedback', () => {
  it('maps postal-code failures and preserves a bounded safe request reference', () => {
    expect(
      checkoutOrderErrorFeedback(
        new ApiError(409, {
          code: 'POSTAL_CODE_INVALID',
          requestId: 'checkout_request-123',
        }),
      ),
    ).toEqual({
      messageKey: 'checkout.orderErrors.postalCode',
      requestId: 'checkout_request-123',
    });
  });

  it.each([
    ['CART_CHANGED', 'checkout.orderErrors.cart'],
    ['CART_EMPTY', 'checkout.orderErrors.cart'],
    ['CART_EXPIRED', 'checkout.orderErrors.cart'],
    ['OUT_OF_STOCK', 'checkout.orderErrors.outOfStock'],
    ['PRODUCT_UNAVAILABLE', 'checkout.orderErrors.productUnavailable'],
    ['PRODUCT_AGE_RESTRICTION', 'checkout.orderErrors.productUnavailable'],
  ] as const)('maps %s to actionable cart or product feedback', (code, messageKey) => {
    expect(checkoutOrderErrorFeedback(new ApiError(409, { code }))).toEqual({ messageKey });
  });

  it.each([
    ['DELIVERY_AREA_UNSUPPORTED', 'checkout.orderErrors.deliveryArea'],
    ['PICKUP_LOCATION_UNAVAILABLE', 'checkout.orderErrors.deliveryArea'],
    ['DELIVERY_RATE_UNAVAILABLE', 'checkout.orderErrors.deliveryConfiguration'],
    ['DELIVERY_CONFIGURATION_INVALID', 'checkout.orderErrors.deliveryConfiguration'],
    ['EXPRESS_DELIVERY_UNAVAILABLE', 'checkout.orderErrors.deliveryConfiguration'],
    ['MINIMUM_ORDER_NOT_MET', 'checkout.orderErrors.minimumOrder'],
    ['MAXIMUM_COD_EXCEEDED', 'checkout.orderErrors.maximumCod'],
    ['FULFILLMENT_SELECTION_REQUIRED', 'checkout.orderErrors.fulfillment'],
    ['DELIVERY_ADDRESS_REQUIRED', 'checkout.orderErrors.fulfillment'],
    ['EXPRESS_PICKUP_UNSUPPORTED', 'checkout.orderErrors.fulfillment'],
  ] as const)('maps %s to safe delivery feedback', (code, messageKey) => {
    expect(checkoutOrderErrorFeedback(new ApiError(409, { code }))).toEqual({ messageKey });
  });

  it.each([
    ['AUTHENTICATION_REQUIRED', 'checkout.orderErrors.authentication'],
    ['CSRF_VALIDATION_FAILED', 'checkout.orderErrors.authentication'],
    ['AGE_CONFIRMATION_REQUIRED', 'checkout.orderErrors.authentication'],
    ['CUSTOMER_ACCOUNT_UNAVAILABLE', 'checkout.orderErrors.account'],
    ['CUSTOMER_CHECKOUT_BLOCKED', 'checkout.orderErrors.account'],
  ] as const)('maps %s without exposing account or authentication details', (code, messageKey) => {
    expect(checkoutOrderErrorFeedback(new ApiError(403, { code }))).toEqual({ messageKey });
  });

  it.each([
    ['IDEMPOTENCY_IN_PROGRESS', 'checkout.orderErrors.idempotencyInProgress'],
    ['IDEMPOTENCY_CONFLICT', 'checkout.orderErrors.idempotencyConflict'],
    ['IDEMPOTENCY_KEY_INVALID', 'checkout.orderErrors.idempotencyUnavailable'],
    ['IDEMPOTENCY_STATE_INVALID', 'checkout.orderErrors.idempotencyUnavailable'],
  ] as const)('keeps %s recovery semantics distinct', (code, messageKey) => {
    expect(checkoutOrderErrorFeedback(new ApiError(409, { code }))).toEqual({ messageKey });
  });

  it('maps checkout policy failures without exposing blocker details', () => {
    expect(
      checkoutOrderErrorFeedback(
        new ApiError(409, {
          code: 'CHECKOUT_UNAVAILABLE',
          blockers: ['STORE_INFORMATION_MISSING'],
        }),
      ),
    ).toEqual({ messageKey: 'checkout.orderErrors.unavailable' });
    expect(
      checkoutOrderErrorFeedback(
        new ApiError(409, {
          code: 'CHECKOUT_UNAVAILABLE',
          blockers: ['DELIVERY_METHOD_MISSING'],
        }),
      ),
    ).toEqual({ messageKey: 'checkout.orderErrors.deliveryConfiguration' });
  });

  it.each([
    'short',
    'request id with spaces',
    'request/id/with/slashes',
    `<script>alert('request-id')</script>`,
    'a'.repeat(81),
  ])('omits unsafe request references: %s', (requestId) => {
    expect(
      checkoutOrderErrorFeedback(
        new ApiError(503, { code: 'CHECKOUT_TRANSACTION_UNAVAILABLE', requestId }),
      ),
    ).toEqual({ messageKey: 'checkout.orderErrors.unknown' });
  });

  it('uses a safe unknown-outcome key for network and unrecognized API failures', () => {
    expect(checkoutOrderErrorFeedback(new Error('socket disconnected'))).toEqual({
      messageKey: 'checkout.orderErrors.unknown',
    });
    expect(
      checkoutOrderErrorFeedback(
        new ApiError(503, {
          code: 'UNEXPECTED_INTERNAL_DETAIL',
          message: 'sensitive internal message',
          requestId: 'request_12345678',
        }),
      ),
    ).toEqual({
      messageKey: 'checkout.orderErrors.unknown',
      requestId: 'request_12345678',
    });
  });
});
