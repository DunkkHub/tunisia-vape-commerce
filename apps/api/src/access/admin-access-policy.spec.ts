import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import {
  SUPER_ADMINISTRATOR_ROLE_KEY,
  SuperAdministratorGuard,
} from '../auth/guards/super-administrator.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import { AUTH_AUDIENCES } from '../common/auth/auth.constants';
import { AdminAccountsController } from './admin-accounts.controller';
import { CustomerAccountActionsController } from './customer-account-actions.controller';

const executionContext = (audience: 'ADMIN' | 'CUSTOMER', roleKeys: string[]): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ auth: { audience, roleKeys } }),
    }),
  }) as unknown as ExecutionContext;

describe('super-administrator access policy', () => {
  it('allows only the exact super-administrator role in the administrator realm', () => {
    const guard = new SuperAdministratorGuard();

    expect(
      guard.canActivate(executionContext(AUTH_AUDIENCES.ADMIN, [SUPER_ADMINISTRATOR_ROLE_KEY])),
    ).toBe(true);
    expect(() =>
      guard.canActivate(executionContext(AUTH_AUDIENCES.ADMIN, ['administrator'])),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(executionContext(AUTH_AUDIENCES.ADMIN, ['super-administrator-assistant'])),
    ).toThrow(ForbiddenException);
  });

  it('rejects a customer-realm session even when it carries the super role key', () => {
    const guard = new SuperAdministratorGuard();

    expect(() =>
      guard.canActivate(executionContext(AUTH_AUDIENCES.CUSTOMER, [SUPER_ADMINISTRATOR_ROLE_KEY])),
    ).toThrow(ForbiddenException);
  });

  it('keeps administrator and customer management on separate controller paths', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminAccountsController)).toBe('admin/access/admins');
    expect(Reflect.getMetadata(PATH_METADATA, CustomerAccountActionsController)).toBe(
      'admin/customers',
    );
  });

  it('binds realm, permission and exact-role guards to both controllers', () => {
    const expectedGuards = [AdminSessionGuard, PermissionsGuard, SuperAdministratorGuard];

    expect(Reflect.getMetadata(GUARDS_METADATA, AdminAccountsController)).toEqual(expectedGuards);
    expect(Reflect.getMetadata(GUARDS_METADATA, CustomerAccountActionsController)).toEqual(
      expectedGuards,
    );
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, AdminAccountsController)).toEqual([
      'users.manage',
      'system.manage',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, CustomerAccountActionsController)).toEqual([
      'customers.suspend',
      'system.manage',
    ]);
  });

  it('requires CSRF and recent authentication for every lifecycle mutation', () => {
    const mutationGuards = [CsrfGuard, RecentAuthenticationGuard];
    const adminMutations = [
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminAccountsController.prototype.create,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminAccountsController.prototype.suspend,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminAccountsController.prototype.reactivate,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminAccountsController.prototype.anonymize,
    ];
    const customerMutations = [
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CustomerAccountActionsController.prototype.suspend,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CustomerAccountActionsController.prototype.reactivate,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CustomerAccountActionsController.prototype.disable,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CustomerAccountActionsController.prototype.anonymize,
    ];

    for (const handler of [...adminMutations, ...customerMutations]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual(mutationGuards);
    }
  });
});
