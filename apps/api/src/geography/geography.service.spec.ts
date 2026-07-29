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

  it('bounds active delegations to an active parent and localizes the safe projection', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'delegation-1',
        nameFr: 'Bizerte Nord',
        nameAr: 'بنزرت الشمالية',
        localities: [],
      },
    ]);
    const service = new GeographyService({ delegation: { findMany } } as unknown as PrismaService);

    await expect(service.delegations('governorate-1', 'ar')).resolves.toEqual({
      data: [{ id: 'delegation-1', name: 'بنزرت الشمالية', supported: false }],
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          governorateId: 'governorate-1',
          active: true,
          governorate: { is: { active: true } },
        },
        take: 100,
      }),
    );
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

  it('does not advertise courier delivery without a uniquely resolvable current base rate', async () => {
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
                estimatedMinDays: 1,
                estimatedMaxDays: 3,
                estimatedMinMinutes: null,
                estimatedMaxMinutes: null,
                paymentMethod: 'CASH_ON_DELIVERY',
                assignmentMode: 'MANUAL',
                driverCommunication: 'WHATSAPP',
                phoneConfirmationRequired: true,
                manualReviewRequired: false,
              },
            },
          ],
        }),
      },
      deliveryRate: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const service = new GeographyService(prisma);

    await expect(service.deliveryMethods('locality-1', 'fr')).resolves.toEqual({ data: [] });
  });

  it('keeps method discovery advisory when real-cart rate resolution may be ambiguous', async () => {
    const baseRate = {
      type: 'BASE',
      priority: 10,
      feeMillimes: 8_000,
      deliveryZoneId: 'zone-1',
      governorateId: null,
      delegationId: null,
      localityId: null,
      minWeightGrams: null,
      maxWeightGrams: null,
      minOrderMillimes: null,
      maxOrderMillimes: null,
      maxCodMillimes: null,
      express: false,
    };
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
                estimatedMinDays: 1,
                estimatedMaxDays: 3,
                estimatedMinMinutes: null,
                estimatedMaxMinutes: null,
                paymentMethod: 'CASH_ON_DELIVERY',
                assignmentMode: 'MANUAL',
                driverCommunication: 'WHATSAPP',
                phoneConfirmationRequired: true,
                manualReviewRequired: false,
              },
            },
          ],
        }),
      },
      deliveryRate: {
        findMany: vi.fn().mockResolvedValue([
          { ...baseRate, id: 'rate-a' },
          { ...baseRate, id: 'rate-b' },
        ]),
      },
    } as unknown as PrismaService;
    const service = new GeographyService(prisma);

    const result = await service.deliveryMethods('locality-1', 'fr');

    expect(result.data.map(({ id }) => id)).toEqual(['courier:zone-1']);
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
                estimatedMinDays: 1,
                estimatedMaxDays: 3,
                estimatedMinMinutes: 30,
                estimatedMaxMinutes: 50,
                paymentMethod: 'CASH_ON_DELIVERY',
                assignmentMode: 'MANUAL',
                driverCommunication: 'WHATSAPP',
                phoneConfirmationRequired: true,
                manualReviewRequired: true,
              },
            },
          ],
        }),
      },
      deliveryRate: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rate-1',
            type: 'BASE',
            priority: 10,
            feeMillimes: 8_000,
            deliveryZoneId: 'zone-1',
            governorateId: null,
            delegationId: null,
            localityId: null,
            minWeightGrams: 250,
            maxWeightGrams: null,
            minOrderMillimes: 10_000,
            maxOrderMillimes: null,
            maxCodMillimes: null,
            express: false,
          },
        ]),
      },
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
          estimatedMinDays: 1,
          estimatedMaxDays: 3,
          estimatedMinMinutes: 30,
          estimatedMaxMinutes: 50,
          paymentMethod: 'CASH_ON_DELIVERY',
          phoneConfirmationRequired: true,
        },
        {
          id: 'pickup-1',
          type: 'STORE_PICKUP',
          label: 'Retrait centre',
          address: 'Tunis',
          minimumOrderMillimes: 5_000,
          maximumCodMillimes: 500_000,
          estimatedMinDays: null,
          estimatedMaxDays: null,
          estimatedMinMinutes: null,
          estimatedMaxMinutes: null,
          paymentMethod: null,
          phoneConfirmationRequired: false,
        },
      ],
    });
  });
});
