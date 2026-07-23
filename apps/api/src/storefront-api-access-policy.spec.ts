import 'reflect-metadata';
import { GUARDS_METADATA, INTERCEPTORS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { CsrfGuard } from './auth/guards/csrf.guard';
import { CustomerSessionGuard } from './auth/guards/customer-session.guard';
import { TrustedOriginGuard } from './auth/guards/trusted-origin.guard';
import { AgeGateGuard } from './compliance/age-gate.guard';
import { NoStoreInterceptor } from './common/http/no-store.interceptor';
import { CustomerAddressesController } from './customer-addresses/customer-addresses.controller';
import {
  LegalDocumentsController,
  StorefrontContentController,
} from './storefront-content/storefront-content.controller';
import { WishlistController } from './wishlist/wishlist.controller';

const CUSTOMER_GUARDS = [TrustedOriginGuard, CustomerSessionGuard, AgeGateGuard];

describe('storefront customer API access policy', () => {
  it('keeps saved addresses in the customer realm and requires CSRF for every mutation', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CustomerAddressesController)).toBe(
      'customers/me/addresses',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, CustomerAddressesController)).toEqual(
      CUSTOMER_GUARDS,
    );
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, CustomerAddressesController)).toEqual([
      NoStoreInterceptor,
    ]);

    const mutations = [
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CustomerAddressesController.prototype.create,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CustomerAddressesController.prototype.update,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CustomerAddressesController.prototype.remove,
    ];
    for (const mutation of mutations) {
      expect(Reflect.getMetadata(GUARDS_METADATA, mutation)).toEqual([CsrfGuard]);
    }
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(GUARDS_METADATA, CustomerAddressesController.prototype.list)).toBe(
      undefined,
    );
  });

  it('keeps wishlist reads and writes in the same customer-only policy', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WishlistController)).toBe('wishlist');
    expect(Reflect.getMetadata(GUARDS_METADATA, WishlistController)).toEqual(CUSTOMER_GUARDS);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, WishlistController)).toEqual([
      NoStoreInterceptor,
    ]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(GUARDS_METADATA, WishlistController.prototype.add)).toEqual([
      CsrfGuard,
    ]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(GUARDS_METADATA, WishlistController.prototype.remove)).toEqual([
      CsrfGuard,
    ]);
  });

  it('leaves published legal and operator content public without an auth or age guard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, LegalDocumentsController)).toBe('legal/documents');
    expect(Reflect.getMetadata(PATH_METADATA, StorefrontContentController)).toBe(
      'storefront/content',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, LegalDocumentsController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, StorefrontContentController)).toBeUndefined();
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, LegalDocumentsController)).toEqual([
      NoStoreInterceptor,
    ]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, StorefrontContentController)).toEqual([
      NoStoreInterceptor,
    ]);
  });
});
