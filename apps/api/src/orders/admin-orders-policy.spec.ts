import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import { AdminOrdersController } from './admin-orders.controller';

describe('administrator order intake access policy', () => {
  it('binds all routes to the full administrator realm and permission guard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminOrdersController)).toBe('admin/orders');
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminOrdersController)).toEqual([
      AdminSessionGuard,
      PermissionsGuard,
    ]);
  });

  it('requires the exact permissions and stronger guards for sensitive transitions', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const get = AdminOrdersController.prototype.get;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const confirm = AdminOrdersController.prototype.confirm;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const cancel = AdminOrdersController.prototype.cancel;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const addNote = AdminOrdersController.prototype.addNote;

    expect(Reflect.getMetadata(PERMISSIONS_METADATA, get)).toEqual(['orders.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, confirm)).toEqual(['orders.update']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, cancel)).toEqual(['orders.cancel']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, addNote)).toEqual(['orders.update']);
    expect(Reflect.getMetadata(GUARDS_METADATA, confirm)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, cancel)).toEqual([
      CsrfGuard,
      RecentAuthenticationGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, addNote)).toEqual([CsrfGuard]);
  });
});
