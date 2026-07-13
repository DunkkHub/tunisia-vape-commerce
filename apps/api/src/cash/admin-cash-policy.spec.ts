import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import { AdminCashController } from './admin-cash.controller';

describe('administrator cash access policy', () => {
  it('binds every route to the administrator realm and permission guard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminCashController)).toBe('admin/cash');
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminCashController)).toEqual([
      AdminSessionGuard,
      PermissionsGuard,
    ]);
  });

  it('uses granular cash permissions, CSRF, and recent authentication', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const collections = AdminCashController.prototype.collections;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const recordCollection = AdminCashController.prototype.recordCollection;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const createRemittance = AdminCashController.prototype.createRemittance;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const reconcile = AdminCashController.prototype.reconcileRemittance;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const resolve = AdminCashController.prototype.resolveDiscrepancy;

    expect(Reflect.getMetadata(PERMISSIONS_METADATA, collections)).toEqual(['cash.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, recordCollection)).toEqual(['cash.collect']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, createRemittance)).toEqual(['cash.remit']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, reconcile)).toEqual(['cash.reconcile']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, resolve)).toEqual(['cash.reconcile']);
    expect(Reflect.getMetadata(GUARDS_METADATA, recordCollection)).toEqual([CsrfGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, createRemittance)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, reconcile)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, resolve)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
  });
});
