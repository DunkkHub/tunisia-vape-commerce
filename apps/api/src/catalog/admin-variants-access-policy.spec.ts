import 'reflect-metadata';
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { AdminVariantsController } from './admin-variants.controller';

describe('administrator variant access policy', () => {
  it('keeps reads and writes inside the full admin realm', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminVariantsController)).toEqual([
      AdminSessionGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, AdminVariantsController)).toEqual([
      NoStoreInterceptor,
    ]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const list = AdminVariantsController.prototype.list;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const create = AdminVariantsController.prototype.create;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const update = AdminVariantsController.prototype.update;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const archive = AdminVariantsController.prototype.archive;
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, list)).toEqual(['products.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, create)).toEqual(['products.create']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, update)).toEqual(['products.update']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, archive)).toEqual(['products.archive']);
    for (const mutation of [create, update, archive]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, mutation)).toEqual([
        CsrfGuard,
        RecentAuthenticationGuard,
      ]);
    }
  });
});
