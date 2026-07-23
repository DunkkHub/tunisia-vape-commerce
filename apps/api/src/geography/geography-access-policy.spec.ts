import 'reflect-metadata';
import { GUARDS_METADATA, INTERCEPTORS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { DeliveryOptionsController, GeographyController } from './geography.controller';

describe('checkout geography access policy', () => {
  it('uses separate bounded read routes behind the storefront age gate', () => {
    expect(Reflect.getMetadata(PATH_METADATA, GeographyController)).toBe('geography');
    expect(Reflect.getMetadata(PATH_METADATA, DeliveryOptionsController)).toBe('delivery');
    for (const controller of [GeographyController, DeliveryOptionsController]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([AgeGateGuard]);
      expect(Reflect.getMetadata(INTERCEPTORS_METADATA, controller)).toEqual([NoStoreInterceptor]);
    }
  });
});
