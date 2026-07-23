import 'reflect-metadata';
import { GUARDS_METADATA, INTERCEPTORS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { CustomerSessionGuard } from '../auth/guards/customer-session.guard';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { CartController } from './cart.controller';

describe('customer cart access policy', () => {
  it('keeps the cart in the authenticated customer realm behind the age gate', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CartController)).toBe('cart');
    expect(Reflect.getMetadata(GUARDS_METADATA, CartController)).toEqual([
      CustomerSessionGuard,
      AgeGateGuard,
    ]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, CartController)).toEqual([
      NoStoreInterceptor,
    ]);
  });

  it('requires customer CSRF on every mutation but not on reads', () => {
    const mutations = [
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CartController.prototype.add,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CartController.prototype.update,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CartController.prototype.remove,
    ];
    for (const mutation of mutations) {
      expect(Reflect.getMetadata(GUARDS_METADATA, mutation)).toEqual([CsrfGuard]);
    }
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(GUARDS_METADATA, CartController.prototype.get)).toBeUndefined();
  });
});
