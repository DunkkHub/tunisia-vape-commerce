import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  CreateInventoryItemDto,
  CreateInventoryLocationDto,
  InventoryItemIdParametersDto,
  InventoryMovementQueryDto,
  InventoryVariantIdParametersDto,
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
  @ApiOperation({ summary: 'Create a unique inventory bucket and its initial movement' })
  createItem(@Body() input: CreateInventoryItemDto, @Req() request: Request) {
    return this.inventory.createItem(input, request);
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
  @ApiOperation({ summary: 'Apply an audited, reservation-safe physical stock adjustment' })
  adjust(
    @Param() parameters: InventoryItemIdParametersDto,
    @Body() input: ApplyInventoryAdjustmentDto,
    @Req() request: Request,
  ) {
    return this.inventory.adjust(parameters.id, input, request);
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
