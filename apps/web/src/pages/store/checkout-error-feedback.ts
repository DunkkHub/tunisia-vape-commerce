import { ApiError } from '../../api/http';

export type CheckoutQuoteErrorKey =
  | 'checkout.quoteErrors.storeInformation'
  | 'checkout.quoteErrors.deliveryConfiguration'
  | 'checkout.quoteErrors.areaUnsupported'
  | 'checkout.quoteErrors.outOfStock'
  | 'checkout.quoteErrors.productUnavailable'
  | 'checkout.quoteErrors.minimumOrder'
  | 'checkout.quoteErrors.maximumCod'
  | 'checkout.quoteErrors.generic';

export type CheckoutOrderErrorKey =
  | 'checkout.orderErrors.postalCode'
  | 'checkout.orderErrors.cart'
  | 'checkout.orderErrors.outOfStock'
  | 'checkout.orderErrors.productUnavailable'
  | 'checkout.orderErrors.deliveryArea'
  | 'checkout.orderErrors.deliveryConfiguration'
  | 'checkout.orderErrors.minimumOrder'
  | 'checkout.orderErrors.maximumCod'
  | 'checkout.orderErrors.fulfillment'
  | 'checkout.orderErrors.validation'
  | 'checkout.orderErrors.authentication'
  | 'checkout.orderErrors.account'
  | 'checkout.orderErrors.unavailable'
  | 'checkout.orderErrors.idempotencyInProgress'
  | 'checkout.orderErrors.idempotencyConflict'
  | 'checkout.orderErrors.idempotencyUnavailable'
  | 'checkout.orderErrors.unknown';

export interface CheckoutOrderErrorFeedback {
  messageKey: CheckoutOrderErrorKey;
  requestId?: string;
}

const requestIdPattern = /^[A-Za-z0-9_-]{8,80}$/;

function orderFeedback(
  messageKey: CheckoutOrderErrorKey,
  requestId: unknown,
): CheckoutOrderErrorFeedback {
  return typeof requestId === 'string' && requestIdPattern.test(requestId)
    ? { messageKey, requestId }
    : { messageKey };
}

export function checkoutQuoteErrorKey(error: unknown): CheckoutQuoteErrorKey {
  if (!(error instanceof ApiError)) return 'checkout.quoteErrors.generic';

  if (error.code === 'CHECKOUT_UNAVAILABLE') {
    if (error.blockers.includes('STORE_INFORMATION_MISSING')) {
      return 'checkout.quoteErrors.storeInformation';
    }
    if (error.blockers.includes('DELIVERY_METHOD_MISSING')) {
      return 'checkout.quoteErrors.deliveryConfiguration';
    }
    return 'checkout.quoteErrors.generic';
  }

  switch (error.code) {
    case 'DELIVERY_AREA_UNSUPPORTED':
      return 'checkout.quoteErrors.areaUnsupported';
    case 'DELIVERY_RATE_UNAVAILABLE':
    case 'DELIVERY_CONFIGURATION_INVALID':
    case 'EXPRESS_DELIVERY_UNAVAILABLE':
      return 'checkout.quoteErrors.deliveryConfiguration';
    case 'OUT_OF_STOCK':
      return 'checkout.quoteErrors.outOfStock';
    case 'PRODUCT_UNAVAILABLE':
      return 'checkout.quoteErrors.productUnavailable';
    case 'MINIMUM_ORDER_NOT_MET':
      return 'checkout.quoteErrors.minimumOrder';
    case 'MAXIMUM_COD_EXCEEDED':
      return 'checkout.quoteErrors.maximumCod';
    default:
      return 'checkout.quoteErrors.generic';
  }
}

export function checkoutOrderErrorFeedback(error: unknown): CheckoutOrderErrorFeedback {
  if (!(error instanceof ApiError)) {
    return { messageKey: 'checkout.orderErrors.unknown' };
  }

  if (error.code === 'CHECKOUT_UNAVAILABLE') {
    return orderFeedback(
      error.blockers.includes('DELIVERY_METHOD_MISSING')
        ? 'checkout.orderErrors.deliveryConfiguration'
        : 'checkout.orderErrors.unavailable',
      error.requestId,
    );
  }

  let messageKey: CheckoutOrderErrorKey;
  switch (error.code) {
    case 'POSTAL_CODE_INVALID':
      messageKey = 'checkout.orderErrors.postalCode';
      break;
    case 'CART_CHANGED':
    case 'CART_EMPTY':
    case 'CART_EXPIRED':
      messageKey = 'checkout.orderErrors.cart';
      break;
    case 'OUT_OF_STOCK':
      messageKey = 'checkout.orderErrors.outOfStock';
      break;
    case 'PRODUCT_UNAVAILABLE':
    case 'PRODUCT_AGE_RESTRICTION':
      messageKey = 'checkout.orderErrors.productUnavailable';
      break;
    case 'DELIVERY_AREA_UNSUPPORTED':
    case 'PICKUP_LOCATION_UNAVAILABLE':
      messageKey = 'checkout.orderErrors.deliveryArea';
      break;
    case 'DELIVERY_RATE_UNAVAILABLE':
    case 'DELIVERY_CONFIGURATION_INVALID':
    case 'EXPRESS_DELIVERY_UNAVAILABLE':
      messageKey = 'checkout.orderErrors.deliveryConfiguration';
      break;
    case 'MINIMUM_ORDER_NOT_MET':
      messageKey = 'checkout.orderErrors.minimumOrder';
      break;
    case 'MAXIMUM_COD_EXCEEDED':
      messageKey = 'checkout.orderErrors.maximumCod';
      break;
    case 'FULFILLMENT_SELECTION_REQUIRED':
    case 'DELIVERY_ADDRESS_REQUIRED':
    case 'EXPRESS_PICKUP_UNSUPPORTED':
      messageKey = 'checkout.orderErrors.fulfillment';
      break;
    case 'CONSENT_REQUIRED':
    case 'CONSENT_VERSION_INVALID':
    case 'DUPLICATE_CHECKOUT_ITEM':
    case 'VALIDATION_ERROR':
      messageKey = 'checkout.orderErrors.validation';
      break;
    case 'AUTHENTICATION_REQUIRED':
    case 'CSRF_VALIDATION_FAILED':
    case 'AGE_CONFIRMATION_REQUIRED':
      messageKey = 'checkout.orderErrors.authentication';
      break;
    case 'CUSTOMER_ACCOUNT_UNAVAILABLE':
    case 'CUSTOMER_CHECKOUT_BLOCKED':
      messageKey = 'checkout.orderErrors.account';
      break;
    case 'IDEMPOTENCY_IN_PROGRESS':
      messageKey = 'checkout.orderErrors.idempotencyInProgress';
      break;
    case 'IDEMPOTENCY_CONFLICT':
      messageKey = 'checkout.orderErrors.idempotencyConflict';
      break;
    case 'IDEMPOTENCY_KEY_INVALID':
    case 'IDEMPOTENCY_STATE_INVALID':
      messageKey = 'checkout.orderErrors.idempotencyUnavailable';
      break;
    default:
      messageKey = 'checkout.orderErrors.unknown';
  }

  return orderFeedback(messageKey, error.requestId);
}
