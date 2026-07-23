import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type InventoryTransfer,
  type ProductBatch,
  type StockMovement,
  type StockMovementType,
} from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import type {
  ApplyInventoryAdjustmentDto,
  CreateBatchReceiptDto,
  CreateInventoryItemDto,
  CreateInventoryLocationDto,
  DecideInventoryAdjustmentDto,
  InventoryAdjustmentQueryDto,
  InventoryAdjustmentOperation,
  InventoryAdjustmentReason,
  InventoryMovementQueryDto,
  InventoryTransferQueryDto,
  TransferInventoryDto,
  UpdateLowStockThresholdDto,
} from './dto/admin-inventory.dto';

const DATABASE_INT_MAX = 2_147_483_647;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:+-]{16,128}$/;
const ADJUSTMENT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface CalculatedInventoryAdjustment {
  quantityDelta: number;
  onHandAfter: number;
}

export interface CalculatedInventoryTransfer {
  sourceOnHandAfter: number;
  destinationOnHandAfter: number;
}

export const calculateInventoryTransfer = (
  sourceOnHand: number,
  sourceReserved: number,
  destinationOnHand: number,
  quantity: number,
): CalculatedInventoryTransfer => {
  if (sourceOnHand - sourceReserved < quantity) {
    throw new ConflictException({
      code: 'INVENTORY_TRANSFER_AVAILABLE_QUANTITY_CONFLICT',
      message: 'The source does not have enough unreserved physical stock.',
    });
  }
  if (destinationOnHand > DATABASE_INT_MAX - quantity) {
    throw new ConflictException({
      code: 'INVALID_RESULTING_STOCK',
      message: 'The transfer would place destination stock outside the supported range.',
    });
  }
  return {
    sourceOnHandAfter: sourceOnHand - quantity,
    destinationOnHandAfter: destinationOnHand + quantity,
  };
};

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
  if (reason === 'PURCHASE_RECEIPT') {
    throw new BadRequestException({
      code: 'BATCH_RECEIPT_REQUIRED',
      message: 'Purchase receipts must use the traceable batch receipt workflow.',
    });
  }
  const allowed: Record<InventoryAdjustmentOperation, readonly InventoryAdjustmentReason[]> = {
    ADD: ['STOCK_COUNT_CORRECTION', 'OTHER'],
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

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
};

export const inventoryRequestFingerprint = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');

const inventoryIdempotencyKeyHash = (scope: string, actorUserId: string, key: string): string =>
  createHash('sha256').update(`${scope}\0${actorUserId}\0${key}`).digest('hex');

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
    if (input.initialQuantity !== 0) {
      throw new BadRequestException({
        code: 'INITIAL_STOCK_RECEIPT_REQUIRED',
        message: 'Create an empty bucket, then use the idempotent batch receipt workflow.',
      });
    }
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

  async receiveBatch(
    input: CreateBatchReceiptDto,
    idempotencyKey: string | undefined,
    request: Request,
  ) {
    const normalizedKey = this.requireIdempotencyKey(idempotencyKey);
    const actorUserId = request.auth!.userId;
    const keyHash = inventoryIdempotencyKeyHash('batch-receipt', actorUserId, normalizedKey);
    const normalized = {
      ...input,
      batchNumber: input.batchNumber.trim(),
      supplierId: input.supplierId ?? null,
      supplierReference: input.supplierReference?.trim() || null,
      manufacturedAt: input.manufacturedAt ?? null,
      note: input.note?.trim() || null,
    };
    const fingerprint = inventoryRequestFingerprint(normalized);
    const replay = await this.replayBatchReceipt(keyHash, fingerprint);
    if (replay) return replay;

    const now = new Date();
    const expiryDate = new Date(`${input.expiryDate}T00:00:00.000Z`);
    const manufacturedAt = input.manufacturedAt
      ? new Date(`${input.manufacturedAt}T00:00:00.000Z`)
      : null;
    const receivedDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    if (expiryDate <= receivedDay || (manufacturedAt && manufacturedAt >= expiryDate)) {
      throw new BadRequestException({
        code: 'INVALID_BATCH_DATES',
        message: 'Expiry must be after receipt day and after the manufacturing date.',
      });
    }

    try {
      const result = await this.prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw(
            Prisma.sql`SELECT id FROM ProductVariant WHERE id = ${input.variantId} FOR UPDATE`,
          );
          await transaction.$queryRaw(
            Prisma.sql`SELECT id FROM InventoryLocation WHERE id = ${input.locationId} FOR UPDATE`,
          );
          const variant = await transaction.productVariant.findFirst({
            where: { id: input.variantId, deletedAt: null, archivedAt: null },
            select: { id: true },
          });
          const location = await transaction.inventoryLocation.findFirst({
            where: { id: input.locationId, active: true },
            select: { id: true },
          });
          const supplier = input.supplierId
            ? await transaction.supplier.findFirst({
                where: { id: input.supplierId, status: 'ACTIVE' },
                select: { id: true },
              })
            : null;
          if (!variant || !location || (input.supplierId && !supplier)) {
            throw new BadRequestException({
              code: 'INVALID_BATCH_RECEIPT_REFERENCE',
              message: 'The variant, active location, or supplier is not available for receipt.',
            });
          }

          let batch = await transaction.productBatch.findUnique({
            where: {
              variantId_batchNumber: {
                variantId: input.variantId,
                batchNumber: normalized.batchNumber,
              },
            },
          });
          if (batch) {
            const sameMetadata =
              batch.archivedAt === null &&
              batch.supplierId === normalized.supplierId &&
              batch.supplierReference === normalized.supplierReference &&
              batch.manufacturedAt?.getTime() === manufacturedAt?.getTime() &&
              batch.expiryDate?.getTime() === expiryDate.getTime();
            if (!sameMetadata) {
              throw new ConflictException({
                code: 'BATCH_METADATA_CONFLICT',
                message: 'This batch number already exists with different or archived metadata.',
              });
            }
            if (!batch.receivedAt) {
              batch = await transaction.productBatch.update({
                where: { id: batch.id },
                data: { receivedAt: now },
              });
            }
          } else {
            batch = await transaction.productBatch.create({
              data: {
                variantId: input.variantId,
                supplierId: normalized.supplierId,
                batchNumber: normalized.batchNumber,
                supplierReference: normalized.supplierReference,
                manufacturedAt,
                expiryDate,
                receivedAt: now,
              },
            });
          }

          let item = await transaction.inventoryItem.findUnique({
            where: {
              variantId_locationId_lotKey: {
                variantId: input.variantId,
                locationId: input.locationId,
                lotKey: batch.id,
              },
            },
          });
          if (item) {
            await transaction.$queryRaw(
              Prisma.sql`SELECT id FROM InventoryItem WHERE id = ${item.id} FOR UPDATE`,
            );
            item = await transaction.inventoryItem.findUnique({ where: { id: item.id } });
          }
          const onHandBefore = item?.onHandQuantity ?? 0;
          if (onHandBefore > DATABASE_INT_MAX - input.quantity) {
            throw new ConflictException({
              code: 'INVALID_RESULTING_STOCK',
              message: 'The receipt would place physical stock outside the supported range.',
            });
          }
          if (item) {
            item = await transaction.inventoryItem.update({
              where: { id: item.id },
              data: { onHandQuantity: { increment: input.quantity }, version: { increment: 1 } },
            });
          } else {
            item = await transaction.inventoryItem.create({
              data: {
                variantId: input.variantId,
                locationId: input.locationId,
                batchId: batch.id,
                lotKey: batch.id,
                onHandQuantity: input.quantity,
              },
            });
          }
          const movement = await transaction.stockMovement.create({
            data: {
              inventoryItemId: item.id,
              locationId: item.locationId,
              batchId: batch.id,
              type: 'PURCHASE_RECEIPT',
              quantityDelta: input.quantity,
              onHandAfter: item.onHandQuantity,
              referenceType: 'ProductBatchReceipt',
              referenceId: batch.id,
              reasonCode: 'PURCHASE_RECEIPT',
              note: normalized.note,
              actorUserId,
              requestId: request.requestId,
              idempotencyKeyHash: keyHash,
              requestFingerprint: fingerprint,
            },
          });
          await transaction.auditLog.create({
            data: {
              ...requestMetadata(request),
              action: 'inventory.batch.receive',
              resourceType: 'ProductBatch',
              resourceId: batch.id,
              beforeSummary: { inventoryItemId: item.id, onHandQuantity: onHandBefore },
              afterSummary: {
                inventoryItemId: item.id,
                locationId: item.locationId,
                batchNumber: batch.batchNumber,
                expiryDate: input.expiryDate,
                quantityReceived: input.quantity,
                onHandQuantity: item.onHandQuantity,
                movementId: movement.id,
              },
            },
          });
          return this.batchReceiptResponse(batch, movement, item.version, false);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 },
      );
      return { data: result };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const racedReplay = await this.replayBatchReceipt(keyHash, fingerprint);
        if (racedReplay) return racedReplay;
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
                supplierId: true,
                supplierReference: true,
                manufacturedAt: true,
                expiryDate: true,
                receivedAt: true,
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
              manufacturedAt: item.batch.manufacturedAt?.toISOString() ?? null,
              expiryDate: item.batch.expiryDate?.toISOString() ?? null,
              receivedAt: item.batch.receivedAt?.toISOString() ?? null,
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
        const record = await transaction.inventoryAdjustment.create({
          data: {
            inventoryItemId: id,
            quantityDelta: adjustment.quantityDelta,
            reasonCode: input.reasonCode,
            note: input.note?.trim() || null,
            status: 'PENDING_APPROVAL',
            requestedBy: request.auth!.userId,
            expectedVersion: current.version,
            onHandBefore: current.onHandQuantity,
            requestedAt: now,
            expiresAt: new Date(now.getTime() + ADJUSTMENT_APPROVAL_TTL_MS),
          },
        });
        await transaction.auditLog.create({
          data: {
            ...requestMetadata(request),
            action: 'inventory.adjustment.request',
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
              expectedVersion: current.version,
              adjustmentId: record.id,
              status: record.status,
            },
          },
        });
        return {
          adjustmentId: record.id,
          inventoryItemId: id,
          status: record.status,
          requiresApproval: true,
          proposedOnHandQuantity: adjustment.onHandAfter,
          currentOnHandQuantity: current.onHandQuantity,
          reservedQuantity,
          expectedVersion: current.version,
          expiresAt: record.expiresAt!.toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 },
    );
    return { data: result };
  }

  async adjustments(query: InventoryAdjustmentQueryDto) {
    const where: Prisma.InventoryAdjustmentWhereInput = query.status
      ? { status: query.status }
      : {};
    const [records, total] = await this.prisma.$transaction([
      this.prisma.inventoryAdjustment.findMany({
        where,
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          quantityDelta: true,
          reasonCode: true,
          note: true,
          status: true,
          requestedBy: true,
          approvedBy: true,
          decisionReason: true,
          expectedVersion: true,
          onHandBefore: true,
          requestedAt: true,
          expiresAt: true,
          decidedAt: true,
          appliedAt: true,
          stockMovementId: true,
          inventoryItem: {
            select: {
              id: true,
              version: true,
              onHandQuantity: true,
              location: { select: { id: true, code: true, name: true } },
              batch: { select: { id: true, batchNumber: true, expiryDate: true } },
              variant: { select: { id: true, sku: true, nameFr: true, nameAr: true } },
            },
          },
        },
      }),
      this.prisma.inventoryAdjustment.count({ where }),
    ]);
    return {
      data: {
        items: records.map((record) => ({
          ...record,
          proposedOnHandQuantity: record.onHandBefore + record.quantityDelta,
          requestedAt: record.requestedAt.toISOString(),
          expiresAt: record.expiresAt?.toISOString() ?? null,
          decidedAt: record.decidedAt?.toISOString() ?? null,
          appliedAt: record.appliedAt?.toISOString() ?? null,
          inventoryItem: {
            ...record.inventoryItem,
            batch: record.inventoryItem.batch
              ? {
                  ...record.inventoryItem.batch,
                  expiryDate: record.inventoryItem.batch.expiryDate?.toISOString() ?? null,
                }
              : null,
          },
        })),
        page: query.page,
        pageSize: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async decideAdjustment(id: string, input: DecideInventoryAdjustmentDto, request: Request) {
    const decisionReason = input.reason?.trim() || null;
    if (input.decision === 'REJECT' && !decisionReason) {
      throw new BadRequestException({
        code: 'INVENTORY_ADJUSTMENT_REJECTION_REASON_REQUIRED',
        message: 'A reason is required when rejecting an inventory adjustment.',
      });
    }
    const now = new Date();
    const outcome = await this.prisma.$transaction(
      async (transaction) => {
        const locked = await transaction.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM InventoryAdjustment WHERE id = ${id} FOR UPDATE`,
        );
        if (locked.length !== 1) throw this.notFound('INVENTORY_ADJUSTMENT_NOT_FOUND');
        const pending = await transaction.inventoryAdjustment.findUnique({ where: { id } });
        if (!pending) throw this.notFound('INVENTORY_ADJUSTMENT_NOT_FOUND');
        if (pending.requestedBy === request.auth!.userId) {
          throw new ForbiddenException({
            code: 'INVENTORY_DUAL_CONTROL_REQUIRED',
            message: 'The adjustment requester cannot decide their own request.',
          });
        }
        if (pending.status === 'APPLIED' && input.decision === 'APPROVE') {
          return {
            kind: 'result' as const,
            data: {
              adjustmentId: pending.id,
              inventoryItemId: pending.inventoryItemId,
              movementId: pending.stockMovementId,
              status: pending.status,
              replayed: true,
            },
          };
        }
        if (pending.status === 'REJECTED' && input.decision === 'REJECT') {
          return {
            kind: 'result' as const,
            data: {
              adjustmentId: pending.id,
              inventoryItemId: pending.inventoryItemId,
              status: pending.status,
              replayed: true,
            },
          };
        }
        if (pending.status !== 'PENDING_APPROVAL') {
          throw new ConflictException({
            code: 'INVENTORY_ADJUSTMENT_ALREADY_DECIDED',
            message: 'This inventory adjustment is no longer pending approval.',
          });
        }
        if (pending.expiresAt && pending.expiresAt <= now) {
          await transaction.inventoryAdjustment.update({
            where: { id },
            data: {
              status: 'EXPIRED',
              approvedBy: request.auth!.userId,
              decidedAt: now,
              decisionReason: 'APPROVAL_EXPIRED',
            },
          });
          await transaction.auditLog.create({
            data: {
              ...requestMetadata(request),
              action: 'inventory.adjustment.expire',
              resourceType: 'InventoryAdjustment',
              resourceId: id,
              beforeSummary: { status: pending.status },
              afterSummary: { status: 'EXPIRED' },
            },
          });
          return { kind: 'expired' as const };
        }
        if (input.decision === 'REJECT') {
          const rejected = await transaction.inventoryAdjustment.update({
            where: { id },
            data: {
              status: 'REJECTED',
              approvedBy: request.auth!.userId,
              decidedAt: now,
              decisionReason,
            },
          });
          await transaction.auditLog.create({
            data: {
              ...requestMetadata(request),
              action: 'inventory.adjustment.reject',
              resourceType: 'InventoryAdjustment',
              resourceId: id,
              beforeSummary: { status: pending.status },
              afterSummary: { status: rejected.status, decisionReason },
            },
          });
          return {
            kind: 'result' as const,
            data: {
              adjustmentId: rejected.id,
              inventoryItemId: rejected.inventoryItemId,
              status: rejected.status,
              replayed: false,
            },
          };
        }

        await transaction.$queryRaw(
          Prisma.sql`SELECT id FROM InventoryItem WHERE id = ${pending.inventoryItemId} FOR UPDATE`,
        );
        const current = await transaction.inventoryItem.findUnique({
          where: { id: pending.inventoryItemId },
        });
        if (!current) throw this.notFound('INVENTORY_ITEM_NOT_FOUND');
        if (
          current.version !== pending.expectedVersion ||
          current.onHandQuantity !== pending.onHandBefore
        ) {
          await transaction.inventoryAdjustment.update({
            where: { id },
            data: {
              status: 'REJECTED',
              approvedBy: request.auth!.userId,
              decidedAt: now,
              decisionReason: 'STALE_INVENTORY_VERSION',
            },
          });
          await transaction.auditLog.create({
            data: {
              ...requestMetadata(request),
              action: 'inventory.adjustment.reject_stale',
              resourceType: 'InventoryAdjustment',
              resourceId: id,
              beforeSummary: {
                status: pending.status,
                expectedVersion: pending.expectedVersion,
                onHandBefore: pending.onHandBefore,
              },
              afterSummary: {
                status: 'REJECTED',
                currentVersion: current.version,
                currentOnHandQuantity: current.onHandQuantity,
              },
            },
          });
          return { kind: 'stale' as const };
        }
        const onHandAfter = current.onHandQuantity + pending.quantityDelta;
        if (onHandAfter < 0 || onHandAfter > DATABASE_INT_MAX) {
          throw new ConflictException({
            code: 'INVALID_RESULTING_STOCK',
            message: 'The adjustment would place physical stock outside the supported range.',
          });
        }
        const reservationTotal = await transaction.stockReservation.aggregate({
          where: { inventoryItemId: current.id, state: 'ACTIVE', expiresAt: { gt: now } },
          _sum: { quantity: true },
        });
        const reservedQuantity = reservationTotal._sum.quantity ?? 0;
        if (onHandAfter < reservedQuantity) {
          throw new ConflictException({
            code: 'INVENTORY_RESERVED_QUANTITY_CONFLICT',
            message: 'The adjustment would reduce stock below active reservations.',
          });
        }
        const updated = await transaction.inventoryItem.updateMany({
          where: { id: current.id, version: pending.expectedVersion },
          data: { onHandQuantity: onHandAfter, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw this.versionConflict();
        const movement = await transaction.stockMovement.create({
          data: {
            inventoryItemId: current.id,
            locationId: current.locationId,
            batchId: current.batchId,
            type: movementType(
              pending.quantityDelta > 0 ? 'ADD' : 'REMOVE',
              pending.reasonCode as InventoryAdjustmentReason,
            ),
            quantityDelta: pending.quantityDelta,
            onHandAfter,
            referenceType: 'InventoryAdjustment',
            referenceId: pending.id,
            reasonCode: pending.reasonCode,
            note: pending.note,
            actorUserId: request.auth!.userId,
            requestId: request.requestId,
          },
        });
        const applied = await transaction.inventoryAdjustment.update({
          where: { id },
          data: {
            status: 'APPLIED',
            approvedBy: request.auth!.userId,
            decidedAt: now,
            appliedAt: now,
            decisionReason,
            stockMovementId: movement.id,
          },
        });
        await transaction.auditLog.create({
          data: {
            ...requestMetadata(request),
            action: 'inventory.adjustment.approve_apply',
            resourceType: 'InventoryAdjustment',
            resourceId: id,
            beforeSummary: {
              status: pending.status,
              onHandQuantity: current.onHandQuantity,
              reservedQuantity,
              version: current.version,
              requestedBy: pending.requestedBy,
            },
            afterSummary: {
              status: applied.status,
              onHandQuantity: onHandAfter,
              quantityDelta: pending.quantityDelta,
              version: current.version + 1,
              movementId: movement.id,
              approvedBy: request.auth!.userId,
              decisionReason,
            },
          },
        });
        return {
          kind: 'result' as const,
          data: {
            adjustmentId: applied.id,
            inventoryItemId: current.id,
            movementId: movement.id,
            status: applied.status,
            onHandQuantity: onHandAfter,
            reservedQuantity,
            availableQuantity: onHandAfter - reservedQuantity,
            version: current.version + 1,
            replayed: false,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 },
    );
    if (outcome.kind === 'expired') {
      throw new ConflictException({
        code: 'INVENTORY_ADJUSTMENT_APPROVAL_EXPIRED',
        message: 'This adjustment approval request has expired.',
      });
    }
    if (outcome.kind === 'stale') {
      throw new ConflictException({
        code: 'INVENTORY_ADJUSTMENT_STALE',
        message: 'Inventory changed after this adjustment was requested; submit a new request.',
      });
    }
    return { data: outcome.data };
  }

  async transfer(
    sourceInventoryItemId: string,
    input: TransferInventoryDto,
    idempotencyKey: string | undefined,
    request: Request,
  ) {
    const normalizedKey = this.requireIdempotencyKey(idempotencyKey);
    const actorUserId = request.auth!.userId;
    const keyHash = inventoryIdempotencyKeyHash('transfer', actorUserId, normalizedKey);
    const fingerprint = inventoryRequestFingerprint({
      sourceInventoryItemId,
      destinationLocationId: input.destinationLocationId,
      quantity: input.quantity,
      expectedSourceVersion: input.expectedSourceVersion,
      note: input.note?.trim() || null,
    });
    const replay = await this.replayTransfer(keyHash, fingerprint);
    if (replay) return replay;
    const sourceSnapshot = await this.prisma.inventoryItem.findUnique({
      where: { id: sourceInventoryItemId },
      select: { id: true, locationId: true },
    });
    if (!sourceSnapshot) throw this.notFound('INVENTORY_ITEM_NOT_FOUND');
    if (sourceSnapshot.locationId === input.destinationLocationId) {
      throw new BadRequestException({
        code: 'INVENTORY_TRANSFER_SAME_LOCATION',
        message: 'Source and destination locations must be different.',
      });
    }

    try {
      const result = await this.prisma.$transaction(
        async (transaction) => {
          const locationIds = [sourceSnapshot.locationId, input.destinationLocationId].sort();
          await transaction.$queryRaw(
            Prisma.sql`SELECT id FROM InventoryLocation WHERE id IN (${Prisma.join(
              locationIds,
            )}) ORDER BY id FOR UPDATE`,
          );
          const activeLocations = await transaction.inventoryLocation.count({
            where: { id: { in: locationIds }, active: true },
          });
          if (activeLocations !== 2) {
            throw new BadRequestException({
              code: 'INVENTORY_TRANSFER_LOCATION_UNAVAILABLE',
              message: 'Both inventory locations must be active.',
            });
          }
          let source = await transaction.inventoryItem.findUnique({
            where: { id: sourceInventoryItemId },
          });
          if (!source) throw this.notFound('INVENTORY_ITEM_NOT_FOUND');
          let destination = await transaction.inventoryItem.findUnique({
            where: {
              variantId_locationId_lotKey: {
                variantId: source.variantId,
                locationId: input.destinationLocationId,
                lotKey: source.lotKey,
              },
            },
          });
          const itemIds = [source.id, ...(destination ? [destination.id] : [])].sort();
          await transaction.$queryRaw(
            Prisma.sql`SELECT id FROM InventoryItem WHERE id IN (${Prisma.join(
              itemIds,
            )}) ORDER BY id FOR UPDATE`,
          );
          source = (await transaction.inventoryItem.findUnique({ where: { id: source.id } }))!;
          if (source.version !== input.expectedSourceVersion) throw this.versionConflict();
          if (destination) {
            destination = await transaction.inventoryItem.findUnique({
              where: { id: destination.id },
            });
          }
          const reservationTotal = await transaction.stockReservation.aggregate({
            where: {
              inventoryItemId: source.id,
              state: 'ACTIVE',
              expiresAt: { gt: new Date() },
            },
            _sum: { quantity: true },
          });
          const reservedQuantity = reservationTotal._sum.quantity ?? 0;
          const calculated = calculateInventoryTransfer(
            source.onHandQuantity,
            reservedQuantity,
            destination?.onHandQuantity ?? 0,
            input.quantity,
          );
          const sourceOnHandAfter = calculated.sourceOnHandAfter;
          const sourceUpdated = await transaction.inventoryItem.updateMany({
            where: { id: source.id, version: input.expectedSourceVersion },
            data: { onHandQuantity: sourceOnHandAfter, version: { increment: 1 } },
          });
          if (sourceUpdated.count !== 1) throw this.versionConflict();
          if (destination) {
            destination = await transaction.inventoryItem.update({
              where: { id: destination.id },
              data: { onHandQuantity: { increment: input.quantity }, version: { increment: 1 } },
            });
          } else {
            destination = await transaction.inventoryItem.create({
              data: {
                variantId: source.variantId,
                locationId: input.destinationLocationId,
                batchId: source.batchId,
                lotKey: source.lotKey,
                onHandQuantity: input.quantity,
              },
            });
          }
          const note = input.note?.trim() || null;
          const sourceMovement = await transaction.stockMovement.create({
            data: {
              inventoryItemId: source.id,
              locationId: source.locationId,
              batchId: source.batchId,
              type: 'TRANSFER_OUT',
              quantityDelta: -input.quantity,
              onHandAfter: sourceOnHandAfter,
              referenceType: 'InventoryTransfer',
              reasonCode: 'LOCATION_TRANSFER',
              note,
              actorUserId,
              requestId: request.requestId,
              idempotencyKeyHash: inventoryIdempotencyKeyHash(
                'transfer-out',
                actorUserId,
                normalizedKey,
              ),
              requestFingerprint: fingerprint,
            },
          });
          const destinationMovement = await transaction.stockMovement.create({
            data: {
              inventoryItemId: destination.id,
              locationId: destination.locationId,
              batchId: destination.batchId,
              type: 'TRANSFER_IN',
              quantityDelta: input.quantity,
              onHandAfter: destination.onHandQuantity,
              referenceType: 'InventoryTransfer',
              reasonCode: 'LOCATION_TRANSFER',
              note,
              actorUserId,
              requestId: request.requestId,
              idempotencyKeyHash: inventoryIdempotencyKeyHash(
                'transfer-in',
                actorUserId,
                normalizedKey,
              ),
              requestFingerprint: fingerprint,
            },
          });
          const transfer = await transaction.inventoryTransfer.create({
            data: {
              sourceInventoryItemId: source.id,
              destinationInventoryItemId: destination.id,
              quantity: input.quantity,
              idempotencyKeyHash: keyHash,
              requestFingerprint: fingerprint,
              requestedBy: actorUserId,
              note,
              sourceMovementId: sourceMovement.id,
              destinationMovementId: destinationMovement.id,
            },
          });
          await transaction.stockMovement.updateMany({
            where: { id: { in: [sourceMovement.id, destinationMovement.id] } },
            data: { referenceId: transfer.id },
          });
          await transaction.auditLog.create({
            data: {
              ...requestMetadata(request),
              action: 'inventory.transfer.apply',
              resourceType: 'InventoryTransfer',
              resourceId: transfer.id,
              beforeSummary: {
                sourceInventoryItemId: source.id,
                sourceLocationId: source.locationId,
                sourceOnHandQuantity: source.onHandQuantity,
                sourceReservedQuantity: reservedQuantity,
              },
              afterSummary: {
                destinationInventoryItemId: destination.id,
                destinationLocationId: destination.locationId,
                quantity: input.quantity,
                sourceOnHandQuantity: sourceOnHandAfter,
                destinationOnHandQuantity: destination.onHandQuantity,
                sourceMovementId: sourceMovement.id,
                destinationMovementId: destinationMovement.id,
              },
            },
          });
          return this.transferResponse(transfer, sourceMovement, destinationMovement, false);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 },
      );
      return { data: result };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const racedReplay = await this.replayTransfer(keyHash, fingerprint);
        if (racedReplay) return racedReplay;
      }
      throw error;
    }
  }

  async transfers(query: InventoryTransferQueryDto) {
    const [records, total] = await this.prisma.$transaction([
      this.prisma.inventoryTransfer.findMany({
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          quantity: true,
          requestedBy: true,
          note: true,
          occurredAt: true,
          sourceMovement: {
            select: { id: true, quantityDelta: true, onHandAfter: true },
          },
          destinationMovement: {
            select: { id: true, quantityDelta: true, onHandAfter: true },
          },
          sourceInventoryItem: {
            select: {
              id: true,
              location: { select: { id: true, code: true, name: true } },
              variant: { select: { id: true, sku: true, nameFr: true, nameAr: true } },
              batch: { select: { id: true, batchNumber: true, expiryDate: true } },
            },
          },
          destinationInventoryItem: {
            select: {
              id: true,
              location: { select: { id: true, code: true, name: true } },
            },
          },
        },
      }),
      this.prisma.inventoryTransfer.count(),
    ]);
    return {
      data: {
        items: records.map((record) => ({
          ...record,
          occurredAt: record.occurredAt.toISOString(),
          sourceInventoryItem: {
            ...record.sourceInventoryItem,
            batch: record.sourceInventoryItem.batch
              ? {
                  ...record.sourceInventoryItem.batch,
                  expiryDate: record.sourceInventoryItem.batch.expiryDate?.toISOString() ?? null,
                }
              : null,
          },
        })),
        page: query.page,
        pageSize: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
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

  private requireIdempotencyKey(value: string | undefined): string {
    if (!value || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'A valid Idempotency-Key header is required.',
      });
    }
    return value;
  }

  private async replayBatchReceipt(keyHash: string, fingerprint: string) {
    const movement = await this.prisma.stockMovement.findUnique({
      where: { idempotencyKeyHash: keyHash },
      include: { batch: true, inventoryItem: { select: { version: true } } },
    });
    if (!movement) return null;
    if (movement.requestFingerprint !== fingerprint) throw this.idempotencyConflict();
    if (movement.type !== 'PURCHASE_RECEIPT' || !movement.batch) {
      throw new ConflictException({
        code: 'INVENTORY_IDEMPOTENCY_RECORD_INVALID',
        message: 'The idempotency record is not a compatible batch receipt.',
      });
    }
    return {
      data: this.batchReceiptResponse(
        movement.batch,
        movement,
        movement.inventoryItem.version,
        true,
      ),
    };
  }

  private batchReceiptResponse(
    batch: ProductBatch,
    movement: StockMovement,
    version: number,
    replayed: boolean,
  ) {
    return {
      batch: {
        id: batch.id,
        variantId: batch.variantId,
        supplierId: batch.supplierId,
        batchNumber: batch.batchNumber,
        supplierReference: batch.supplierReference,
        manufacturedAt: batch.manufacturedAt?.toISOString() ?? null,
        expiryDate: batch.expiryDate?.toISOString() ?? null,
        receivedAt: batch.receivedAt?.toISOString() ?? null,
      },
      inventoryItemId: movement.inventoryItemId,
      locationId: movement.locationId,
      quantityReceived: movement.quantityDelta,
      onHandQuantity: movement.onHandAfter,
      version,
      movementId: movement.id,
      replayed,
    };
  }

  private async replayTransfer(keyHash: string, fingerprint: string) {
    const transfer = await this.prisma.inventoryTransfer.findUnique({
      where: { idempotencyKeyHash: keyHash },
      include: { sourceMovement: true, destinationMovement: true },
    });
    if (!transfer) return null;
    if (transfer.requestFingerprint !== fingerprint) throw this.idempotencyConflict();
    return {
      data: this.transferResponse(
        transfer,
        transfer.sourceMovement,
        transfer.destinationMovement,
        true,
      ),
    };
  }

  private transferResponse(
    transfer: InventoryTransfer,
    sourceMovement: StockMovement,
    destinationMovement: StockMovement,
    replayed: boolean,
  ) {
    return {
      transferId: transfer.id,
      sourceInventoryItemId: transfer.sourceInventoryItemId,
      destinationInventoryItemId: transfer.destinationInventoryItemId,
      quantity: transfer.quantity,
      sourceMovementId: sourceMovement.id,
      destinationMovementId: destinationMovement.id,
      sourceOnHandQuantity: sourceMovement.onHandAfter,
      destinationOnHandQuantity: destinationMovement.onHandAfter,
      occurredAt: transfer.occurredAt.toISOString(),
      replayed,
    };
  }

  private idempotencyConflict(): ConflictException {
    return new ConflictException({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'This idempotency key was already used with a different request.',
    });
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
