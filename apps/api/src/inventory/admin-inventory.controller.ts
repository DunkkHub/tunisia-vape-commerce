import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { AdminInventoryService } from './admin-inventory.service';
import {
  ApplyInventoryAdjustmentDto,
  CreateBatchReceiptDto,
  CreateInventoryItemDto,
  CreateInventoryLocationDto,
  DecideInventoryAdjustmentDto,
  InventoryAdjustmentIdParametersDto,
  InventoryAdjustmentQueryDto,
  InventoryItemIdParametersDto,
  InventoryMovementQueryDto,
  InventoryTransferQueryDto,
  InventoryVariantIdParametersDto,
  TransferInventoryDto,
  UpdateLowStockThresholdDto,
} from './dto/admin-inventory.dto';

@ApiTags('administrator-inventory')
@ApiCookieAuth('admin')
@Controller('admin/inventory')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminInventoryController {
  constructor(private readonly inventory: AdminInventoryService) {}

  @Get('locations')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'List active inventory locations for stock intake' })
  locations() {
    return this.inventory.locations();
  }

  @Post('locations')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('inventory.adjust')
  @ApiOperation({ summary: 'Create an audited active inventory location' })
  createLocation(@Body() input: CreateInventoryLocationDto, @Req() request: Request) {
    return this.inventory.createLocation(input, request);
  }

  @Post('items')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('inventory.adjust')
  @ApiOperation({ summary: 'Create an audited empty inventory bucket before traceable intake' })
  createItem(@Body() input: CreateInventoryItemDto, @Req() request: Request) {
    return this.inventory.createItem(input, request);
  }

  @Post('batches/receipts')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('inventory.adjust')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'An administrator-scoped opaque key containing 16 to 128 safe ASCII characters.',
  })
  @ApiOperation({ summary: 'Receive an expiring product batch into one active location' })
  receiveBatch(
    @Body() input: CreateBatchReceiptDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    return this.inventory.receiveBatch(input, idempotencyKey, request);
  }

  @Get('variants/:variantId')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Read physical, reserved, and available stock buckets for a variant' })
  getVariant(@Param() parameters: InventoryVariantIdParametersDto) {
    return this.inventory.getVariant(parameters.variantId);
  }

  @Get('items/:id/movements')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Read the immutable movement history for one inventory item' })
  movements(
    @Param() parameters: InventoryItemIdParametersDto,
    @Query() query: InventoryMovementQueryDto,
  ) {
    return this.inventory.movements(parameters.id, query);
  }

  @Post('items/:id/adjustments')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('inventory.adjust')
  @ApiOperation({ summary: 'Request a reservation-safe manual stock adjustment for approval' })
  adjust(
    @Param() parameters: InventoryItemIdParametersDto,
    @Body() input: ApplyInventoryAdjustmentDto,
    @Req() request: Request,
  ) {
    return this.inventory.adjust(parameters.id, input, request);
  }

  @Get('adjustments')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Read the bounded inventory adjustment approval queue' })
  adjustments(@Query() query: InventoryAdjustmentQueryDto) {
    return this.inventory.adjustments(query);
  }

  @Post('adjustments/:id/decision')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('inventory.approve')
  @ApiOperation({ summary: 'Approve and atomically apply, or reject, a manual adjustment' })
  decideAdjustment(
    @Param() parameters: InventoryAdjustmentIdParametersDto,
    @Body() input: DecideInventoryAdjustmentDto,
    @Req() request: Request,
  ) {
    return this.inventory.decideAdjustment(parameters.id, input, request);
  }

  @Post('items/:id/transfers')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('inventory.transfer')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'An administrator-scoped opaque key containing 16 to 128 safe ASCII characters.',
  })
  @ApiOperation({ summary: 'Atomically transfer one lot between active inventory locations' })
  transfer(
    @Param() parameters: InventoryItemIdParametersDto,
    @Body() input: TransferInventoryDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    return this.inventory.transfer(parameters.id, input, idempotencyKey, request);
  }

  @Get('transfers')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'Read bounded immutable stock transfer records' })
  transfers(@Query() query: InventoryTransferQueryDto) {
    return this.inventory.transfers(query);
  }

  @Patch('variants/:variantId/low-stock-threshold')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('inventory.adjust')
  @ApiOperation({ summary: 'Update a variant low-stock threshold with optimistic concurrency' })
  updateThreshold(
    @Param() parameters: InventoryVariantIdParametersDto,
    @Body() input: UpdateLowStockThresholdDto,
    @Req() request: Request,
  ) {
    return this.inventory.updateThreshold(parameters.variantId, input, request);
  }
}
