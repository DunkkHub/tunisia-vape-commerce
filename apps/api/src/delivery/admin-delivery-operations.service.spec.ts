import { createHash } from 'node:crypto';
import { DeliveryStatus } from '@prisma/client';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../common/security/crypto.service';
import type { PrismaService } from '../database/prisma.service';
import { AdminDeliveryOperationsService } from './admin-delivery-operations.service';
import { DELIVERY_STATUS_CSV_HEADERS, DELIVERY_STATUS_CSV_SCHEMA } from './delivery-csv';

// Vitest's asymmetric matcher helpers are typed as `any`; keep that boundary in test helpers.
// eslint-disable-next-line @typescript-eslint/no-unsafe-return
const containing = <T extends object>(shape: T): T => expect.objectContaining(shape as never);
// eslint-disable-next-line @typescript-eslint/no-unsafe-return
const containingArray = <T>(items: T[]): T[] => expect.arrayContaining(items as never[]);

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

const courierRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'courier-1',
  code: 'BIZERTE-01',
  name: 'Ahmed Driver',
  companyName: 'Bizerte Express',
  status: 'ACTIVE' as const,
  availabilityStatus: 'AVAILABLE' as const,
  contactName: 'Ahmed Driver',
  phoneE164: '+21620111222',
  whatsappPhoneE164: '+21622123456',
  email: 'dispatch@example.test',
  defaultFeeMillimes: 8_000,
  maximumActiveDeliveries: 12,
  whatsappTemplate: 'Commande {{orderNumber}}',
  notes: 'Morning shift',
  createdAt: new Date('2026-08-04T09:00:00.000Z'),
  updatedAt: new Date('2026-08-04T10:00:00.000Z'),
  integrations: [
    { type: 'MANUAL' as const, name: 'Manual administrator operations', active: true },
  ],
  deliveryZones: [
    {
      deliveryZoneId: 'zone-1',
      active: true,
      feeMillimes: 7_500,
      createdAt: new Date('2026-08-04T09:00:00.000Z'),
      updatedAt: new Date('2026-08-04T09:00:00.000Z'),
      deliveryZone: {
        code: 'BIZERTE_EXPRESS',
        nameFr: 'Bizerte Express',
        nameAr: 'بنزرت السريع',
        active: true,
        supported: true,
        temporarilySuspended: false,
        _count: { localities: 4 },
      },
    },
  ],
  _count: { deliveries: 3, manifests: 1 },
  ...overrides,
});

describe('administrator delivery operational service', () => {
  it('searches and filters courier records and reports exact active workload', async () => {
    const findMany = vi.fn().mockResolvedValue([courierRecord()]);
    const prisma = {
      courier: { findMany, count: vi.fn().mockResolvedValue(1) },
      delivery: {
        groupBy: vi.fn().mockResolvedValue([{ courierId: 'courier-1', _count: { _all: 2 } }]),
      },
      $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
    } as unknown as PrismaService;
    const service = new AdminDeliveryOperationsService(prisma, crypto);

    const result = await service.listCourierRecords({
      page: 1,
      limit: 20,
      q: '  Bizerte   Express ',
      status: 'ACTIVE',
      availabilityStatus: 'AVAILABLE',
    });

    expect(result.data.items[0]).toMatchObject({
      id: 'courier-1',
      companyName: 'Bizerte Express',
      availabilityStatus: 'AVAILABLE',
      activeDeliveryCount: 2,
      coverageMode: 'ZONES',
      coverageZones: [
        expect.objectContaining({
          deliveryZoneId: 'zone-1',
          feeMillimes: 7_500,
          localityCount: 4,
        }),
      ],
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: containing({
          status: 'ACTIVE',
          availabilityStatus: 'AVAILABLE',
          OR: containingArray([
            { companyName: { contains: 'Bizerte Express' } },
            { whatsappPhoneE164: { contains: 'Bizerte Express' } },
          ]),
        }),
      }),
    );
  });

  it('creates a credential-free courier with validated zone coverage and internal fees', async () => {
    const created = courierRecord();
    const transaction = {
      deliveryZone: { findMany: vi.fn().mockResolvedValue([{ id: 'zone-1' }]) },
      courier: { create: vi.fn().mockResolvedValue(created) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    } as unknown as PrismaService;
    const service = new AdminDeliveryOperationsService(prisma, crypto);

    await service.createManualCourier(
      {
        code: 'bizerte-01',
        name: ' Ahmed Driver ',
        companyName: ' Bizerte Express ',
        phoneE164: '+21620111222',
        whatsappPhoneE164: '+21622123456',
        defaultFeeMillimes: 8_000,
        maximumActiveDeliveries: 12,
        whatsappTemplate: 'Commande {{orderNumber}}',
        coverageZones: [{ deliveryZoneId: 'zone-1', feeMillimes: 7_500 }],
        confirmation: 'CREATE_MANUAL_COURIER',
      },
      request,
    );

    expect(transaction.courier.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({
          code: 'BIZERTE-01',
          name: 'Ahmed Driver',
          companyName: 'Bizerte Express',
          availabilityStatus: 'AVAILABLE',
          defaultFeeMillimes: 8_000,
          maximumActiveDeliveries: 12,
          integrations: {
            create: containing({ type: 'MANUAL', active: true }),
          },
          deliveryZones: {
            create: [{ deliveryZoneId: 'zone-1', active: true, feeMillimes: 7_500 }],
          },
        }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });

  it('rejects a Tunisian-invalid effective WhatsApp number before creating a courier', async () => {
    const transaction = {
      deliveryZone: { findMany: vi.fn().mockResolvedValue([]) },
      courier: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    } as unknown as PrismaService;
    const service = new AdminDeliveryOperationsService(prisma, crypto);

    await expect(
      service.createManualCourier(
        {
          code: 'INVALID-PHONE',
          name: 'Invalid phone courier',
          whatsappPhoneE164: '+21612345678',
          confirmation: 'CREATE_MANUAL_COURIER',
        },
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'COURIER_WHATSAPP_PHONE_INVALID' } });
    expect(transaction.courier.create).not.toHaveBeenCalled();
  });

  it('optimistically edits availability, capacity, coverage and zone-specific cost', async () => {
    const current = courierRecord();
    const updated = courierRecord({
      availabilityStatus: 'OFF_DUTY',
      maximumActiveDeliveries: 20,
      deliveryZones: [
        {
          ...courierRecord().deliveryZones[0],
          feeMillimes: 6_500,
        },
      ],
      updatedAt: new Date('2026-08-04T10:05:00.000Z'),
    });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'courier-1' }]),
      deliveryZone: { findMany: vi.fn().mockResolvedValue([{ id: 'zone-1' }]) },
      courier: {
        findUnique: vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(updated),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      courierDeliveryZone: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      delivery: { count: vi.fn().mockResolvedValue(2) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    } as unknown as PrismaService;
    const service = new AdminDeliveryOperationsService(prisma, crypto);

    await service.updateManualCourier(
      'courier-1',
      {
        expectedUpdatedAt: current.updatedAt.toISOString(),
        availabilityStatus: 'OFF_DUTY',
        maximumActiveDeliveries: 20,
        coverageZones: [{ deliveryZoneId: 'zone-1', feeMillimes: 6_500 }],
        confirmation: 'UPDATE_MANUAL_COURIER',
      },
      request,
    );

    expect(transaction.courier.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'courier-1', updatedAt: current.updatedAt },
        data: containing({
          availabilityStatus: 'OFF_DUTY',
          maximumActiveDeliveries: 20,
        }),
      }),
    );
    expect(transaction.courierDeliveryZone.deleteMany).toHaveBeenCalledWith({
      where: { courierId: 'courier-1' },
    });
    expect(transaction.courierDeliveryZone.createMany).toHaveBeenCalledWith({
      data: [
        {
          courierId: 'courier-1',
          deliveryZoneId: 'zone-1',
          active: true,
          feeMillimes: 6_500,
        },
      ],
    });
  });

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
