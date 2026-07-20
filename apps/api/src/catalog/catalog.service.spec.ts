import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { AgeGateService } from '../compliance/age-gate.service';
import type { Environment } from '../config/environment';
import type { PrismaService } from '../database/prisma.service';
import { CatalogService } from './catalog.service';

const config = {} as ConfigService<Environment, true>;

describe('CatalogService public filters and facets', () => {
  it('reports technical launch state without exposing or querying legal approval', async () => {
    const storeSettings = vi.fn().mockResolvedValue([
      { key: 'store.name', value: 'PUFFJET' },
      { key: 'maintenance.mode', value: false },
      { key: 'prelaunch.mode', value: false },
      { key: 'checkout.enabled', value: true },
    ]);
    const complianceSettings = vi.fn().mockResolvedValue([
      { key: 'minimum_purchase_age', value: 18 },
      { key: 'age_gate.entry.enabled', value: true },
      { key: 'age_gate.checkout.enabled', value: true },
      { key: 'consent.terms.required', value: true },
      { key: 'consent.privacy.required', value: true },
      { key: 'consent.recording.enabled', value: true },
    ]);
    const prisma = {
      storeSetting: { findMany: storeSettings },
      complianceSetting: { findMany: complianceSettings },
    } as unknown as PrismaService;
    const ageGate = { isConfirmed: vi.fn().mockReturnValue(true) } as unknown as AgeGateService;
    const configuration = {
      get: vi.fn((key: keyof Environment) =>
        key === 'CHECKOUT_ENABLED' ? true : key === 'MAINTENANCE_MODE' ? false : false,
      ),
    } as unknown as ConfigService<Environment, true>;
    const service = new CatalogService(prisma, ageGate, configuration);

    const response = await service.status({} as never);

    expect(response.data).toEqual({
      storeName: 'PUFFJET',
      maintenanceMode: false,
      prelaunchMode: false,
      checkoutEnabled: true,
      minimumAge: 18,
      ageGateEnabled: true,
      checkoutAgeConfirmationRequired: true,
      termsAcceptanceRequired: true,
      privacyAcceptanceRequired: true,
      consentRecordingEnabled: true,
      ageGateRequired: false,
      ageConfirmed: true,
    });
    expect(complianceSettings).toHaveBeenCalledWith({
      where: {
        key: {
          in: [
            'minimum_purchase_age',
            'age_gate.entry.enabled',
            'age_gate.checkout.enabled',
            'consent.terms.required',
            'consent.privacy.required',
            'consent.recording.enabled',
          ],
        },
      },
      select: { key: true, value: true },
    });
  });

  it('does not force prelaunch when the operator disables the entry age gate', async () => {
    const prisma = {
      storeSetting: {
        findMany: vi.fn().mockResolvedValue([
          { key: 'store.name', value: 'PUFFJET' },
          { key: 'maintenance.mode', value: false },
          { key: 'prelaunch.mode', value: false },
          { key: 'checkout.enabled', value: true },
        ]),
      },
      complianceSetting: {
        findMany: vi.fn().mockResolvedValue([
          { key: 'minimum_purchase_age', value: 0 },
          { key: 'age_gate.entry.enabled', value: false },
        ]),
      },
    } as unknown as PrismaService;
    const isConfirmed = vi.fn();
    const ageGate = { isConfirmed } as unknown as AgeGateService;
    const configuration = {
      get: vi.fn((key: keyof Environment) => key === 'CHECKOUT_ENABLED'),
    } as unknown as ConfigService<Environment, true>;

    const response = await new CatalogService(prisma, ageGate, configuration).status({} as never);

    expect(response.data).toMatchObject({
      prelaunchMode: false,
      ageGateEnabled: false,
      ageGateRequired: false,
      ageConfirmed: true,
    });
    expect(isConfirmed).not.toHaveBeenCalled();
  });

  it('defensively rejects an inverted price range when called outside controller validation', async () => {
    const service = new CatalogService({} as PrismaService, {} as AgeGateService, config);

    try {
      await service.products(
        {
          page: 1,
          pageSize: 20,
          sort: 'newest',
          minPriceMillimes: 20_000,
          maxPriceMillimes: 10_000,
        },
        'fr',
      );
      throw new Error('Expected the inverted price range to be rejected.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BadRequestException);
      if (!(error instanceof BadRequestException)) throw error;
      expect(error.getResponse()).toMatchObject({ code: 'INVALID_PRICE_RANGE' });
    }
  });

  it('serializes product type and flavor while applying effective promotional prices', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'product-1',
        nameFr: 'Menthe polaire',
        nameAr: 'نعناع',
        slug: 'menthe-polaire',
        sku: 'MENTHE-1',
        shortDescriptionFr: 'Frais',
        shortDescriptionAr: 'منعش',
        descriptionFr: null,
        descriptionAr: null,
        containsNicotine: true,
        productType: 'E_LIQUID',
        flavor: 'Menthe',
        basePriceMillimes: 20_000,
        promotionalPriceMillimes: 15_000,
        warningFr: 'Réservé aux adultes',
        warningAr: 'للبالغين فقط',
        minimumAge: 18,
        featured: false,
        brand: { name: 'Nexa', slug: 'nexa' },
        images: [
          {
            id: 'image-1',
            objectKeyHash: 'a'.repeat(64),
            altTextFr: 'Flacon menthe',
            altTextAr: 'عبوة نعناع',
            width: 800,
            height: 800,
          },
        ],
        variants: [],
        attributes: [],
      },
    ]);
    const count = vi.fn().mockResolvedValue(1);
    const transaction = vi.fn(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    );
    const prisma = {
      product: {
        fields: { basePriceMillimes: { name: 'basePriceMillimes' } },
        findMany,
        count,
      },
      productVariant: { fields: { priceMillimes: { name: 'priceMillimes' } } },
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new CatalogService(prisma, {} as AgeGateService, config);

    const response = await service.products(
      {
        page: 1,
        pageSize: 20,
        sort: 'newest',
        productType: 'E_LIQUID',
        flavor: 'Menthe',
        minPriceMillimes: 10_000,
        maxPriceMillimes: 16_000,
      },
      'fr',
    );

    expect(response.data.items[0]).toMatchObject({
      brandName: 'Nexa',
      brandSlug: 'nexa',
      productType: 'E_LIQUID',
      flavor: 'Menthe',
      priceMillimes: 20_000,
      promotionalPriceMillimes: 15_000,
      primaryImage: {
        id: 'image-1',
        url: `/api/v1/media/${'a'.repeat(64)}`,
        altText: 'Flacon menthe',
        width: 800,
        height: 800,
      },
    });
    expect(response.data).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    const request = findMany.mock.calls[0]?.[0] as
      | {
          select?: {
            images?: { where?: unknown; orderBy?: unknown; take?: number };
          };
        }
      | undefined;
    expect(request?.select?.images).toMatchObject({
      where: { deletedAt: null, moderationStatus: 'APPROVED' },
      take: 20,
    });
    expect(request?.select?.images?.orderBy).toEqual([
      { isPrimary: 'desc' },
      { sortOrder: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('returns only bounded public facet values and integer-millime price bounds', async () => {
    const findBrands = vi
      .fn<(args: unknown) => Promise<Array<{ id: string; name: string; slug: string }>>>()
      .mockResolvedValue([{ id: 'brand-1', name: 'Nexa', slug: 'nexa' }]);
    const groupBy = vi
      .fn()
      .mockResolvedValueOnce([{ productType: 'E_LIQUID' }, { productType: 'POD' }])
      .mockResolvedValueOnce([
        { flavor: 'Menthe', _count: { _all: 3 } },
        { flavor: 'Vanille', _count: { _all: 2 } },
      ]);
    const prisma = {
      brand: { findMany: findBrands },
      product: { groupBy },
      $queryRaw: vi.fn().mockResolvedValue([{ minimumMillimes: 9_900, maximumMillimes: 42_000 }]),
    } as unknown as PrismaService;
    const service = new CatalogService(prisma, {} as AgeGateService, config);

    await expect(service.facets()).resolves.toEqual({
      data: {
        brands: [{ id: 'brand-1', name: 'Nexa', slug: 'nexa' }],
        productTypes: ['E_LIQUID', 'POD'],
        flavors: [
          { value: 'Menthe', productCount: 3 },
          { value: 'Vanille', productCount: 2 },
        ],
        priceRange: { minimumMillimes: 9_900, maximumMillimes: 42_000 },
        truncated: { brands: false, flavors: false },
      },
    });
    const request = findBrands.mock.calls[0]?.[0] as
      { take?: number; where?: { products?: unknown } } | undefined;
    expect(request?.take).toBe(51);
    expect(request?.where?.products).toBeDefined();
  });
});
