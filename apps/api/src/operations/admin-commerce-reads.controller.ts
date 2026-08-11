import { Controller, Get, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { requestLocale } from '../compliance/age-gate.service';
import { AdminCommerceReadsService } from './admin-commerce-reads.service';
import {
  AdminCashReconciliationListResponseDto,
  AdminCommerceListQueryDto,
  AdminCustomerListResponseDto,
  AdminDeliveryListQueryDto,
  AdminDeliveryListResponseDto,
  AdminOrderListResponseDto,
} from './dto/admin-commerce-list.dto';

@ApiTags('administrator-operations')
@ApiCookieAuth('admin')
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminCommerceReadsController {
  constructor(private readonly reads: AdminCommerceReadsService) {}

  @Get('orders')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'List orders for administrator operations' })
  @ApiOkResponse({ type: AdminOrderListResponseDto })
  orders(@Query() query: AdminCommerceListQueryDto) {
    return this.reads.listOrders(query);
  }

  @Get('customers')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'List minimized customer records for administrator operations' })
  @ApiOkResponse({ type: AdminCustomerListResponseDto })
  customers(@Query() query: AdminCommerceListQueryDto) {
    return this.reads.listCustomers(query);
  }

  @Get('deliveries')
  @RequirePermissions('deliveries.read')
  @ApiOperation({ summary: 'List delivery assignments for administrator operations' })
  @ApiOkResponse({ type: AdminDeliveryListResponseDto })
  deliveries(@Query() query: AdminDeliveryListQueryDto, @Req() request: Request) {
    return this.reads.listDeliveries(query, requestLocale(request));
  }

  @Get('cash/reconciliations')
  @RequirePermissions('cash.read')
  @ApiOperation({ summary: 'List COD remittance reconciliation summaries' })
  @ApiOkResponse({ type: AdminCashReconciliationListResponseDto })
  cashReconciliations(@Query() query: AdminCommerceListQueryDto) {
    return this.reads.listCashReconciliations(query);
  }
}
