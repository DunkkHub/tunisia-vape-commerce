import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import { AdminProductsController } from './admin-products.controller';

const executionContext = (permissions: string[]): ExecutionContext =>
  ({
    getHandler: () => () => undefined,
    getClass: () => AdminProductsController,
    switchToHttp: () => ({
      getRequest: () => ({ auth: { permissions } }),
    }),
  }) as unknown as ExecutionContext;

describe('administrator catalog access policy', () => {
  it('binds the admin realm, CSRF and permission guards to every mutation', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminProductsController) as unknown[];
    expect(guards).toEqual([AdminSessionGuard, PermissionsGuard]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const createHandler = AdminProductsController.prototype.create;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const listHandler = AdminProductsController.prototype.list;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const archiveHandler = AdminProductsController.prototype.archive;
    const mutationGuards = Reflect.getMetadata(GUARDS_METADATA, createHandler) as unknown[];
    expect(mutationGuards).toEqual([CsrfGuard, RecentAuthenticationGuard]);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, listHandler)).toEqual(['products.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, createHandler)).toEqual(['products.create']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, archiveHandler)).toEqual(['products.archive']);
  });

  it('denies an authenticated admin who lacks the required permission', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(['products.update']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(() => guard.canActivate(executionContext(['products.read']))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(executionContext(['products.update']))).toBe(true);
  });
});
