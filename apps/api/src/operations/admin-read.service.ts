import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type ProductType } from '@prisma/client';
import type { Request } from 'express';
import { serializeCsv } from '../common/export/csv';
import { PrismaService } from '../database/prisma.service';
import type {
  AdminAuditQueryDto,
  AdminDashboardQueryDto,
  AdminInventoryQueryDto,
  BoundedAdminListQueryDto,
} from './dto/admin-read-query.dto';

const INVENTORY_GROUP_LIMIT = 5_000;
const INVENTORY_EXPORT_LIMIT = 500;
const SETTINGS_SCOPE_LIMIT = 500;
const REPORTING_TIMEZONE = 'Africa/Tunis';
const CURRENCY = 'TND' as const;
const SENSITIVE_SETTING_KEY =
  /(^|[._-])(secret|password|token|credential|api[._-]?key|private[._-]?key|encryption|database|redis|smtp|webhook)([._-]|$)/i;

const inventoryVariantSelect = (asOf: Date) =>
  ({
    id: true,
    sku: true,
    nameFr: true,
    nameAr: true,
    lowStockThreshold: true,
    publicationStatus: true,
    updatedAt: true,
    flavor: {
      select: {
        canonicalName: true,
      },
    },
    product: {
      select: {
        id: true,
        nameFr: true,
        nameAr: true,
        productType: true,
        flavor: true,
        publicationStatus: true,
        brand: { select: { id: true, name: true, slug: true } },
      },
    },
    inventoryItems: {
      where: {
        OR: [
          { batchId: null },
          {
            batch: {
              is: {
                archivedAt: null,
                OR: [{ expiryDate: null }, { expiryDate: { gt: asOf } }],
              },
            },
          },
        ],
      },
      select: {
        onHandQuantity: true,
        reservations: {
          where: { state: 'ACTIVE', expiresAt: { gt: asOf } },
          select: { quantity: true },
        },
      },
    },
  }) satisfies Prisma.ProductVariantSelect;

type InventoryVariantRecord = Prisma.ProductVariantGetPayload<{
  select: ReturnType<typeof inventoryVariantSelect>;
}>;

const inventoryFlavor = (variant: InventoryVariantRecord): string | null =>
  variant.flavor
    ? variant.flavor.canonicalName.trim() || null
    : variant.product.flavor?.trim() || null;

interface InventoryAggregateRow {
  brandId: string | null;
  brandName: string | null;
  productType: ProductType;
  flavor: string | null;
  onHandQuantity: unknown;
  reservedQuantity: unknown;
}

interface CountRow {
  value: unknown;
}

interface StockTotals {
  onHandQuantity: number;
  reservedQuantity: number;
  remainingQuantity: number;
}

export interface BrandTotals extends StockTotals {
  brandId: string | null;
  brandName: string | null;
}

export interface ProductTypeTotals extends StockTotals {
  productType: ProductType;
}

export interface FlavorTotals extends StockTotals {
  flavor: string | null;
}

export interface BrandFlavorTotals extends BrandTotals {
  flavor: string | null;
}

const normalizeQuery = (value: string | undefined): string | undefined => {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
};

const toSafeInteger = (value: unknown): number => {
  const converted = Number(value ?? 0);
  if (!Number.isSafeInteger(converted)) {
    throw new ServiceUnavailableException({
      code: 'OPERATIONAL_TOTAL_OUT_OF_RANGE',
      message: 'An operational total cannot be represented safely.',
    });
  }
  return converted;
};

const stockProjection = (variant: InventoryVariantRecord): StockTotals => {
  let onHandQuantity = 0;
  let reservedQuantity = 0;
  for (const item of variant.inventoryItems) {
    onHandQuantity += item.onHandQuantity;
    reservedQuantity += item.reservations.reduce(
      (total, reservation) => total + reservation.quantity,
      0,
    );
  }
  return {
    onHandQuantity,
    reservedQuantity,
    remainingQuantity: onHandQuantity - reservedQuantity,
  };
};

const stockStatus = (remaining: number, threshold: number) => {
  if (remaining < 0) return 'INVARIANT_BREACH' as const;
  if (remaining === 0) return 'OUT_OF_STOCK' as const;
  if (remaining <= threshold) return 'LOW_STOCK' as const;
  return 'IN_STOCK' as const;
};

const addTotals = <T extends StockTotals>(
  groups: Map<string, T>,
  key: string,
  create: () => T,
  onHandQuantity: number,
  reservedQuantity: number,
): void => {
  const group = groups.get(key) ?? create();
  group.onHandQuantity += onHandQuantity;
  group.reservedQuantity += reservedQuantity;
  group.remainingQuantity += onHandQuantity - reservedQuantity;
  groups.set(key, group);
};

@Injectable()
export class AdminReadService {
  constructor(private readonly prisma: PrismaService) {}

  async inventory(query: AdminInventoryQueryDto, locale: 'fr' | 'ar') {
    const asOf = new Date();
    const where = this.inventoryWhere(query);
    const [records, total, aggregateRows] = await this.prisma.$transaction([
      this.prisma.productVariant.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: inventoryVariantSelect(asOf),
      }),
      this.prisma.productVariant.count({ where }),
      this.prisma.$queryRaw<InventoryAggregateRow[]>(this.inventoryGroupSql(query, asOf)),
    ]);

    if (aggregateRows.length > INVENTORY_GROUP_LIMIT) {
      throw new ServiceUnavailableException({
        code: 'INVENTORY_GROUPING_TOO_LARGE',
        message: 'Narrow the inventory filters before requesting grouped totals.',
      });
    }

    return {
      data: {
        items: records.map((variant) => {
          const stock = stockProjection(variant);
          const productName = locale === 'ar' ? variant.product.nameAr : variant.product.nameFr;
          const variantName = locale === 'ar' ? variant.nameAr : variant.nameFr;
          return {
            id: variant.id,
            productId: variant.product.id,
            sku: variant.sku,
            name: `${productName} / ${variantName}`,
            productName,
            variantName,
            brand: variant.product.brand,
            brandName: variant.product.brand?.name ?? null,
            productType: variant.product.productType,
            flavor: inventoryFlavor(variant),
            ...stock,
            availableQuantity: stock.remainingQuantity,
            lowStockThreshold: variant.lowStockThreshold,
            status: stockStatus(stock.remainingQuantity, variant.lowStockThreshold),
            publicationStatus: variant.publicationStatus,
            productPublicationStatus: variant.product.publicationStatus,
            updatedAt: variant.updatedAt.toISOString(),
          };
        }),
        page: query.page,
        pageSize: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
        asOf: asOf.toISOString(),
        availabilityDefinition:
          'Remaining quantity equals eligible physical on-hand minus ACTIVE reservations whose expiry is after asOf. Archived and expired batches are excluded.',
        grouping: this.inventoryGroups(aggregateRows),
      },
    };
  }

  async exportInventory(query: AdminInventoryQueryDto, locale: 'fr' | 'ar', request: Request) {
    const asOf = new Date();
    const records = await this.prisma.$transaction(async (transaction) => {
      const found = await transaction.productVariant.findMany({
        where: this.inventoryWhere(query),
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: INVENTORY_EXPORT_LIMIT + 1,
        select: inventoryVariantSelect(asOf),
      });
      if (found.length > INVENTORY_EXPORT_LIMIT) {
        throw new ServiceUnavailableException({
          code: 'INVENTORY_EXPORT_TOO_LARGE',
          message: 'Narrow the inventory filters before exporting more than 500 variants.',
        });
      }
      await transaction.auditLog.create({
        data: {
          actorUserId: request.auth!.userId,
          actorType: 'ADMIN',
          action: 'inventory.csv_exported',
          resourceType: 'InventoryExport',
          resourceId: request.requestId.slice(0, 80),
          outcome: 'SUCCESS',
          requestId: request.requestId,
          ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
          userAgent: request.get('user-agent')?.slice(0, 512) ?? null,
          beforeSummary: Prisma.JsonNull,
          afterSummary: {
            schemaVersion: 'INVENTORY_V1',
            rowCount: found.length,
            filters: {
              q: normalizeQuery(query.q) ?? null,
              brand: normalizeQuery(query.brand) ?? null,
              productType: query.productType ?? null,
              flavor: normalizeQuery(query.flavor) ?? null,
            },
          },
        },
      });
      return found;
    });
    const csv = serializeCsv(
      [
        'schemaVersion',
        'variantId',
        'sku',
        'productNameFr',
        'productNameAr',
        'variantNameFr',
        'variantNameAr',
        'brand',
        'productType',
        'flavor',
        'onHandQuantity',
        'reservedQuantity',
        'availableQuantity',
        'lowStockThreshold',
        'stockStatus',
        'variantPublicationStatus',
        'productPublicationStatus',
        'updatedAt',
        'asOf',
      ],
      records.map((variant) => {
        const stock = stockProjection(variant);
        return [
          'INVENTORY_V1',
          variant.id,
          variant.sku,
          variant.product.nameFr,
          variant.product.nameAr,
          variant.nameFr,
          variant.nameAr,
          variant.product.brand?.name,
          variant.product.productType,
          inventoryFlavor(variant),
          stock.onHandQuantity,
          stock.reservedQuantity,
          stock.remainingQuantity,
          variant.lowStockThreshold,
          stockStatus(stock.remainingQuantity, variant.lowStockThreshold),
          variant.publicationStatus,
          variant.product.publicationStatus,
          variant.updatedAt.toISOString(),
          asOf.toISOString(),
        ];
      }),
    );
    return {
      csv,
      filename: `inventory-${locale}-${asOf.toISOString().slice(0, 10)}.csv`,
      rowCount: records.length,
    };
  }

  async settings(query: BoundedAdminListQueryDto) {
    const search = normalizeQuery(query.q);
    const where = search
      ? {
          OR: [{ key: { contains: search } }, { description: { contains: search } }],
        }
      : {};
    const complianceWhere = {
      AND: [where, { key: { not: 'legal_review.completed' } }],
    };
    const [storeSettings, complianceSettings] = await this.prisma.$transaction([
      this.prisma.storeSetting.findMany({
        where,
        orderBy: [{ key: 'asc' }, { id: 'asc' }],
        take: SETTINGS_SCOPE_LIMIT + 1,
        select: {
          id: true,
          key: true,
          valueType: true,
          value: true,
          secret: true,
          description: true,
          version: true,
          updatedAt: true,
        },
      }),
      this.prisma.complianceSetting.findMany({
        where: complianceWhere,
        orderBy: [{ key: 'asc' }, { id: 'asc' }],
        take: SETTINGS_SCOPE_LIMIT + 1,
        select: {
          id: true,
          key: true,
          valueType: true,
          value: true,
          description: true,
          legallyReviewed: true,
          reviewedAt: true,
          version: true,
          updatedAt: true,
        },
      }),
    ]);

    if (
      storeSettings.length > SETTINGS_SCOPE_LIMIT ||
      complianceSettings.length > SETTINGS_SCOPE_LIMIT
    ) {
      throw new ServiceUnavailableException({
        code: 'SETTINGS_RESULT_TOO_LARGE',
        message: 'Narrow the settings search before requesting this list.',
      });
    }

    const records = [
      ...storeSettings.map((setting) => ({
        id: `store:${setting.id}`,
        sourceId: setting.id,
        scope: 'STORE' as const,
        key: setting.key,
        valueType: setting.valueType,
        value: setting.value,
        redacted: setting.secret || SENSITIVE_SETTING_KEY.test(setting.key),
        description: setting.description,
        legallyReviewed: null,
        reviewedAt: null,
        version: setting.version,
        updatedAt: setting.updatedAt,
      })),
      ...complianceSettings.map((setting) => ({
        id: `compliance:${setting.id}`,
        sourceId: setting.id,
        scope: 'COMPLIANCE' as const,
        key: setting.key,
        valueType: setting.valueType,
        value: setting.value,
        redacted: SENSITIVE_SETTING_KEY.test(setting.key),
        description: setting.description,
        legallyReviewed: setting.legallyReviewed,
        reviewedAt: setting.reviewedAt,
        version: setting.version,
        updatedAt: setting.updatedAt,
      })),
    ].sort((left, right) => {
      const keyOrder = left.key.localeCompare(right.key);
      return (
        keyOrder ||
        left.scope.localeCompare(right.scope) ||
        left.sourceId.localeCompare(right.sourceId)
      );
    });
    const total = records.length;
    const pageStart = (query.page - 1) * query.limit;

    return {
      data: {
        items: records.slice(pageStart, pageStart + query.limit).map((setting) => ({
          id: setting.id,
          sourceId: setting.sourceId,
          scope: setting.scope,
          key: setting.key,
          valueType: setting.valueType,
          value: setting.redacted ? null : setting.value,
          redacted: setting.redacted,
          description: setting.description,
          legallyReviewed: setting.legallyReviewed,
          reviewedAt: setting.reviewedAt?.toISOString() ?? null,
          version: setting.version,
          updatedAt: setting.updatedAt.toISOString(),
        })),
        page: query.page,
        pageSize: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async audit(query: AdminAuditQueryDto) {
    const search = normalizeQuery(query.q);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.actorType ? { actorType: query.actorType } : {}),
      ...(search
        ? {
            OR: [
              { action: { contains: search } },
              { resourceType: { contains: search } },
              { resourceId: { contains: search } },
              { requestId: { contains: search } },
            ],
          }
        : {}),
    };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          actorType: true,
          action: true,
          resourceType: true,
          resourceId: true,
          outcome: true,
          requestId: true,
          errorCode: true,
          occurredAt: true,
          actor: { select: { adminProfile: { select: { displayName: true } } } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: {
        items: records.map((record) => ({
          id: record.id,
          actorName: record.actor?.adminProfile?.displayName ?? record.actorType,
          actorType: record.actorType,
          action: record.action,
          resourceType: record.resourceType,
          resourceId: record.resourceId,
          outcome: record.outcome,
          requestId: record.requestId,
          errorCode: record.errorCode,
          occurredAt: record.occurredAt.toISOString(),
          createdAt: record.occurredAt.toISOString(),
        })),
        page: query.page,
        pageSize: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async dashboard(query: AdminDashboardQueryDto) {
    const asOf = new Date();
    const periodStart = new Date(asOf.getTime() - query.days * 86_400_000);
    const period = { gte: periodStart, lt: asOf };
    const [
      ordersCreated,
      ordersDelivered,
      expectedCash,
      verifiedRemittances,
      deliveryFailureCount,
      lowStockRows,
    ] = await this.prisma.$transaction([
      this.prisma.order.count({ where: { createdAt: period } }),
      this.prisma.delivery.count({ where: { deliveredAt: period } }),
      this.prisma.cashCollection.aggregate({
        where: { createdAt: period, status: { not: 'VOIDED' } },
        _sum: { expectedMillimes: true },
      }),
      this.prisma.cashRemittance.aggregate({
        where: { status: 'VERIFIED', verifiedAt: period },
        _sum: { verifiedMillimes: true },
      }),
      this.prisma.deliveryAttempt.count({
        where: {
          attemptedAt: period,
          outcome: {
            in: [
              'CUSTOMER_UNAVAILABLE',
              'ADDRESS_NOT_FOUND',
              'CUSTOMER_REFUSED',
              'FAILED_AGE_VERIFICATION',
              'PARTIAL_CASH_NOT_ALLOWED',
              'OTHER_FAILED',
            ],
          },
        },
      }),
      this.prisma.$queryRaw<CountRow[]>(this.lowStockCountSql(asOf)),
    ]);

    return {
      data: {
        asOf: asOf.toISOString(),
        period: {
          kind: 'ROLLING' as const,
          days: query.days,
          startInclusive: periodStart.toISOString(),
          endExclusive: asOf.toISOString(),
          timezone: REPORTING_TIMEZONE,
        },
        currency: CURRENCY,
        ordersCreated,
        ordersDelivered,
        codExpectedMillimes: expectedCash._sum.expectedMillimes ?? 0,
        codRemittedMillimes: verifiedRemittances._sum.verifiedMillimes ?? 0,
        lowStockCount: toSafeInteger(lowStockRows[0]?.value),
        deliveryFailureCount,
        definitions: {
          ordersCreated: 'Orders whose immutable createdAt is inside the reporting period.',
          ordersDelivered:
            'Delivery records whose deliveredAt event timestamp is inside the reporting period.',
          codExpectedMillimes:
            'Sum of expectedMillimes on non-voided cash-collection ledger rows created in the period; this is not revenue.',
          codRemittedMillimes:
            'Sum of verifiedMillimes on VERIFIED remittances verified in the period.',
          lowStockCount:
            'Published variants whose remaining eligible stock at asOf is at or below their low-stock threshold.',
          deliveryFailureCount:
            'Immutable delivery-attempt events with a failure outcome inside the reporting period.',
        },
      },
    };
  }

  private inventoryWhere(query: AdminInventoryQueryDto): Prisma.ProductVariantWhereInput {
    const search = normalizeQuery(query.q);
    const brand = normalizeQuery(query.brand);
    const flavor = normalizeQuery(query.flavor);
    const product: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.productType ? { productType: query.productType } : {}),
      ...(brand
        ? {
            brand: {
              is: { OR: [{ id: brand }, { slug: brand }] },
            },
          }
        : {}),
    };
    return {
      deletedAt: null,
      product: { is: product },
      AND: [
        ...(flavor
          ? [
              {
                OR: [
                  {
                    flavor: {
                      is: {
                        OR: [
                          { canonicalName: { equals: flavor } },
                          { slug: { equals: flavor } },
                          { nameFr: { equals: flavor } },
                          { nameAr: { equals: flavor } },
                        ],
                      },
                    },
                  },
                  {
                    AND: [{ flavorId: null }, { product: { is: { flavor: { equals: flavor } } } }],
                  },
                ],
              },
            ]
          : []),
        ...(search
          ? [
              {
                OR: [
                  { sku: { contains: search } },
                  { barcode: { contains: search } },
                  { nameFr: { contains: search } },
                  { nameAr: { contains: search } },
                  {
                    flavor: {
                      is: {
                        OR: [
                          { canonicalName: { contains: search } },
                          { slug: { contains: search } },
                          { nameFr: { contains: search } },
                          { nameAr: { contains: search } },
                        ],
                      },
                    },
                  },
                  {
                    AND: [
                      { flavorId: null },
                      { product: { is: { flavor: { contains: search } } } },
                    ],
                  },
                  {
                    product: {
                      is: {
                        OR: [
                          { nameFr: { contains: search } },
                          { nameAr: { contains: search } },
                          { sku: { contains: search } },
                          { barcode: { contains: search } },
                          { slug: { contains: search } },
                          { brand: { is: { name: { contains: search } } } },
                        ],
                      },
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };
  }

  /**
   * This parameterized aggregate is deliberately raw: Prisma groupBy cannot group inventory by
   * related brand/flavor fields while also subtracting reservation rows without materializing the
   * entire filtered inventory in application memory. All caller values remain bound parameters.
   */
  private inventoryGroupSql(query: AdminInventoryQueryDto, asOf: Date): Prisma.Sql {
    const effectiveFlavor = Prisma.sql`CASE
      WHEN variant.flavorId IS NOT NULL THEN NULLIF(TRIM(flavorRecord.canonicalName), '')
      ELSE NULLIF(TRIM(p.flavor), '')
    END`;
    return Prisma.sql`
      SELECT
        p.brandId AS brandId,
        b.name AS brandName,
        p.productType AS productType,
        ${effectiveFlavor} AS flavor,
        CAST(COALESCE(SUM(COALESCE(eligible.onHandQuantity, 0)), 0) AS SIGNED) AS onHandQuantity,
        CAST(COALESCE(SUM(COALESCE(eligible.reservedQuantity, 0)), 0) AS SIGNED) AS reservedQuantity
      FROM ProductVariant AS variant
      INNER JOIN Product AS p ON p.id = variant.productId
      LEFT JOIN Brand AS b ON b.id = p.brandId
      LEFT JOIN Flavor AS flavorRecord ON flavorRecord.id = variant.flavorId
      LEFT JOIN ${this.eligibleInventorySql(asOf)} AS eligible ON eligible.variantId = variant.id
      WHERE ${this.inventoryFilterSql(query)}
      GROUP BY p.brandId, b.name, p.productType, ${effectiveFlavor}
      ORDER BY b.name ASC, p.productType ASC, flavor ASC
      LIMIT ${INVENTORY_GROUP_LIMIT + 1}
    `;
  }

  private inventoryFilterSql(query: AdminInventoryQueryDto): Prisma.Sql {
    const predicates: Prisma.Sql[] = [
      Prisma.sql`variant.deletedAt IS NULL`,
      Prisma.sql`p.deletedAt IS NULL`,
    ];
    const search = normalizeQuery(query.q);
    const brand = normalizeQuery(query.brand);
    const flavor = normalizeQuery(query.flavor);
    if (query.productType) predicates.push(Prisma.sql`p.productType = ${query.productType}`);
    if (brand) predicates.push(Prisma.sql`(p.brandId = ${brand} OR b.slug = ${brand})`);
    if (flavor) {
      predicates.push(Prisma.sql`(
        (
          variant.flavorId IS NOT NULL
          AND (
            flavorRecord.canonicalName = ${flavor}
            OR flavorRecord.slug = ${flavor}
            OR flavorRecord.nameFr = ${flavor}
            OR flavorRecord.nameAr = ${flavor}
          )
        )
        OR (variant.flavorId IS NULL AND p.flavor = ${flavor})
      )`);
    }
    if (search) {
      predicates.push(Prisma.sql`(
        LOCATE(${search}, variant.sku) > 0 OR
        LOCATE(${search}, COALESCE(variant.barcode, '')) > 0 OR
        LOCATE(${search}, variant.nameFr) > 0 OR
        LOCATE(${search}, variant.nameAr) > 0 OR
        LOCATE(${search}, p.nameFr) > 0 OR
        LOCATE(${search}, p.nameAr) > 0 OR
        LOCATE(${search}, COALESCE(p.sku, '')) > 0 OR
        LOCATE(${search}, COALESCE(p.barcode, '')) > 0 OR
        LOCATE(${search}, p.slug) > 0 OR
        LOCATE(${search}, COALESCE(flavorRecord.canonicalName, '')) > 0 OR
        LOCATE(${search}, COALESCE(flavorRecord.slug, '')) > 0 OR
        LOCATE(${search}, COALESCE(flavorRecord.nameFr, '')) > 0 OR
        LOCATE(${search}, COALESCE(flavorRecord.nameAr, '')) > 0 OR
        (
          variant.flavorId IS NULL
          AND LOCATE(${search}, COALESCE(p.flavor, '')) > 0
        ) OR
        LOCATE(${search}, COALESCE(b.name, '')) > 0
      )`);
    }
    return Prisma.join(predicates, ' AND ');
  }

  private eligibleInventorySql(asOf: Date): Prisma.Sql {
    return Prisma.sql`(
      SELECT
        item.id,
        item.variantId,
        item.onHandQuantity,
        COALESCE(SUM(
          CASE
            WHEN reservation.state = 'ACTIVE' AND reservation.expiresAt > ${asOf}
              THEN reservation.quantity
            ELSE 0
          END
        ), 0) AS reservedQuantity
      FROM InventoryItem AS item
      LEFT JOIN ProductBatch AS batch ON batch.id = item.batchId
      LEFT JOIN StockReservation AS reservation ON reservation.inventoryItemId = item.id
      WHERE item.batchId IS NULL
        OR (
          batch.archivedAt IS NULL
          AND (batch.expiryDate IS NULL OR batch.expiryDate > ${asOf})
        )
      GROUP BY item.id, item.variantId, item.onHandQuantity
    )`;
  }

  private lowStockCountSql(asOf: Date): Prisma.Sql {
    return Prisma.sql`
      SELECT CAST(COUNT(*) AS SIGNED) AS value
      FROM (
        SELECT variant.id
        FROM ProductVariant AS variant
        INNER JOIN Product AS p ON p.id = variant.productId
        LEFT JOIN ${this.eligibleInventorySql(asOf)} AS eligible ON eligible.variantId = variant.id
        WHERE variant.publicationStatus = 'PUBLISHED'
          AND variant.archivedAt IS NULL
          AND variant.deletedAt IS NULL
          AND p.publicationStatus = 'PUBLISHED'
          AND p.suspendedAt IS NULL
          AND p.archivedAt IS NULL
          AND p.deletedAt IS NULL
        GROUP BY variant.id, variant.lowStockThreshold
        HAVING COALESCE(SUM(
          COALESCE(eligible.onHandQuantity, 0) - COALESCE(eligible.reservedQuantity, 0)
        ), 0) <= variant.lowStockThreshold
      ) AS lowStockVariants
    `;
  }

  private inventoryGroups(rows: InventoryAggregateRow[]) {
    const byBrand = new Map<string, BrandTotals>();
    const byProductType = new Map<string, ProductTypeTotals>();
    const byFlavor = new Map<string, FlavorTotals>();
    const byBrandAndFlavor = new Map<string, BrandFlavorTotals>();

    for (const row of rows) {
      const onHandQuantity = toSafeInteger(row.onHandQuantity);
      const reservedQuantity = toSafeInteger(row.reservedQuantity);
      const brandKey = row.brandId ?? '__unbranded__';
      const flavorKey = row.flavor ?? '__unspecified__';
      addTotals(
        byBrand,
        brandKey,
        () => ({
          brandId: row.brandId,
          brandName: row.brandName,
          onHandQuantity: 0,
          reservedQuantity: 0,
          remainingQuantity: 0,
        }),
        onHandQuantity,
        reservedQuantity,
      );
      addTotals(
        byProductType,
        row.productType,
        () => ({
          productType: row.productType,
          onHandQuantity: 0,
          reservedQuantity: 0,
          remainingQuantity: 0,
        }),
        onHandQuantity,
        reservedQuantity,
      );
      addTotals(
        byFlavor,
        flavorKey,
        () => ({
          flavor: row.flavor,
          onHandQuantity: 0,
          reservedQuantity: 0,
          remainingQuantity: 0,
        }),
        onHandQuantity,
        reservedQuantity,
      );
      addTotals(
        byBrandAndFlavor,
        `${brandKey}\u0000${flavorKey}`,
        () => ({
          brandId: row.brandId,
          brandName: row.brandName,
          flavor: row.flavor,
          onHandQuantity: 0,
          reservedQuantity: 0,
          remainingQuantity: 0,
        }),
        onHandQuantity,
        reservedQuantity,
      );
    }

    return {
      scope: 'FILTERED_RESULT' as const,
      byBrand: [...byBrand.values()].sort((left, right) =>
        (left.brandName ?? '').localeCompare(right.brandName ?? ''),
      ),
      byProductType: [...byProductType.values()].sort((left, right) =>
        left.productType.localeCompare(right.productType),
      ),
      byFlavor: [...byFlavor.values()].sort((left, right) =>
        (left.flavor ?? '').localeCompare(right.flavor ?? ''),
      ),
      byBrandAndFlavor: [...byBrandAndFlavor.values()].sort((left, right) => {
        const brandOrder = (left.brandName ?? '').localeCompare(right.brandName ?? '');
        return brandOrder || (left.flavor ?? '').localeCompare(right.flavor ?? '');
      }),
    };
  }
}
