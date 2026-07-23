import 'reflect-metadata';
import { GUARDS_METADATA, INTERCEPTORS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { AdminBrandsController, AdminCategoriesController } from './taxonomy.controller';

describe('administrator taxonomy access policy', () => {
  it('uses the distinct seeded brand and category permissions', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminBrandsController)).toBe('admin/brands');
    expect(Reflect.getMetadata(PATH_METADATA, AdminCategoriesController)).toBe('admin/categories');
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, AdminBrandsController)).toEqual([
      'brands.manage',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, AdminCategoriesController)).toEqual([
      'categories.manage',
    ]);
  });

  it('requires a full administrator session and disables response caching', () => {
    for (const controller of [AdminBrandsController, AdminCategoriesController]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
        AdminSessionGuard,
        PermissionsGuard,
      ]);
      expect(Reflect.getMetadata(INTERCEPTORS_METADATA, controller)).toEqual([NoStoreInterceptor]);
    }
  });

  it('requires CSRF and recent authentication on every taxonomy write', () => {
    const handlers = [
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminBrandsController.prototype.create,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminBrandsController.prototype.update,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminBrandsController.prototype.archive,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminBrandsController.prototype.restore,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminCategoriesController.prototype.create,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminCategoriesController.prototype.update,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminCategoriesController.prototype.archive,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminCategoriesController.prototype.restore,
    ];
    for (const handler of handlers) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        CsrfGuard,
        RecentAuthenticationGuard,
      ]);
    }
  });
});
