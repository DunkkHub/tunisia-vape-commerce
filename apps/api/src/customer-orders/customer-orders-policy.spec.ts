import 'reflect-metadata';
import { GUARDS_METADATA, INTERCEPTORS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { CustomerSessionGuard } from '../auth/guards/customer-session.guard';
import { TrustedOriginGuard } from '../auth/guards/trusted-origin.guard';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { CustomerOrdersController } from './customer-orders.controller';

describe('customer order endpoint policy', () => {
  it('keeps order history in the customer realm with age and origin controls', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CustomerOrdersController)).toBe('orders');
    expect(Reflect.getMetadata(GUARDS_METADATA, CustomerOrdersController)).toEqual([
      TrustedOriginGuard,
      CustomerSessionGuard,
      AgeGateGuard,
    ]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, CustomerOrdersController)).toEqual([
      NoStoreInterceptor,
    ]);
  });

  it('requires CSRF only on customer cancellation', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const cancel = CustomerOrdersController.prototype.cancel;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const get = CustomerOrdersController.prototype.get;
    expect(Reflect.getMetadata(GUARDS_METADATA, cancel)).toEqual([CsrfGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, get)).toBeUndefined();
  });
});
