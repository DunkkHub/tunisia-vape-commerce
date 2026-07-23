import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import type { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSIONS_METADATA } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import type { PrismaService } from '../database/prisma.service';
import { AdminCommerceReadsController } from './admin-commerce-reads.controller';
import { AdminCommerceReadsService } from './admin-commerce-reads.service';
import { AdminCommerceListQueryDto } from './dto/admin-commerce-list.dto';

const arrayTransaction = vi.fn(async (operations: Array<Promise<unknown>>) =>
  Promise.all(operations),
);

describe('AdminCommerceReadsService', () => {
  it('returns the exact bounded order table contract and normalizes search', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'order-1',
        orderNumber: 'CMD-0001',
        customerNameSnapshot: 'Amina Ben Salah',
        status: 'CONFIRMED' as const,
        grandTotalMillimes: 42_500,
        createdAt: new Date('2026-07-12T09:00:00.000Z'),
      },
    ]);
    const prisma = {
      order: { findMany, count: vi.fn().mockResolvedValue(1) },
      $transaction: arrayTransaction,
    } as unknown as PrismaService;
    const service = new AdminCommerceReadsService(prisma);

    await expect(service.listOrders({ page: 2, limit: 10, q: '  CMD   0001  ' })).resolves.toEqual({
      data: {
        items: [
          {
            id: 'order-1',
            orderNumber: 'CMD-0001',
            customerName: 'Amina Ben Salah',
            status: 'CONFIRMED',
            grandTotalMillimes: 42_500,
            createdAt: '2026-07-12T09:00:00.000Z',
          },
        ],
        page: 2,
        pageSize: 10,
        total: 1,
        totalPages: 1,
      },
    });
    const input = findMany.mock.calls[0]?.[0] as {
      skip: number;
      take: number;
      where: { OR: Array<Record<string, unknown>> };
    };
    expect(input.skip).toBe(10);
    expect(input.take).toBe(10);
    expect(input.where.OR).toHaveLength(4);
    expect(input.where.OR[0]).toEqual({ orderNumber: { contains: 'CMD 0001' } });
  });

  it('returns only the bounded customer-management table contract', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'customer-1',
        firstName: 'Sami',
        lastName: 'Trabelsi',
        phoneE164: '+21620111222',
        createdAt: new Date('2026-07-11T08:00:00.000Z'),
        suspendedAt: null,
        suspensionReason: null,
        version: 2,
        user: {
          id: 'customer-user-1',
          email: 'sami@example.test',
          status: 'ACTIVE' as const,
          version: 3,
        },
      },
    ]);
    const prisma = {
      customerProfile: { findMany, count: vi.fn().mockResolvedValue(1) },
      $transaction: arrayTransaction,
    } as unknown as PrismaService;
    const service = new AdminCommerceReadsService(prisma);

    const result = await service.listCustomers({ page: 1, limit: 20 });

    expect(result).toEqual({
      data: {
        items: [
          {
            id: 'customer-1',
            userId: 'customer-user-1',
            fullName: 'Sami Trabelsi',
            normalizedPhone: '+21620111222',
            email: 'sami@example.test',
            status: 'ACTIVE',
            suspendedAt: null,
            suspensionReason: null,
            userVersion: 3,
            profileVersion: 2,
            createdAt: '2026-07-11T08:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user: { is: { audience: 'CUSTOMER', deletedAt: null } } },
      }),
    );
  });

  it('localizes delivery zones and uses the order number before tracking assignment', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'delivery-1',
        trackingNumber: null,
        status: 'ASSIGNED_TO_COURIER' as const,
        courier: { name: 'Courrier Tunis' },
        order: {
          orderNumber: 'CMD-0002',
          deliveryZone: { nameFr: 'Grand Tunis', nameAr: 'تونس الكبرى' },
        },
      },
    ]);
    const prisma = {
      delivery: { findMany, count: vi.fn().mockResolvedValue(1) },
      $transaction: arrayTransaction,
    } as unknown as PrismaService;
    const service = new AdminCommerceReadsService(prisma);

    const result = await service.listDeliveries({ page: 1, limit: 20 }, 'ar');

    expect(result.data.items).toEqual([
      {
        id: 'delivery-1',
        trackingNumber: 'CMD-0002',
        zoneName: 'تونس الكبرى',
        courierName: 'Courrier Tunis',
        status: 'ASSIGNED_TO_COURIER',
      },
    ]);
  });

  it('aggregates expected allocations without loading unbounded ledger items', async () => {
    const groupBy = vi
      .fn()
      .mockResolvedValue([{ remittanceId: 'remittance-1', _sum: { amountMillimes: 70_000 } }]);
    const prisma = {
      cashRemittance: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'remittance-1',
            status: 'VERIFIED' as const,
            declaredMillimes: 68_000,
            verifiedMillimes: 67_500,
            remittedAt: new Date('2026-07-12T10:00:00.000Z'),
            courier: { name: 'Courrier Sahel' },
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
      cashRemittanceItem: { groupBy },
      $transaction: arrayTransaction,
    } as unknown as PrismaService;
    const service = new AdminCommerceReadsService(prisma);

    const result = await service.listCashReconciliations({ page: 1, limit: 20 });

    expect(result.data.items).toEqual([
      {
        id: 'remittance-1',
        courierName: 'Courrier Sahel',
        expectedMillimes: 70_000,
        remittedMillimes: 67_500,
        status: 'VERIFIED',
      },
    ]);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['remittanceId'],
      where: { remittanceId: { in: ['remittance-1'] } },
      _sum: { amountMillimes: true },
    });
  });
});

describe('administrator commerce read access policy', () => {
  it('binds the admin realm, no-store response policy, and exact seeded permissions', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminCommerceReadsController)).toEqual([
      AdminSessionGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, AdminCommerceReadsController)).toEqual([
      NoStoreInterceptor,
    ]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const orders = AdminCommerceReadsController.prototype.orders;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const customers = AdminCommerceReadsController.prototype.customers;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const deliveries = AdminCommerceReadsController.prototype.deliveries;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const cash = AdminCommerceReadsController.prototype.cashReconciliations;
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, orders)).toEqual(['orders.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, customers)).toEqual(['customers.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, deliveries)).toEqual(['deliveries.read']);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA, cash)).toEqual(['cash.read']);
  });

  it('denies an authenticated administrator without the endpoint permission', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(['orders.read']),
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    const context = {
      getHandler: () => () => undefined,
      getClass: () => AdminCommerceReadsController,
      switchToHttp: () => ({ getRequest: () => ({ auth: { permissions: ['customers.read'] } }) }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});

describe('AdminCommerceListQueryDto', () => {
  it('rejects a page size above the hard maximum of 50', async () => {
    const input = plainToInstance(AdminCommerceListQueryDto, { page: '1', limit: '51' });
    const errors = await validate(input);
    expect(errors.some(({ property }) => property === 'limit')).toBe(true);
  });
});
