import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import { CatalogImportController } from './catalog-import.controller';

const executionContext = (permissions: string[]): ExecutionContext =>
  ({
    getHandler: () => () => undefined,
    getClass: () => CatalogImportController,
    switchToHttp: () => ({ getRequest: () => ({ auth: { permissions } }) }),
  }) as unknown as ExecutionContext;

describe('catalogue import access policy', () => {
  it('binds every route to the administrator realm and catalogue-import permission', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CatalogImportController)).toBe(
      'admin/catalog/imports',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, CatalogImportController)).toEqual([
      AdminSessionGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, CatalogImportController)).toEqual([
      'catalog.import',
    ]);
  });

  it('requires CSRF and recent authentication for every import mutation', () => {
    const mutations = [
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CatalogImportController.prototype.preview,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CatalogImportController.prototype.previewWotofo,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CatalogImportController.prototype.apply,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CatalogImportController.prototype.rollback,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      CatalogImportController.prototype.importMedia,
    ];
    for (const mutation of mutations) {
      expect(Reflect.getMetadata(GUARDS_METADATA, mutation)).toEqual([
        CsrfGuard,
        RecentAuthenticationGuard,
      ]);
    }
  });

  it('denies an authenticated administrator without catalog.import', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(['catalog.import']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(() => guard.canActivate(executionContext(['products.update']))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(executionContext(['catalog.import']))).toBe(true);
  });
});
