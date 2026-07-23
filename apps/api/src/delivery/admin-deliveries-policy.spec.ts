import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import { AdminDeliveriesController } from './admin-deliveries.controller';

describe('administrator delivery access policy', () => {
  it('binds the controller to full administrator authentication and permissions', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminDeliveriesController)).toBe('admin/deliveries');
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminDeliveriesController)).toEqual([
      AdminSessionGuard,
      PermissionsGuard,
    ]);
  });

  it('requires CSRF on all writes and recent authentication on dangerous operations', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const couriers = AdminDeliveriesController.prototype.couriers;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const assign = AdminDeliveriesController.prototype.assign;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const reassign = AdminDeliveriesController.prototype.reassign;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const transition = AdminDeliveriesController.prototype.transition;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const recordAttempt = AdminDeliveriesController.prototype.recordAttempt;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const complete = AdminDeliveriesController.prototype.complete;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const completeReturn = AdminDeliveriesController.prototype.completeReturn;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const createCourier = AdminDeliveriesController.prototype.createCourier;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const updateCourier = AdminDeliveriesController.prototype.updateCourier;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const createManifest = AdminDeliveriesController.prototype.createManifest;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const transitionManifest = AdminDeliveriesController.prototype.transitionManifest;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const importStatus = AdminDeliveriesController.prototype.importStatus;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const manifestCsv = AdminDeliveriesController.prototype.manifestCsv;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const statusCsv = AdminDeliveriesController.prototype.statusCsv;

    expect(Reflect.getMetadata(PERMISSIONS_METADATA, couriers)).toEqual(['deliveries.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, assign)).toEqual(['deliveries.assign']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, transition)).toEqual(['deliveries.update']);
    for (const handler of [assign, reassign, transition, recordAttempt]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        CsrfGuard,
        RecentAuthenticationGuard,
      ]);
    }
    expect(Reflect.getMetadata(GUARDS_METADATA, complete)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, completeReturn)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    for (const handler of [
      createCourier,
      updateCourier,
      createManifest,
      transitionManifest,
      importStatus,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        CsrfGuard,
        RecentAuthenticationGuard,
      ]);
    }
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, createCourier)).toEqual(['deliveries.update']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, createManifest)).toEqual([
      'deliveries.assign',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, importStatus)).toEqual(['deliveries.update']);
    for (const handler of [manifestCsv, statusCsv]) {
      expect(Reflect.getMetadata(PERMISSIONS_METADATA, handler)).toEqual([
        'deliveries.read',
        'reports.export',
      ]);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RecentAuthenticationGuard]);
    }
  });
});
