import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AddressType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { CustomerAddressesService } from './customer-addresses.service';

const addressRecord = {
  id: 'address-1',
  type: AddressType.HOME,
  label: null,
  fullName: 'Customer Name',
  phoneE164: '+21620111222',
  governorateId: 'governorate-1',
  delegationId: 'delegation-1',
  localityId: 'locality-1',
  postalCode: '1000',
  street: '1 Example Street',
  building: null,
  floor: null,
  apartment: null,
  landmark: null,
  deliveryInstructions: null,
  isDefault: true,
  version: 1,
  createdAt: new Date('2026-07-20T10:00:00Z'),
  updatedAt: new Date('2026-07-20T10:00:00Z'),
  governorate: { nameFr: 'Tunis', nameAr: 'تونس' },
  delegation: { nameFr: 'Tunis', nameAr: 'تونس' },
  locality: { nameFr: 'Centre', nameAr: 'المركز' },
};

describe('customer saved-address service', () => {
  it('scopes reads to the active customer and localizes geography', async () => {
    const findMany = vi.fn().mockResolvedValue([addressRecord]);
    const prisma = {
      customerProfile: { findFirst: vi.fn().mockResolvedValue({ id: 'customer-1' }) },
      address: { findMany },
    } as unknown as PrismaService;
    const service = new CustomerAddressesService(prisma);

    const result = await service.list('user-1', 'ar');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId: 'customer-1', deletedAt: null },
        take: 20,
      }),
    );
    expect(result.data[0]).toMatchObject({
      id: 'address-1',
      label: 'HOME',
      phone: '+21620111222',
      governorate: 'تونس',
      delegation: 'تونس',
      locality: 'المركز',
    });
  });

  it('does not reveal or update an address owned by another customer', async () => {
    const updateMany = vi.fn();
    const transaction = {
      customerProfile: { findFirst: vi.fn().mockResolvedValue({ id: 'customer-1' }) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'customer-1' }]),
      address: { findFirst: vi.fn().mockResolvedValue(null), updateMany },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new CustomerAddressesService(prisma);

    const error = await service
      .update(
        'user-1',
        'address-owned-by-user-2',
        { expectedVersion: 1, street: '2 Updated Street' },
        'fr',
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({
      code: 'ADDRESS_NOT_FOUND',
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('validates the governorate, delegation, locality and postal-code relationship before create', async () => {
    const create = vi.fn();
    const transaction = {
      customerProfile: { findFirst: vi.fn().mockResolvedValue({ id: 'customer-1' }) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'customer-1' }]),
      address: { count: vi.fn().mockResolvedValue(0), create, updateMany: vi.fn() },
      delegation: { findFirst: vi.fn().mockResolvedValue({ id: 'delegation-1' }) },
      locality: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new CustomerAddressesService(prisma);

    const error = await service
      .create(
        'user-1',
        {
          fullName: 'Customer Name',
          phone: '+21620111222',
          governorateId: 'governorate-1',
          delegationId: 'delegation-1',
          localityId: 'locality-1',
          postalCode: '9999',
          street: '1 Example Street',
        },
        'fr',
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'ADDRESS_GEOGRAPHY_INVALID',
    });
    expect(transaction.locality.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'locality-1',
          delegationId: 'delegation-1',
          postalCodes: { some: { code: '9999', active: true } },
        }) as unknown,
      }),
    );
    expect(create).not.toHaveBeenCalled();
  });
});
