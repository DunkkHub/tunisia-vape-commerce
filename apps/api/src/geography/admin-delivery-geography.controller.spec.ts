import 'reflect-metadata';
/* eslint-disable @typescript-eslint/unbound-method -- handlers are inspected as metadata targets */
import { GUARDS_METADATA, INTERCEPTORS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { AdminDeliveryGeographyController } from './admin-delivery-geography.controller';
import type { GeographyService } from './geography.service';

const request = (acceptLanguage: string): Request =>
  ({
    get: vi.fn((header: string) =>
      header.toLowerCase() === 'accept-language' ? acceptLanguage : undefined,
    ),
  }) as unknown as Request;

describe('administrator delivery geography controller', () => {
  it('requires a full administrator session, deliveries.read and no-store responses', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminDeliveryGeographyController)).toBe(
      'admin/delivery-config/geography',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminDeliveryGeographyController)).toEqual([
      AdminSessionGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, AdminDeliveryGeographyController)).toEqual([
      NoStoreInterceptor,
    ]);

    const handlers = [
      AdminDeliveryGeographyController.prototype.governorates,
      AdminDeliveryGeographyController.prototype.delegations,
      AdminDeliveryGeographyController.prototype.localities,
    ];
    for (const handler of handlers)
      expect(Reflect.getMetadata(PERMISSIONS_METADATA, handler)).toEqual(['deliveries.read']);
  });

  it('delegates bounded projections with the requested locale and parent identifier', async () => {
    const geography = {
      governorates: vi.fn().mockResolvedValue({ data: [] }),
      delegations: vi.fn().mockResolvedValue({ data: [] }),
      localities: vi.fn().mockResolvedValue({ data: [] }),
    };
    const controller = new AdminDeliveryGeographyController(
      geography as unknown as GeographyService,
    );

    await expect(controller.governorates(request('ar-TN,ar;q=0.9'))).resolves.toEqual({ data: [] });
    await expect(controller.delegations({ id: 'gov-1' }, request('fr-FR'))).resolves.toEqual({
      data: [],
    });
    await expect(controller.localities({ id: 'delegation-1' }, request('ar'))).resolves.toEqual({
      data: [],
    });

    expect(geography.governorates).toHaveBeenCalledWith('ar');
    expect(geography.delegations).toHaveBeenCalledWith('gov-1', 'fr');
    expect(geography.localities).toHaveBeenCalledWith('delegation-1', 'ar');
  });
});
