import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { AdminReadController } from './admin-read.controller';

const executionContext = (permissions: string[]): ExecutionContext =>
  ({
    getHandler: () => () => undefined,
    getClass: () => AdminReadController,
    switchToHttp: () => ({
      getRequest: () => ({ auth: { permissions } }),
    }),
  }) as unknown as ExecutionContext;

describe('administrator operational read access policy', () => {
  it('binds the full admin realm and no-store policy to every read', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminReadController)).toEqual([
      AdminSessionGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, AdminReadController)).toEqual([
      NoStoreInterceptor,
    ]);
  });

  it('uses only exact seeded permission keys', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const dashboard = AdminReadController.prototype.dashboard;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const inventory = AdminReadController.prototype.inventory;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const settings = AdminReadController.prototype.settings;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const audit = AdminReadController.prototype.audit;

    expect(Reflect.getMetadata(PERMISSIONS_METADATA, dashboard)).toEqual(['reports.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, inventory)).toEqual(['inventory.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, settings)).toEqual(['settings.manage']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, audit)).toEqual(['audit.read']);
  });

  it('denies a fully authenticated administrator without the endpoint permission', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(['audit.read']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(() => guard.canActivate(executionContext(['reports.read']))).toThrow(ForbiddenException);
    expect(guard.canActivate(executionContext(['audit.read']))).toBe(true);
  });
});
