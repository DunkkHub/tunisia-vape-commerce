import 'reflect-metadata';
/* eslint-disable @typescript-eslint/unbound-method -- handlers are inspected as metadata targets */
import { GUARDS_METADATA, INTERCEPTORS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { AdminDeliveryConfigController } from './delivery-config.controller';

describe('administrator delivery configuration access policy', () => {
  it('binds the surface to the administrator realm and disables response caching', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminDeliveryConfigController)).toBe(
      'admin/delivery-config',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminDeliveryConfigController)).toEqual([
      AdminSessionGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, AdminDeliveryConfigController)).toEqual([
      NoStoreInterceptor,
    ]);
  });

  it('requires deliveries.read on every bounded read', () => {
    const handlers = [
      AdminDeliveryConfigController.prototype.listZones,
      AdminDeliveryConfigController.prototype.getZone,
      AdminDeliveryConfigController.prototype.listRates,
      AdminDeliveryConfigController.prototype.getRate,
      AdminDeliveryConfigController.prototype.listPickups,
      AdminDeliveryConfigController.prototype.getPickup,
      AdminDeliveryConfigController.prototype.listWindows,
      AdminDeliveryConfigController.prototype.getWindow,
    ];
    for (const handler of handlers)
      expect(Reflect.getMetadata(PERMISSIONS_METADATA, handler)).toEqual(['deliveries.read']);
  });

  it('requires deliveries.update, CSRF and recent authentication on every write', () => {
    const handlers = [
      AdminDeliveryConfigController.prototype.createZone,
      AdminDeliveryConfigController.prototype.updateZone,
      AdminDeliveryConfigController.prototype.activateZone,
      AdminDeliveryConfigController.prototype.deactivateZone,
      AdminDeliveryConfigController.prototype.linkZoneGeography,
      AdminDeliveryConfigController.prototype.createRate,
      AdminDeliveryConfigController.prototype.updateRate,
      AdminDeliveryConfigController.prototype.activateRate,
      AdminDeliveryConfigController.prototype.deactivateRate,
      AdminDeliveryConfigController.prototype.createPickup,
      AdminDeliveryConfigController.prototype.updatePickup,
      AdminDeliveryConfigController.prototype.activatePickup,
      AdminDeliveryConfigController.prototype.deactivatePickup,
      AdminDeliveryConfigController.prototype.createWindow,
      AdminDeliveryConfigController.prototype.updateWindow,
      AdminDeliveryConfigController.prototype.activateWindow,
      AdminDeliveryConfigController.prototype.deactivateWindow,
    ];
    for (const handler of handlers) {
      expect(Reflect.getMetadata(PERMISSIONS_METADATA, handler)).toEqual(['deliveries.update']);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        CsrfGuard,
        RecentAuthenticationGuard,
      ]);
    }
  });
});
