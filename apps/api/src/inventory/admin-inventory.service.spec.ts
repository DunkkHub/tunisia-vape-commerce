import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import {
  AdminInventoryService,
  calculateInventoryAdjustment,
  calculateInventoryTransfer,
  inventoryRequestFingerprint,
} from './admin-inventory.service';
import { CreateBatchReceiptDto, CreateInventoryLocationDto } from './dto/admin-inventory.dto';

describe('inventory adjustment calculation', () => {
  it('calculates additions, removals, and exact stock corrections using integers', () => {
    expect(calculateInventoryAdjustment(5, 'ADD', 3)).toEqual({
      quantityDelta: 3,
      onHandAfter: 8,
    });
    expect(calculateInventoryAdjustment(5, 'REMOVE', 2)).toEqual({
      quantityDelta: -2,
      onHandAfter: 3,
    });
    expect(calculateInventoryAdjustment(5, 'SET', undefined, 1)).toEqual({
      quantityDelta: -4,
      onHandAfter: 1,
    });
  });

  it('rejects negative physical stock and zero corrections', () => {
    expect(() => calculateInventoryAdjustment(1, 'REMOVE', 2)).toThrow(ConflictException);
    expect(() => calculateInventoryAdjustment(1, 'SET', undefined, 1)).toThrow(BadRequestException);
  });

  it('rejects ambiguous operation payloads', () => {
    expect(() => calculateInventoryAdjustment(2, 'ADD', undefined)).toThrow(BadRequestException);
    expect(() => calculateInventoryAdjustment(2, 'SET', 1, 4)).toThrow(BadRequestException);
  });
});

describe('inventory location input', () => {
  it('rejects a whitespace-only location name', () => {
    const input = plainToInstance(CreateInventoryLocationDto, {
      code: 'WAREHOUSE_1',
      name: '   ',
    });

    expect(validateSync(input).some((error) => error.property === 'name')).toBe(true);
  });
});

describe('inventory operation inputs and replay fingerprint', () => {
  it('requires a real future expiry date for a batch receipt payload shape', () => {
    const input = plainToInstance(CreateBatchReceiptDto, {
      variantId: 'variant_1',
      locationId: 'location_1',
      batchNumber: 'LOT-2026-07',
      expiryDate: 'not-a-date',
      quantity: 10,
    });

    expect(validateSync(input).some((error) => error.property === 'expiryDate')).toBe(true);
  });

  it('canonicalizes object keys while preserving meaningful request changes', () => {
    expect(inventoryRequestFingerprint({ quantity: 2, location: 'b' })).toBe(
      inventoryRequestFingerprint({ location: 'b', quantity: 2 }),
    );
    expect(inventoryRequestFingerprint({ quantity: 2 })).not.toBe(
      inventoryRequestFingerprint({ quantity: 3 }),
    );
  });

  it('prevents a transfer from consuming reservations or overflowing its destination', () => {
    expect(calculateInventoryTransfer(8, 2, 3, 4)).toEqual({
      sourceOnHandAfter: 4,
      destinationOnHandAfter: 7,
    });
    expect(() => calculateInventoryTransfer(5, 4, 0, 2)).toThrow(ConflictException);
    expect(() => calculateInventoryTransfer(5, 0, 2_147_483_647, 1)).toThrow(ConflictException);
  });
});

const adminRequest = (userId: string): Request =>
  ({
    auth: { userId },
    requestId: 'request_inventory_test',
    get: () => undefined,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as Request;

describe('inventory adjustment dual control', () => {
  it('rejects positive opening stock so receipts cannot bypass traceable intake', async () => {
    const service = new AdminInventoryService({} as PrismaService);

    await expect(
      service.createItem(
        {
          variantId: 'variant_1',
          locationId: 'location_1',
          initialQuantity: 1,
        },
        adminRequest('admin_requester'),
      ),
    ).rejects.toMatchObject({ response: { code: 'INITIAL_STOCK_RECEIPT_REQUIRED' } });
  });

  it('rejects purchase receipt disguised as a manual adjustment', async () => {
    const service = new AdminInventoryService({} as PrismaService);

    await expect(
      service.adjust(
        'item_1',
        {
          operation: 'ADD',
          quantity: 1,
          reasonCode: 'PURCHASE_RECEIPT',
          expectedVersion: 1,
        },
        adminRequest('admin_requester'),
      ),
    ).rejects.toMatchObject({ response: { code: 'BATCH_RECEIPT_REQUIRED' } });
  });

  it('records a pending request without changing stock or creating a movement', async () => {
    const updateMany = vi.fn();
    const movementCreate = vi.fn();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'item_1' }]),
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'item_1',
          locationId: 'location_1',
          batchId: null,
          onHandQuantity: 8,
          version: 4,
        }),
        updateMany,
      },
      stockReservation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 1 } }),
      },
      stockMovement: { create: movementCreate },
      inventoryAdjustment: {
        create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          id: 'adjustment_1',
          ...data,
        })),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((work: (client: typeof transaction) => unknown) => work(transaction)),
    } as unknown as PrismaService;
    const service = new AdminInventoryService(prisma);

    const response = await service.adjust(
      'item_1',
      {
        operation: 'REMOVE',
        quantity: 2,
        reasonCode: 'DAMAGE',
        expectedVersion: 4,
      },
      adminRequest('admin_requester'),
    );

    expect(response.data).toMatchObject({
      status: 'PENDING_APPROVAL',
      requiresApproval: true,
      currentOnHandQuantity: 8,
      proposedOnHandQuantity: 6,
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(movementCreate).not.toHaveBeenCalled();
  });

  it('rejects a requested reduction below active reservations before queuing it', async () => {
    const adjustmentCreate = vi.fn();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'item_1' }]),
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'item_1',
          locationId: 'location_1',
          batchId: null,
          onHandQuantity: 3,
          version: 2,
        }),
      },
      stockReservation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 3 } }),
      },
      inventoryAdjustment: { create: adjustmentCreate },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((work: (client: typeof transaction) => unknown) => work(transaction)),
    } as unknown as PrismaService;
    const service = new AdminInventoryService(prisma);

    await expect(
      service.adjust(
        'item_1',
        {
          operation: 'REMOVE',
          quantity: 1,
          reasonCode: 'DAMAGE',
          expectedVersion: 2,
        },
        adminRequest('admin_requester'),
      ),
    ).rejects.toMatchObject({
      response: { code: 'INVENTORY_RESERVED_QUANTITY_CONFLICT' },
    });
    expect(adjustmentCreate).not.toHaveBeenCalled();
  });

  it('forbids a requester from approving their own pending adjustment', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'adjustment_1' }]),
      inventoryAdjustment: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'adjustment_1',
          inventoryItemId: 'item_1',
          requestedBy: 'admin_requester',
          status: 'PENDING_APPROVAL',
        }),
      },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((work: (client: typeof transaction) => unknown) => work(transaction)),
    } as unknown as PrismaService;
    const service = new AdminInventoryService(prisma);

    await expect(
      service.decideAdjustment(
        'adjustment_1',
        { decision: 'APPROVE' },
        adminRequest('admin_requester'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechecks reservations during approval and leaves stock unchanged on conflict', async () => {
    const itemUpdate = vi.fn();
    const movementCreate = vi.fn();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
      inventoryAdjustment: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'adjustment_1',
          inventoryItemId: 'item_1',
          quantityDelta: -1,
          reasonCode: 'DAMAGE',
          note: null,
          requestedBy: 'admin_requester',
          status: 'PENDING_APPROVAL',
          expectedVersion: 2,
          onHandBefore: 3,
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        }),
      },
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'item_1',
          locationId: 'location_1',
          batchId: null,
          onHandQuantity: 3,
          version: 2,
        }),
        updateMany: itemUpdate,
      },
      stockReservation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 3 } }),
      },
      stockMovement: { create: movementCreate },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((work: (client: typeof transaction) => unknown) => work(transaction)),
    } as unknown as PrismaService;
    const service = new AdminInventoryService(prisma);

    await expect(
      service.decideAdjustment(
        'adjustment_1',
        { decision: 'APPROVE' },
        adminRequest('admin_approver'),
      ),
    ).rejects.toMatchObject({
      response: { code: 'INVENTORY_RESERVED_QUANTITY_CONFLICT' },
    });
    expect(itemUpdate).not.toHaveBeenCalled();
    expect(movementCreate).not.toHaveBeenCalled();
  });

  it('rejects reuse of a receipt idempotency key with a changed payload', async () => {
    const prisma = {
      stockMovement: {
        findUnique: vi.fn().mockResolvedValue({ requestFingerprint: 'different-fingerprint' }),
      },
    } as unknown as PrismaService;
    const service = new AdminInventoryService(prisma);

    await expect(
      service.receiveBatch(
        {
          variantId: 'variant_1',
          locationId: 'location_1',
          batchNumber: 'LOT-2099',
          expiryDate: '2099-12-31',
          quantity: 5,
        },
        'receipt_key_123456789',
        adminRequest('admin_requester'),
      ),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });
});
