import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type StockMovementType } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import type {
  ApplyInventoryAdjustmentDto,
  CreateInventoryItemDto,
  CreateInventoryLocationDto,
  InventoryAdjustmentOperation,
  InventoryAdjustmentReason,
  InventoryMovementQueryDto,
  UpdateLowStockThresholdDto,
} from './dto/admin-inventory.dto';

const DATABASE_INT_MAX = 2_147_483_647;

export interface CalculatedInventoryAdjustment {
  quantityDelta: number;
  onHandAfter: number;
}

export const calculateInventoryAdjustment = (
  currentOnHand: number,
  operation: InventoryAdjustmentOperation,
  quantity?: number,
  targetOnHandQuantity?: number,
): CalculatedInventoryAdjustment => {
  if (operation === 'SET') {
    if (targetOnHandQuantity === undefined || quantity !== undefined) {
      throw new BadRequestException({
        code: 'INVALID_INVENTORY_ADJUSTMENT_INPUT',
        message: 'SET requires targetOnHandQuantity and does not accept quantity.',
      });
    }
    if (targetOnHandQuantity === currentOnHand) {
      throw new BadRequestException({
        code: 'ZERO_INVENTORY_ADJUSTMENT',
        message: 'The requested correction does not change physical stock.',
      });
    }
    return {
      quantityDelta: targetOnHandQuantity - currentOnHand,
      onHandAfter: targetOnHandQuantity,
    };
  }

  if (quantity === undefined || targetOnHandQuantity !== undefined) {
    throw new BadRequestException({
      code: 'INVALID_INVENTORY_ADJUSTMENT_INPUT',
      message: `${operation} requires quantity and does not accept targetOnHandQuantity.`,
    });
  }
  const quantityDelta = operation === 'ADD' ? quantity : -quantity;
  const onHandAfter = currentOnHand + quantityDelta;
  if (onHandAfter < 0 || onHandAfter > DATABASE_INT_MAX) {
    throw new ConflictException({
      code: 'INVALID_RESULTING_STOCK',
      message: 'The adjustment would place physical stock outside the supported range.',
    });
  }
  return { quantityDelta, onHandAfter };
};

const assertReasonAllowed = (
  operation: InventoryAdjustmentOperation,
  reason: InventoryAdjustmentReason,
  note?: string,
): void => {
  const allowed: Record<InventoryAdjustmentOperation, readonly InventoryAdjustmentReason[]> = {
    ADD: ['PURCHASE_RECEIPT', 'STOCK_COUNT_CORRECTION', 'OTHER'],
    REMOVE: ['STOCK_COUNT_CORRECTION', 'DAMAGE', 'EXPIRY', 'OTHER'],
    SET: ['STOCK_COUNT_CORRECTION', 'OTHER'],
  };
  if (!allowed[operation].includes(reason)) {
    throw new BadRequestException({
      code: 'INVALID_INVENTORY_ADJUSTMENT_REASON',
      message: 'The selected reason is not valid for this adjustment operation.',
    });
  }
  if (reason === 'OTHER' && !note?.trim()) {
    throw new BadRequestException({
      code: 'INVENTORY_ADJUSTMENT_NOTE_REQUIRED',
      message: 'A safe explanatory note is required when the reason is OTHER.',
    });
  }
};

const movementType = (
  operation: InventoryAdjustmentOperation,
  reason: InventoryAdjustmentReason,
): StockMovementType => {
  if (operation === 'ADD' && reason === 'PURCHASE_RECEIPT') return 'PURCHASE_RECEIPT';
  if (reason === 'DAMAGE') return 'DAMAGE';
  if (reason === 'EXPIRY') return 'EXPIRY';
  return 'MANUAL_ADJUSTMENT';
};

const requestMetadata = (request: Request) => {
  const userAgent = request.get('user-agent');
  return {
    actorUserId: request.auth!.userId,
    actorType: 'ADMIN' as const,
    outcome: 'SUCCESS' as const,
    requestId: request.requestId,
    ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
    ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
};

@Injectable()
export class AdminInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async locations() {
    const items = await this.prisma.inventoryLocation.findMany({
      where: { active: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        code: true,
        name: true,
        address: true,
        active: true,
        fulfillsOrders: true,
        updatedAt: true,
      },
    });
    return { data: items.map((item) => ({ ...item, updatedAt: item.updatedAt.toISOString() })) };
  }

  async createLocation(input: CreateInventoryLocationDto, request: Request) {
    try {
      const location = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.inventoryLocation.create({
          data: {
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            address: input.address?.trim() || null,
            active: true,
            fulfillsOrders: input.fulfillsOrders ?? true,
          },
        });
        await transaction.auditLog.create({
          data: {
            ...requestMetadata(request),
            action: 'inventory.location.create',
            resourceType: 'InventoryLocation',
            resourceId: created.id,
            afterSummary: {
              code: created.code,
              active: created.active,
              fulfillsOrders: created.fulfillsOrders,
            },
          },
        });
        return created;
      });
      return { data: { ...location, updatedAt: location.updatedAt.toISOString() } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'INVENTORY_LOCATION_CODE_CONFLICT',
          message: 'The inventory location code is already in use.',
        });
      }
      throw error;
    }
  }

  async createItem(input: CreateInventoryItemDto, request: Request) {
    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const [variant, location, batch] = await Promise.all([
          transaction.productVariant.findFirst({
            where: { id: input.variantId, deletedAt: null, archivedAt: null },
            select: { id: true },
          }),
          transaction.inventoryLocation.findFirst({
            where: { id: input.locationId, active: true },
            select: { id: true },
          }),
          input.batchId
            ? transaction.productBatch.findFirst({
                where: { id: input.batchId, variantId: input.variantId, archivedAt: null },
                select: { id: true },
              })
            : Promise.resolve(null),
        ]);
        if (!variant || !location || (input.batchId && !batch)) {
          throw new BadRequestException({
            code: 'INVALID_INVENTORY_BUCKET_REFERENCE',
            message: 'The variant, active location, or batch is not available for stock intake.',
          });
        }
        const item = await transaction.inventoryItem.create({
          data: {
            variantId: input.variantId,
            locationId: input.locationId,
            batchId: input.batchId ?? null,
            lotKey: input.batchId ?? 'UNBATCHED',
            onHandQuantity: input.initialQuantity,
          },
        });
        const movement = await transaction.stockMovement.create({
          data: {
            inventoryItemId: item.id,
            locationId: item.locationId,
            batchId: item.batchId,
            type: 'INITIAL_STOCK',
            quantityDelta: input.initialQuantity,
            onHandAfter: input.initialQuantity,
            referenceType: 'InventoryItem',
            referenceId: item.id,
            reasonCode: 'INITIAL_STOCK',
            note: input.note?.trim() || null,
            actorUserId: request.auth!.userId,
            requestId: request.requestId,
          },
        });
        await transaction.auditLog.create({
          data: {
            ...requestMetadata(request),
            action: 'inventory.item.create',
            resourceType: 'InventoryItem',
            resourceId: item.id,
            afterSummary: {
              variantId: item.variantId,
              locationId: item.locationId,
              batchId: item.batchId,
              onHandQuantity: item.onHandQuantity,
              movementId: movement.id,
              version: item.version,
            },
          },
        });
        return {
          id: item.id,
          variantId: item.variantId,
          locationId: item.locationId,
          batchId: item.batchId,
          onHandQuantity: item.onHandQuantity,
          version: item.version,
          movementId: movement.id,
        };
      });
      return { data: result };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'INVENTORY_BUCKET_CONFLICT',
          message: 'This variant, location, and lot inventory bucket already exists.',
        });
      }
      throw error;
    }
  }

  async getVariant(variantId: string) {
    const now = new Date();
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, deletedAt: null },
      select: {
        id: true,
        productId: true,
        nameFr: true,
        nameAr: true,
        sku: true,
        lowStockThreshold: true,
        version: true,
        product: { select: { nameFr: true, nameAr: true } },
        inventoryItems: {
          orderBy: [{ locationId: 'asc' }, { lotKey: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            lotKey: true,
            onHandQuantity: true,
            version: true,
            updatedAt: true,
            location: { select: { id: true, code: true, name: true, active: true } },
            batch: {
              select: {
                id: true,
                batchNumber: true,
                expiryDate: true,
                archivedAt: true,
              },
            },
            reservations: {
              where: { state: 'ACTIVE', expiresAt: { gt: now } },
              select: { quantity: true },
            },
          },
        },
      },
    });
    if (!variant) throw this.notFound('INVENTORY_VARIANT_NOT_FOUND');

    const items = variant.inventoryItems.map((item) => {
      const reservedQuantity = item.reservations.reduce(
        (total, reservation) => total + reservation.quantity,
        0,
      );
      return {
        id: item.id,
        lotKey: item.lotKey,
        location: item.location,
        batch: item.batch
          ? {
              ...item.batch,
              expiryDate: item.batch.expiryDate?.toISOString() ?? null,
              archivedAt: item.batch.archivedAt?.toISOString() ?? null,
            }
          : null,
        onHandQuantity: item.onHandQuantity,
        reservedQuantity,
        availableQuantity: item.onHandQuantity - reservedQuantity,
        committedQuantity: 0,
        version: item.version,
        updatedAt: item.updatedAt.toISOString(),
      };
    });

    return {
      data: {
        id: variant.id,
        productId: variant.productId,
        productNameFr: variant.product.nameFr,
        productNameAr: variant.product.nameAr,
        nameFr: variant.nameFr,
        nameAr: variant.nameAr,
        sku: variant.sku,
        lowStockThreshold: variant.lowStockThreshold,
        version: variant.version,
        onHandQuantity: items.reduce((total, item) => total + item.onHandQuantity, 0),
        reservedQuantity: items.reduce((total, item) => total + item.reservedQuantity, 0),
        availableQuantity: items.reduce((total, item) => total + item.availableQuantity, 0),
        committedQuantity: 0,
        commitmentPolicy: 'DEDUCT_ON_CONFIRMATION' as const,
        items,
        asOf: now.toISOString(),
      },
    };
  }

  async movements(id: string, query: InventoryMovementQueryDto) {
    const exists = await this.prisma.inventoryItem.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw this.notFound('INVENTORY_ITEM_NOT_FOUND');
    const where: Prisma.StockMovementWhereInput = { inventoryItemId: id };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          type: true,
          quantityDelta: true,
          onHandAfter: true,
          referenceType: true,
          referenceId: true,
          reasonCode: true,
          note: true,
          requestId: true,
          occurredAt: true,
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return {
      data: {
        items: records.map((record) => ({
          ...record,
          occurredAt: record.occurredAt.toISOString(),
        })),
        page: query.page,
        pageSize: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async adjust(id: string, input: ApplyInventoryAdjustmentDto, request: Request) {
    assertReasonAllowed(input.operation, input.reasonCode, input.note);
    const now = new Date();
    const result = await this.prisma.$transaction(
      async (transaction) => {
        const locked = await transaction.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM InventoryItem WHERE id = ${id} FOR UPDATE`,
        );
        if (locked.length !== 1) throw this.notFound('INVENTORY_ITEM_NOT_FOUND');
        const current = await transaction.inventoryItem.findUnique({ where: { id } });
        if (!current) throw this.notFound('INVENTORY_ITEM_NOT_FOUND');
        if (current.version !== input.expectedVersion) throw this.versionConflict();

        const adjustment = calculateInventoryAdjustment(
          current.onHandQuantity,
          input.operation,
          input.quantity,
          input.targetOnHandQuantity,
        );
        const reservationTotal = await transaction.stockReservation.aggregate({
          where: { inventoryItemId: id, state: 'ACTIVE', expiresAt: { gt: now } },
          _sum: { quantity: true },
        });
        const reservedQuantity = reservationTotal._sum.quantity ?? 0;
        if (adjustment.onHandAfter < reservedQuantity) {
          throw new ConflictException({
            code: 'INVENTORY_RESERVED_QUANTITY_CONFLICT',
            message: 'The adjustment would reduce stock below active reservations.',
          });
        }

        const updated = await transaction.inventoryItem.updateMany({
          where: { id, version: input.expectedVersion },
          data: {
            onHandQuantity: adjustment.onHandAfter,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw this.versionConflict();
        const movement = await transaction.stockMovement.create({
          data: {
            inventoryItemId: id,
            locationId: current.locationId,
            batchId: current.batchId,
            type: movementType(input.operation, input.reasonCode),
            quantityDelta: adjustment.quantityDelta,
            onHandAfter: adjustment.onHandAfter,
            referenceType: 'InventoryAdjustment',
            reasonCode: input.reasonCode,
            note: input.note?.trim() || null,
            actorUserId: request.auth!.userId,
            requestId: request.requestId,
          },
        });
        const record = await transaction.inventoryAdjustment.create({
          data: {
            inventoryItemId: id,
            quantityDelta: adjustment.quantityDelta,
            reasonCode: input.reasonCode,
            note: input.note?.trim() || null,
            status: 'APPLIED',
            requestedBy: request.auth!.userId,
            approvedBy: request.auth!.userId,
            requestedAt: now,
            decidedAt: now,
            appliedAt: now,
            stockMovementId: movement.id,
          },
        });
        await transaction.stockMovement.update({
          where: { id: movement.id },
          data: { referenceId: record.id },
        });
        await transaction.auditLog.create({
          data: {
            ...requestMetadata(request),
            action: 'inventory.adjustment.apply',
            resourceType: 'InventoryItem',
            resourceId: id,
            beforeSummary: {
              onHandQuantity: current.onHandQuantity,
              reservedQuantity,
              version: current.version,
            },
            afterSummary: {
              onHandQuantity: adjustment.onHandAfter,
              quantityDelta: adjustment.quantityDelta,
              reasonCode: input.reasonCode,
              version: current.version + 1,
              movementId: movement.id,
            },
          },
        });
        return {
          adjustmentId: record.id,
          movementId: movement.id,
          inventoryItemId: id,
          onHandQuantity: adjustment.onHandAfter,
          reservedQuantity,
          availableQuantity: adjustment.onHandAfter - reservedQuantity,
          version: current.version + 1,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 },
    );
    return { data: result };
  }

  async updateThreshold(variantId: string, input: UpdateLowStockThresholdDto, request: Request) {
    const result = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.productVariant.findFirst({
        where: { id: variantId, deletedAt: null },
        select: { id: true, lowStockThreshold: true, version: true },
      });
      if (!current) throw this.notFound('INVENTORY_VARIANT_NOT_FOUND');
      if (current.version !== input.expectedVersion) throw this.versionConflict();
      if (current.lowStockThreshold === input.lowStockThreshold) {
        throw new BadRequestException({
          code: 'LOW_STOCK_THRESHOLD_UNCHANGED',
          message: 'The requested low-stock threshold is already configured.',
        });
      }
      const updated = await transaction.productVariant.updateMany({
        where: { id: variantId, version: input.expectedVersion, deletedAt: null },
        data: { lowStockThreshold: input.lowStockThreshold, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw this.versionConflict();
      await transaction.auditLog.create({
        data: {
          ...requestMetadata(request),
          action: 'inventory.low_stock_threshold.update',
          resourceType: 'ProductVariant',
          resourceId: variantId,
          beforeSummary: {
            lowStockThreshold: current.lowStockThreshold,
            version: current.version,
          },
          afterSummary: {
            lowStockThreshold: input.lowStockThreshold,
            version: current.version + 1,
          },
        },
      });
      return {
        variantId,
        lowStockThreshold: input.lowStockThreshold,
        version: current.version + 1,
      };
    });
    return { data: result };
  }

  private notFound(code: string): NotFoundException {
    return new NotFoundException({
      code,
      message: 'The requested inventory record does not exist.',
    });
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      code: 'VERSION_CONFLICT',
      message: 'Inventory changed since it was loaded. Reload it and retry.',
    });
  }
}
