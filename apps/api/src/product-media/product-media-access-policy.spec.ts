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
import { AgeGateGuard } from '../compliance/age-gate.guard';
import {
  AdminProductMediaController,
  PublicProductMediaController,
} from './product-media.controller';

const executionContext = (permissions: string[]): ExecutionContext =>
  ({
    getHandler: () => () => undefined,
    getClass: () => AdminProductMediaController,
    switchToHttp: () => ({ getRequest: () => ({ auth: { permissions } }) }),
  }) as unknown as ExecutionContext;

describe('product media access policy', () => {
  it('keeps administrative mutation and public read routes in separate guard realms', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminProductMediaController)).toBe(
      'admin/products/:productId/images',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminProductMediaController)).toEqual([
      AdminSessionGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PATH_METADATA, PublicProductMediaController)).toBe('media');
    expect(Reflect.getMetadata(GUARDS_METADATA, PublicProductMediaController)).toEqual([
      AgeGateGuard,
    ]);
  });

  it('requires read permission for listing and update permission for every mutation', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const list = AdminProductMediaController.prototype.list;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const getContent = AdminProductMediaController.prototype.getContent;
    const mutations = [
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminProductMediaController.prototype.upload,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminProductMediaController.prototype.updateMetadata,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminProductMediaController.prototype.review,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminProductMediaController.prototype.reorder,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminProductMediaController.prototype.replace,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminProductMediaController.prototype.setPrimary,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AdminProductMediaController.prototype.remove,
    ];

    expect(Reflect.getMetadata(PERMISSIONS_METADATA, list)).toEqual(['products.read']);
    expect(Reflect.getMetadata(GUARDS_METADATA, list)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, getContent)).toEqual(['products.read']);
    expect(Reflect.getMetadata(GUARDS_METADATA, getContent)).toBeUndefined();
    for (const mutation of mutations) {
      expect(Reflect.getMetadata(PERMISSIONS_METADATA, mutation)).toEqual(['products.update']);
      expect(Reflect.getMetadata(GUARDS_METADATA, mutation)).toEqual([
        CsrfGuard,
        RecentAuthenticationGuard,
      ]);
    }
  });

  it('denies an authenticated administrator without the media mutation permission', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(['products.update']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(() => guard.canActivate(executionContext(['products.read']))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(executionContext(['products.update']))).toBe(true);
  });

  it.each([
    ['image/avif,image/webp,image/apng,*/*;q=0.8', 'webp'],
    ['image/jpeg,*/*;q=0.8', 'jpeg'],
    ['image/webp;q=0,image/jpeg;q=1', 'jpeg'],
  ] as const)(
    'content-negotiates a modern rendition with a JPEG fallback',
    async (accept, format) => {
      const bytes = Buffer.from('rendition');
      const media = {
        readPublicRendition: vi.fn().mockResolvedValue({
          bytes,
          byteSize: bytes.length,
          contentType: format === 'webp' ? 'image/webp' : 'image/jpeg',
        }),
      };
      const response = { setHeader: vi.fn() };
      const controller = new PublicProductMediaController(media as never);

      await controller.getRendition(
        { objectKeyHash: 'a'.repeat(64), rendition: 'card', profileVersion: 1 },
        { get: vi.fn().mockReturnValue(accept) } as never,
        response as never,
      );

      expect(media.readPublicRendition).toHaveBeenCalledWith('a'.repeat(64), 'card', format, 1);
      expect(response.setHeader).toHaveBeenCalledWith('Vary', 'Accept');
      expect(response.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        format === 'webp' ? 'image/webp' : 'image/jpeg',
      );
    },
  );
});
