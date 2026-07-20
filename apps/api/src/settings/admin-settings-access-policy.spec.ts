import 'reflect-metadata';
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { AdminSettingsController } from './admin-settings.controller';

describe('administrator settings access policy', () => {
  it('requires the administrator realm, scoped permissions, CSRF, recent auth, and no-store', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminSettingsController)).toEqual([
      AdminSessionGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, AdminSettingsController)).toEqual([
      NoStoreInterceptor,
    ]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const updateStore = AdminSettingsController.prototype.updateStore;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const updateCompliance = AdminSettingsController.prototype.updateCompliance;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const exportConfiguration = AdminSettingsController.prototype.exportConfiguration;
    expect(Reflect.getMetadata(GUARDS_METADATA, updateStore)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, updateCompliance)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, updateStore)).toEqual(['settings.manage']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, updateCompliance)).toEqual([
      'compliance.manage',
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, exportConfiguration)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, exportConfiguration)).toEqual([
      'settings.manage',
    ]);
  });
});
