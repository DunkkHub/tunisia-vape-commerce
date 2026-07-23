import 'reflect-metadata';
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { AdminInventoryController } from './admin-inventory.controller';

describe('administrator inventory access policy', () => {
  it('requires the full administrator realm and no-store responses', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminInventoryController)).toEqual([
      AdminSessionGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, AdminInventoryController)).toEqual([
      NoStoreInterceptor,
    ]);
  });

  it('requires read for reads and adjust plus CSRF/recent auth for writes', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const read = AdminInventoryController.prototype.getVariant;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const movements = AdminInventoryController.prototype.movements;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const adjust = AdminInventoryController.prototype.adjust;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const threshold = AdminInventoryController.prototype.updateThreshold;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const locations = AdminInventoryController.prototype.locations;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const createLocation = AdminInventoryController.prototype.createLocation;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const createItem = AdminInventoryController.prototype.createItem;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const receiveBatch = AdminInventoryController.prototype.receiveBatch;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const adjustments = AdminInventoryController.prototype.adjustments;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const decideAdjustment = AdminInventoryController.prototype.decideAdjustment;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const transfer = AdminInventoryController.prototype.transfer;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const transfers = AdminInventoryController.prototype.transfers;

    expect(Reflect.getMetadata(PERMISSIONS_METADATA, read)).toEqual(['inventory.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, movements)).toEqual(['inventory.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, locations)).toEqual(['inventory.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, adjust)).toEqual(['inventory.adjust']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, threshold)).toEqual(['inventory.adjust']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, createLocation)).toEqual(['inventory.adjust']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, createItem)).toEqual(['inventory.adjust']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, receiveBatch)).toEqual(['inventory.adjust']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, adjustments)).toEqual(['inventory.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, decideAdjustment)).toEqual([
      'inventory.approve',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, transfer)).toEqual(['inventory.transfer']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, transfers)).toEqual(['inventory.read']);
    expect(Reflect.getMetadata(GUARDS_METADATA, adjust)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, threshold)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, createLocation)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, createItem)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, receiveBatch)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, decideAdjustment)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, transfer)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
  });
});
