import { createHash } from 'node:crypto';
import { DeliveryStatus } from '@prisma/client';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../common/security/crypto.service';
import type { PrismaService } from '../database/prisma.service';
import { AdminDeliveryOperationsService } from './admin-delivery-operations.service';
import { DELIVERY_STATUS_CSV_HEADERS, DELIVERY_STATUS_CSV_SCHEMA } from './delivery-csv';

const request = {
  auth: { userId: 'admin-id' },
  requestId: 'request-id',
  ip: '127.0.0.1',
  socket: {},
  get: vi.fn().mockReturnValue('vitest'),
} as unknown as Request;

const crypto = {
  hashToken: vi.fn().mockReturnValue('a'.repeat(64)),
  encrypt: vi.fn().mockReturnValue('encrypted-recipient'),
} as unknown as CryptoService;

const statusCsv = (target = 'READY_FOR_PICKUP') =>
  `${DELIVERY_STATUS_CSV_HEADERS.join(',')}\r\n${DELIVERY_STATUS_CSV_SCHEMA},delivery-1,4,PREPARING,${target},CSV_READY,Picked and checked,TN-1,,,12000,true,2026-07-20T10:00:00.000Z\r\n`;

const delivery = {
  id: 'delivery-1',
  orderId: 'order-1',
  courierId: null,
  status: DeliveryStatus.PREPARING,
  version: 4,
  order: {
    id: 'order-1',
    orderNumber: 'TN-1',
    status: DeliveryStatus.PREPARING,
    version: 6,
    deliveryMethodType: 'COURIER',
  },
  manifestItems: [],
};

describe('administrator delivery operational service', () => {
  it('persists a dry-run receipt without mutating order or delivery status', async () => {
    const transaction = {
      delivery: { findMany: vi.fn().mockResolvedValue([delivery]), updateMany: vi.fn() },
      order: { updateMany: vi.fn() },
      deliveryStatusImport: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const transactionRunner = vi.fn((callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    );
    const prisma = {
      deliveryStatusImport: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: transactionRunner,
    } as unknown as PrismaService;
    const service = new AdminDeliveryOperationsService(prisma, crypto);

    await expect(
      service.importStatusCsv(
        { importKey: 'dry-run-001', dryRun: true, csv: statusCsv() },
        request,
      ),
    ).resolves.toMatchObject({
      data: { valid: true, applied: false, appliedCount: 0, replayed: false },
    });
    expect(transaction.delivery.updateMany).not.toHaveBeenCalled();
    expect(transaction.order.updateMany).not.toHaveBeenCalled();
    expect(transaction.deliveryStatusImport.create).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });

  it('replays an identical applied import without executing another transaction', async () => {
    const csv = statusCsv();
    const storedResult = {
      schemaVersion: 'DELIVERY_STATUS_V1',
      importKey: 'apply-001',
      dryRun: false,
      valid: true,
      applied: true,
      rowCount: 1,
      appliedCount: 1,
      rows: [],
    };
    const transactionRunner = vi.fn();
    const prisma = {
      deliveryStatusImport: {
        findUnique: vi.fn().mockResolvedValue({
          payloadHash: createHash('sha256').update(csv, 'utf8').digest('hex'),
          result: storedResult,
        }),
      },
      $transaction: transactionRunner,
    } as unknown as PrismaService;
    const service = new AdminDeliveryOperationsService(prisma, crypto);

    await expect(
      service.importStatusCsv(
        {
          importKey: 'apply-001',
          dryRun: false,
          csv,
          confirmation: 'APPLY_DELIVERY_STATUS_IMPORT',
        },
        request,
      ),
    ).resolves.toEqual({ data: { ...storedResult, replayed: true } });
    expect(transactionRunner).not.toHaveBeenCalled();
  });

  it('rejects reuse of an import key with different content', async () => {
    const transactionRunner = vi.fn();
    const prisma = {
      deliveryStatusImport: {
        findUnique: vi.fn().mockResolvedValue({ payloadHash: 'different-hash', result: {} }),
      },
      $transaction: transactionRunner,
    } as unknown as PrismaService;
    const service = new AdminDeliveryOperationsService(prisma, crypto);

    await expect(
      service.importStatusCsv(
        { importKey: 'dry-run-001', dryRun: true, csv: statusCsv() },
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'DELIVERY_IMPORT_KEY_REUSED' } });
    expect(transactionRunner).not.toHaveBeenCalled();
  });
});
