import type { PrismaService } from '../database/prisma.service';
import { describe, expect, it, vi } from 'vitest';
import { GeographyService } from './geography.service';

describe('checkout geography reads', () => {
  it('returns only the safe localized governorate projection with support state', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'gov-1',
        nameFr: 'Tunis',
        nameAr: 'تونس',
        delegations: [{ id: 'delegation-1' }],
      },
    ]);
    const service = new GeographyService({ governorate: { findMany } } as unknown as PrismaService);

    await expect(service.governorates('ar')).resolves.toEqual({
      data: [{ id: 'gov-1', name: 'تونس', supported: true }],
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 24 }));
  });

  it('marks an active locality unsupported when no active delivery zone link exists', async () => {
    const service = new GeographyService({
      locality: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'locality-1',
            nameFr: 'Centre',
            nameAr: 'المركز',
            postalCodes: [{ code: '1000' }],
            zoneLinks: [],
          },
        ]),
      },
    } as unknown as PrismaService);

    await expect(service.localities('delegation-1', 'fr')).resolves.toEqual({
      data: [
        {
          id: 'locality-1',
          name: 'Centre',
          postalCode: '1000',
          supported: false,
        },
      ],
    });
  });

  it('does not advertise courier delivery without a current nonnegative base rate', async () => {
    const prisma = {
      pickupLocation: { findMany: vi.fn().mockResolvedValue([]) },
      locality: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'locality-1',
          delegationId: 'delegation-1',
          delegation: { governorateId: 'governorate-1' },
          zoneLinks: [
            {
              priorityOverride: null,
              deliveryZone: {
                id: 'zone-1',
                priority: 10,
                nameFr: 'Grand Tunis',
                nameAr: 'تونس الكبرى',
                minOrderMillimes: null,
                maxCodMillimes: null,
              },
            },
          ],
        }),
      },
      deliveryRate: { count: vi.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const service = new GeographyService(prisma);

    await expect(service.deliveryMethods('locality-1', 'fr')).resolves.toEqual({ data: [] });
  });

  it('returns active pickup and rate-backed courier methods without exposing provider data', async () => {
    const prisma = {
      pickupLocation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'pickup-1',
            nameFr: 'Retrait centre',
            nameAr: 'استلام المركز',
            address: 'Tunis',
            minOrderMillimes: 5_000,
            maxCodMillimes: 500_000,
          },
        ]),
      },
      locality: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'locality-1',
          delegationId: 'delegation-1',
          delegation: { governorateId: 'governorate-1' },
          zoneLinks: [
            {
              priorityOverride: null,
              deliveryZone: {
                id: 'zone-1',
                priority: 10,
                nameFr: 'Livraison Tunis',
                nameAr: 'توصيل تونس',
                minOrderMillimes: 10_000,
                maxCodMillimes: 400_000,
              },
            },
          ],
        }),
      },
      deliveryRate: { count: vi.fn().mockResolvedValue(1) },
    } as unknown as PrismaService;
    const service = new GeographyService(prisma);

    await expect(service.deliveryMethods('locality-1', 'fr')).resolves.toEqual({
      data: [
        {
          id: 'courier:zone-1',
          type: 'COURIER',
          label: 'Livraison Tunis',
          address: null,
          minimumOrderMillimes: 10_000,
          maximumCodMillimes: 400_000,
        },
        {
          id: 'pickup-1',
          type: 'STORE_PICKUP',
          label: 'Retrait centre',
          address: 'Tunis',
          minimumOrderMillimes: 5_000,
          maximumCodMillimes: 500_000,
        },
      ],
    });
  });
});
