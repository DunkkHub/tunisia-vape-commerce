import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  AdminCashReconciliationListResponseDto,
  AdminCommerceListQueryDto,
  AdminCustomerListResponseDto,
  AdminDeliveryListResponseDto,
  AdminOrderListResponseDto,
} from './dto/admin-commerce-list.dto';

type Locale = 'fr' | 'ar';

const normalizedSearch = (query: AdminCommerceListQueryDto): string | undefined => {
  const search = query.q?.trim().replace(/\s+/g, ' ');
  return search ? search : undefined;
};

const pageResult = <T>(items: T[], query: AdminCommerceListQueryDto, total: number) => ({
  items,
  page: query.page,
  pageSize: query.limit,
  total,
  totalPages: Math.ceil(total / query.limit),
});

@Injectable()
export class AdminCommerceReadsService {
  constructor(private readonly prisma: PrismaService) {}

  async listOrders(query: AdminCommerceListQueryDto): Promise<AdminOrderListResponseDto> {
    const search = normalizedSearch(query);
    const where = {
      ...(search
        ? {
            OR: [
              { orderNumber: { contains: search } },
              { customerNameSnapshot: { contains: search } },
              { customerPhoneSnapshot: { contains: search } },
              { customerEmailSnapshot: { contains: search } },
            ],
          }
        : {}),
    } satisfies Prisma.OrderWhereInput;
    const [records, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          orderNumber: true,
          customerNameSnapshot: true,
          status: true,
          grandTotalMillimes: true,
          createdAt: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: pageResult(
        records.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerNameSnapshot,
          status: order.status,
          grandTotalMillimes: order.grandTotalMillimes,
          createdAt: order.createdAt.toISOString(),
        })),
        query,
        total,
      ),
    };
  }

  async listCustomers(query: AdminCommerceListQueryDto): Promise<AdminCustomerListResponseDto> {
    const search = normalizedSearch(query);
    const where = {
      user: { is: { audience: 'CUSTOMER', deletedAt: null } },
      ...(search
        ? {
            OR: [
              { firstName: { contains: search } },
              { lastName: { contains: search } },
              { phoneE164: { contains: search } },
              { phoneSearch: { contains: search } },
              { user: { is: { emailNormalized: { contains: search } } } },
            ],
          }
        : {}),
    } satisfies Prisma.CustomerProfileWhereInput;
    const [records, total] = await this.prisma.$transaction([
      this.prisma.customerProfile.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneE164: true,
          createdAt: true,
          user: { select: { status: true } },
        },
      }),
      this.prisma.customerProfile.count({ where }),
    ]);

    return {
      data: pageResult(
        records.map((customer) => ({
          id: customer.id,
          fullName: `${customer.firstName} ${customer.lastName}`.trim(),
          normalizedPhone: customer.phoneE164,
          status: customer.user.status,
          createdAt: customer.createdAt.toISOString(),
        })),
        query,
        total,
      ),
    };
  }

  async listDeliveries(
    query: AdminCommerceListQueryDto,
    locale: Locale,
  ): Promise<AdminDeliveryListResponseDto> {
    const search = normalizedSearch(query);
    const where = {
      ...(search
        ? {
            OR: [
              { trackingNumber: { contains: search } },
              { order: { is: { orderNumber: { contains: search } } } },
              { order: { is: { customerNameSnapshot: { contains: search } } } },
              { courier: { is: { name: { contains: search } } } },
              { order: { is: { deliveryZone: { is: { nameFr: { contains: search } } } } } },
              { order: { is: { deliveryZone: { is: { nameAr: { contains: search } } } } } },
            ],
          }
        : {}),
    } satisfies Prisma.DeliveryWhereInput;
    const [records, total] = await this.prisma.$transaction([
      this.prisma.delivery.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          trackingNumber: true,
          status: true,
          courier: { select: { name: true } },
          order: {
            select: {
              orderNumber: true,
              deliveryZone: { select: { nameFr: true, nameAr: true } },
            },
          },
        },
      }),
      this.prisma.delivery.count({ where }),
    ]);

    return {
      data: pageResult(
        records.map((delivery) => ({
          id: delivery.id,
          trackingNumber: delivery.trackingNumber ?? delivery.order.orderNumber,
          zoneName:
            locale === 'ar'
              ? (delivery.order.deliveryZone?.nameAr ?? null)
              : (delivery.order.deliveryZone?.nameFr ?? null),
          courierName: delivery.courier?.name ?? null,
          status: delivery.status,
        })),
        query,
        total,
      ),
    };
  }

  async listCashReconciliations(
    query: AdminCommerceListQueryDto,
  ): Promise<AdminCashReconciliationListResponseDto> {
    const search = normalizedSearch(query);
    const where = {
      ...(search
        ? {
            OR: [
              { remittanceNumber: { contains: search } },
              { courier: { is: { name: { contains: search } } } },
            ],
          }
        : {}),
    } satisfies Prisma.CashRemittanceWhereInput;
    const [records, total] = await this.prisma.$transaction([
      this.prisma.cashRemittance.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          status: true,
          declaredMillimes: true,
          verifiedMillimes: true,
          remittedAt: true,
          courier: { select: { name: true } },
        },
      }),
      this.prisma.cashRemittance.count({ where }),
    ]);
    const allocationSums = records.length
      ? await this.prisma.cashRemittanceItem.groupBy({
          by: ['remittanceId'],
          where: { remittanceId: { in: records.map(({ id }) => id) } },
          _sum: { amountMillimes: true },
        })
      : [];
    const expectedByRemittance = new Map(
      allocationSums.map((allocation) => [
        allocation.remittanceId,
        allocation._sum.amountMillimes ?? 0,
      ]),
    );

    return {
      data: pageResult(
        records.map((remittance) => ({
          id: remittance.id,
          courierName: remittance.courier.name,
          expectedMillimes: expectedByRemittance.get(remittance.id) ?? 0,
          remittedMillimes:
            remittance.verifiedMillimes ??
            (remittance.remittedAt === null ? 0 : remittance.declaredMillimes),
          status: remittance.status,
        })),
        query,
        total,
      ),
    };
  }
}
