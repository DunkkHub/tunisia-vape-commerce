import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { AdminReadService } from './admin-read.service';

const transaction = vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations));

describe('AdminReadService inventory', () => {
  it('subtracts only selected active reservations and returns full-filter brand/flavor totals', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'variant-1',
        sku: 'SKU-1',
        nameFr: 'Format 30 ml',
        nameAr: '30 مل',
        lowStockThreshold: 4,
        publicationStatus: 'PUBLISHED',
        updatedAt: new Date('2026-07-12T12:00:00.000Z'),
        flavor: null,
        product: {
          id: 'product-1',
          nameFr: 'Menthe fraîche',
          nameAr: 'نعناع',
          productType: 'E_LIQUID',
          flavor: 'Menthe',
          publicationStatus: 'PUBLISHED',
          brand: { id: 'brand-1', name: 'Marque A', slug: 'marque-a' },
        },
        inventoryItems: [{ onHandQuantity: 10, reservations: [{ quantity: 2 }, { quantity: 1 }] }],
      },
    ]);
    const count = vi.fn().mockResolvedValue(12);
    const queryRaw = vi.fn().mockResolvedValue([
      {
        brandId: 'brand-1',
        brandName: 'Marque A',
        productType: 'E_LIQUID',
        flavor: 'Menthe',
        onHandQuantity: 25n,
        reservedQuantity: 5n,
      },
      {
        brandId: 'brand-1',
        brandName: 'Marque A',
        productType: 'DISPOSABLE',
        flavor: 'Fraise',
        onHandQuantity: 8n,
        reservedQuantity: 1n,
      },
      {
        brandId: 'brand-2',
        brandName: 'Marque B',
        productType: 'E_LIQUID',
        flavor: 'Menthe',
        onHandQuantity: 4n,
        reservedQuantity: 0n,
      },
    ]);
    const prisma = {
      productVariant: { findMany, count },
      $queryRaw: queryRaw,
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new AdminReadService(prisma);

    const result = await service.inventory(
      { page: 1, limit: 1, brand: 'marque-a', productType: 'E_LIQUID' },
      'fr',
    );

    expect(result.data.items[0]).toMatchObject({
      id: 'variant-1',
      brandName: 'Marque A',
      productType: 'E_LIQUID',
      flavor: 'Menthe',
      onHandQuantity: 10,
      reservedQuantity: 3,
      remainingQuantity: 7,
      availableQuantity: 7,
      status: 'IN_STOCK',
    });
    expect(result.data.total).toBe(12);
    expect(result.data.grouping.scope).toBe('FILTERED_RESULT');
    expect(result.data.grouping.byBrand).toContainEqual({
      brandId: 'brand-1',
      brandName: 'Marque A',
      onHandQuantity: 33,
      reservedQuantity: 6,
      remainingQuantity: 27,
    });
    expect(result.data.grouping.byProductType).toContainEqual({
      productType: 'E_LIQUID',
      onHandQuantity: 29,
      reservedQuantity: 5,
      remainingQuantity: 24,
    });
    expect(result.data.grouping.byFlavor).toContainEqual({
      flavor: 'Menthe',
      onHandQuantity: 29,
      reservedQuantity: 5,
      remainingQuantity: 24,
    });

    const findManyCalls = findMany.mock.calls as unknown as Array<
      [
        {
          select: {
            flavor: { select: { canonicalName: true } };
            inventoryItems: {
              where: { OR: unknown[] };
              select: { reservations: { where: unknown } };
            };
          };
        },
      ]
    >;
    const select = findManyCalls[0]?.[0].select as {
      flavor: { select: { canonicalName: boolean } };
      inventoryItems: { where: { OR: unknown[] }; select: { reservations: { where: unknown } } };
    };
    expect(select.flavor).toEqual({ select: { canonicalName: true } });
    expect(select.inventoryItems.where.OR[0]).toEqual({ batchId: null });
    const eligibleBatch = select.inventoryItems.where.OR[1] as {
      batch: { is: { archivedAt: null; OR: unknown[] } };
    };
    expect(eligibleBatch.batch.is.archivedAt).toBeNull();
    expect(eligibleBatch.batch.is.OR).toHaveLength(2);
    const reservationWhere = select.inventoryItems.select.reservations.where as {
      state: string;
      expiresAt: { gt: Date };
    };
    expect(reservationWhere.state).toBe('ACTIVE');
    expect(reservationWhere.expiresAt.gt).toBeInstanceOf(Date);
    const queryRawCalls = queryRaw.mock.calls as unknown as Array<[Prisma.Sql]>;
    const sql = queryRawCalls[0]?.[0] as Prisma.Sql;
    expect(sql.sql).toContain("reservation.state = 'ACTIVE'");
    expect(sql.sql).toContain('batch.expiryDate');
    expect(sql.values).toContain('marque-a');
    expect(sql.values).toContain('E_LIQUID');
  });

  it('uses an imported variant flavor relation for filtering, search, rows, and grouped stock', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'variant-imported-1',
        sku: 'WOTOFO-ICE-1',
        nameFr: 'Framboise bleue glacée',
        nameAr: 'توت أزرق مثلج',
        lowStockThreshold: 2,
        publicationStatus: 'DRAFT',
        updatedAt: new Date('2026-07-20T12:00:00.000Z'),
        flavor: { canonicalName: 'Blue Razz Ice' },
        product: {
          id: 'product-imported-1',
          nameFr: 'Wotofo NexPOD',
          nameAr: 'ووتوفو نكسبود',
          productType: 'POD',
          flavor: null,
          publicationStatus: 'DRAFT',
          brand: { id: 'brand-wotofo', name: 'Wotofo', slug: 'wotofo' },
        },
        inventoryItems: [{ onHandQuantity: 9, reservations: [{ quantity: 2 }] }],
      },
    ]);
    const count = vi.fn().mockResolvedValue(1);
    const queryRaw = vi.fn().mockResolvedValue([
      {
        brandId: 'brand-wotofo',
        brandName: 'Wotofo',
        productType: 'POD',
        flavor: 'Blue Razz Ice',
        onHandQuantity: 9n,
        reservedQuantity: 2n,
      },
    ]);
    const prisma = {
      productVariant: { findMany, count },
      $queryRaw: queryRaw,
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new AdminReadService(prisma);

    const result = await service.inventory(
      {
        page: 1,
        limit: 20,
        q: 'Framboise',
        brand: 'wotofo',
        productType: 'POD',
        flavor: 'blue-razz-ice',
      },
      'fr',
    );

    expect(result.data.items[0]).toMatchObject({
      id: 'variant-imported-1',
      flavor: 'Blue Razz Ice',
      onHandQuantity: 9,
      reservedQuantity: 2,
      remainingQuantity: 7,
    });
    expect(result.data.grouping.byFlavor).toEqual([
      {
        flavor: 'Blue Razz Ice',
        onHandQuantity: 9,
        reservedQuantity: 2,
        remainingQuantity: 7,
      },
    ]);

    const findManyCalls = findMany.mock.calls as unknown as Array<
      [
        {
          where: {
            AND: Array<{ OR: Array<Record<string, unknown>> }>;
          };
        },
      ]
    >;
    const filters = findManyCalls[0]?.[0].where.AND ?? [];
    expect(filters[0]).toEqual({
      OR: [
        {
          flavor: {
            is: {
              OR: [
                { canonicalName: { equals: 'blue-razz-ice' } },
                { slug: { equals: 'blue-razz-ice' } },
                { nameFr: { equals: 'blue-razz-ice' } },
                { nameAr: { equals: 'blue-razz-ice' } },
              ],
            },
          },
        },
        {
          AND: [{ flavorId: null }, { product: { is: { flavor: { equals: 'blue-razz-ice' } } } }],
        },
      ],
    });
    expect(filters[1]?.OR).toContainEqual({
      flavor: {
        is: {
          OR: [
            { canonicalName: { contains: 'Framboise' } },
            { slug: { contains: 'Framboise' } },
            { nameFr: { contains: 'Framboise' } },
            { nameAr: { contains: 'Framboise' } },
          ],
        },
      },
    });
    expect(filters[1]?.OR).toContainEqual({
      AND: [{ flavorId: null }, { product: { is: { flavor: { contains: 'Framboise' } } } }],
    });

    const queryRawCalls = queryRaw.mock.calls as unknown as Array<[Prisma.Sql]>;
    const sql = queryRawCalls[0]?.[0] as Prisma.Sql;
    expect(sql.sql).toContain('LEFT JOIN Flavor AS flavorRecord');
    expect(sql.sql).toContain('flavorRecord.canonicalName');
    expect(sql.sql).toContain('variant.flavorId IS NULL AND p.flavor');
    expect(sql.values).toContain('blue-razz-ice');
    expect(sql.values).toContain('Framboise');
  });

  it('exports relational flavors first and retains product flavor for legacy variants', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'variant-imported-1',
        sku: 'WOTOFO-ICE-1',
        nameFr: 'Framboise bleue glacée',
        nameAr: 'توت أزرق مثلج',
        lowStockThreshold: 2,
        publicationStatus: 'DRAFT',
        updatedAt: new Date('2026-07-20T12:00:00.000Z'),
        flavor: { canonicalName: 'Blue Razz Ice' },
        product: {
          id: 'product-imported-1',
          nameFr: 'Wotofo NexPOD',
          nameAr: 'ووتوفو نكسبود',
          productType: 'POD',
          flavor: 'Legacy value must not win',
          publicationStatus: 'DRAFT',
          brand: { id: 'brand-wotofo', name: 'Wotofo', slug: 'wotofo' },
        },
        inventoryItems: [{ onHandQuantity: 9, reservations: [{ quantity: 2 }] }],
      },
      {
        id: 'variant-legacy-1',
        sku: 'LEGACY-MINT-1',
        nameFr: 'Menthe classique',
        nameAr: 'نعناع كلاسيكي',
        lowStockThreshold: 1,
        publicationStatus: 'PUBLISHED',
        updatedAt: new Date('2026-07-19T12:00:00.000Z'),
        flavor: null,
        product: {
          id: 'product-legacy-1',
          nameFr: 'Produit historique',
          nameAr: 'منتج قديم',
          productType: 'E_LIQUID',
          flavor: 'Classic Mint',
          publicationStatus: 'PUBLISHED',
          brand: null,
        },
        inventoryItems: [{ onHandQuantity: 3, reservations: [] }],
      },
    ]);
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-export-1' });
    const interactiveTransaction = vi.fn(
      async (
        callback: (transactionClient: {
          productVariant: { findMany: typeof findMany };
          auditLog: { create: typeof auditCreate };
        }) => Promise<unknown>,
      ) => callback({ productVariant: { findMany }, auditLog: { create: auditCreate } }),
    );
    const prisma = {
      $transaction: interactiveTransaction,
    } as unknown as PrismaService;
    const service = new AdminReadService(prisma);
    const request = {
      auth: { userId: 'admin-1' },
      requestId: 'request-relational-export',
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      get: vi.fn().mockReturnValue('vitest'),
    } as unknown as Request;

    const result = await service.exportInventory({ page: 1, limit: 20 }, 'fr', request);

    expect(result.rowCount).toBe(2);
    expect(result.csv).toContain(',Blue Razz Ice,');
    expect(result.csv).toContain(',Classic Mint,');
    expect(result.csv).not.toContain('Legacy value must not win');
    const auditCalls = auditCreate.mock.calls as unknown as Array<
      [{ data: { action: string; afterSummary: { rowCount: number } } }]
    >;
    expect(auditCalls[0]?.[0].data.action).toBe('inventory.csv_exported');
    expect(auditCalls[0]?.[0].data.afterSummary.rowCount).toBe(2);
  });
});

describe('AdminReadService safe operational reads', () => {
  it('merges store and compliance settings while redacting declared and defensive secrets', async () => {
    const storeSetting = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'store-safe',
          key: 'store.currency',
          valueType: 'STRING',
          value: 'TND',
          secret: false,
          description: null,
          version: 1,
          updatedAt: new Date('2026-07-12T10:00:00.000Z'),
        },
        {
          id: 'store-misflagged',
          key: 'smtp.api_key',
          valueType: 'STRING',
          value: 'must-not-leak',
          secret: false,
          description: null,
          version: 1,
          updatedAt: new Date('2026-07-12T10:00:00.000Z'),
        },
        {
          id: 'store-secret',
          key: 'provider.config',
          valueType: 'JSON',
          value: { password: 'must-not-leak' },
          secret: true,
          description: null,
          version: 1,
          updatedAt: new Date('2026-07-12T10:00:00.000Z'),
        },
      ]),
    };
    const complianceSetting = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'compliance-age',
          key: 'minimum_purchase_age',
          valueType: 'INTEGER',
          value: 18,
          description: null,
          legallyReviewed: false,
          reviewedAt: null,
          version: 2,
          updatedAt: new Date('2026-07-12T11:00:00.000Z'),
        },
      ]),
    };
    const prisma = {
      storeSetting,
      complianceSetting,
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new AdminReadService(prisma);

    const result = await service.settings({ page: 1, limit: 20 });

    expect(result.data.items).toContainEqual(
      expect.objectContaining({
        id: 'store:store-safe',
        scope: 'STORE',
        key: 'store.currency',
        value: 'TND',
        redacted: false,
      }),
    );
    expect(result.data.items).toContainEqual(
      expect.objectContaining({
        id: 'compliance:compliance-age',
        scope: 'COMPLIANCE',
        key: 'minimum_purchase_age',
        value: 18,
      }),
    );
    expect(result.data.items.find((item) => item.key === 'smtp.api_key')).toMatchObject({
      value: null,
      redacted: true,
    });
    expect(result.data.items.find((item) => item.key === 'provider.config')).toMatchObject({
      value: null,
      redacted: true,
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('returns a bounded audit allowlist without IP, user-agent, email, or summary payloads', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'audit-1',
        actorType: 'ADMIN',
        action: 'catalog.product.update',
        resourceType: 'Product',
        resourceId: 'product-1',
        outcome: 'SUCCESS',
        requestId: 'request-1',
        errorCode: null,
        occurredAt: new Date('2026-07-12T09:00:00.000Z'),
        actor: { adminProfile: { displayName: 'Operator' } },
        ipAddress: '127.0.0.1',
        userAgent: 'secret browser fingerprint',
        beforeSummary: { customerEmail: 'private@example.test' },
      },
    ]);
    const prisma = {
      auditLog: { findMany, count: vi.fn().mockResolvedValue(1) },
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new AdminReadService(prisma);

    const result = await service.audit({ page: 1, limit: 20 });

    expect(result.data.items[0]).toEqual({
      id: 'audit-1',
      actorName: 'Operator',
      actorType: 'ADMIN',
      action: 'catalog.product.update',
      resourceType: 'Product',
      resourceId: 'product-1',
      outcome: 'SUCCESS',
      requestId: 'request-1',
      errorCode: null,
      occurredAt: '2026-07-12T09:00:00.000Z',
      createdAt: '2026-07-12T09:00:00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('private@example.test');
    const auditCalls = findMany.mock.calls as unknown as Array<
      [{ skip: number; take: number; select: Record<string, unknown> }]
    >;
    expect(auditCalls[0]?.[0].skip).toBe(0);
    expect(auditCalls[0]?.[0].take).toBe(20);
    expect(auditCalls[0]?.[0].select).not.toHaveProperty('ipAddress');
    expect(auditCalls[0]?.[0].select).not.toHaveProperty('userAgent');
    expect(auditCalls[0]?.[0].select).not.toHaveProperty('beforeSummary');
  });

  it('uses durable delivery and cash records and returns explicit dashboard metadata', async () => {
    const orderCount = vi.fn().mockResolvedValue(9);
    const deliveryCount = vi.fn().mockResolvedValue(6);
    const cashCollectionAggregate = vi.fn().mockResolvedValue({
      _sum: { expectedMillimes: 123_000 },
    });
    const cashRemittanceAggregate = vi.fn().mockResolvedValue({
      _sum: { verifiedMillimes: 91_000 },
    });
    const deliveryAttemptCount = vi.fn().mockResolvedValue(2);
    const queryRaw = vi.fn().mockResolvedValue([{ value: 3n }]);
    const prisma = {
      order: { count: orderCount },
      delivery: { count: deliveryCount },
      cashCollection: { aggregate: cashCollectionAggregate },
      cashRemittance: { aggregate: cashRemittanceAggregate },
      deliveryAttempt: { count: deliveryAttemptCount },
      $queryRaw: queryRaw,
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new AdminReadService(prisma);

    const result = await service.dashboard({ days: 30 });

    expect(result.data).toMatchObject({
      currency: 'TND',
      ordersCreated: 9,
      ordersDelivered: 6,
      codExpectedMillimes: 123_000,
      codRemittedMillimes: 91_000,
      lowStockCount: 3,
      deliveryFailureCount: 2,
      period: { kind: 'ROLLING', days: 30, timezone: 'Africa/Tunis' },
    });
    expect(
      new Date(result.data.period.endExclusive).getTime() -
        new Date(result.data.period.startInclusive).getTime(),
    ).toBe(30 * 86_400_000);
    const deliveryCalls = deliveryCount.mock.calls as unknown as Array<
      [{ where: { deliveredAt: { gte: Date; lt: Date } } }]
    >;
    expect(deliveryCalls[0]?.[0].where.deliveredAt.gte).toBeInstanceOf(Date);
    expect(deliveryCalls[0]?.[0].where.deliveredAt.lt).toBeInstanceOf(Date);
    const collectionCalls = cashCollectionAggregate.mock.calls as unknown as Array<
      [{ where: { status: { not: string } } }]
    >;
    expect(collectionCalls[0]?.[0].where.status.not).toBe('VOIDED');
    const remittanceCalls = cashRemittanceAggregate.mock.calls as unknown as Array<
      [{ where: { status: string; verifiedAt: { gte: Date; lt: Date } } }]
    >;
    expect(remittanceCalls[0]?.[0].where.status).toBe('VERIFIED');
    expect(remittanceCalls[0]?.[0].where.verifiedAt.gte).toBeInstanceOf(Date);
    expect(result.data.definitions.codExpectedMillimes).toContain('not revenue');
  });
});
