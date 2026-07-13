import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { CustomerSessionGuard } from '../auth/guards/customer-session.guard';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { CheckoutController } from './checkout.controller';

describe('checkout order access policy', () => {
  it('keeps the order mutation in the customer realm with CSRF and age confirmation', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CheckoutController)).toBe('checkout');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const createOrder = CheckoutController.prototype.createOrder;
    expect(Reflect.getMetadata(GUARDS_METADATA, createOrder)).toEqual([
      CustomerSessionGuard,
      CsrfGuard,
      AgeGateGuard,
    ]);
  });
});
