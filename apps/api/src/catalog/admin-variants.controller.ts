import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
import { AdminVariantsService } from './admin-variants.service';
import {
  CreateProductVariantDto,
  ProductParametersDto,
  ProductVariantParametersDto,
  UpdateProductVariantDto,
  VariantVersionDto,
} from './dto/admin-variant.dto';

@ApiTags('administrator-catalog-variants')
@ApiCookieAuth('admin')
@Controller('admin/products/:productId/variants')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminVariantsController {
  constructor(private readonly variants: AdminVariantsService) {}

  @Get()
  @RequirePermissions('products.read')
  @ApiOperation({ summary: 'List operational variants and attributes for one product' })
  list(@Param() parameters: ProductParametersDto) {
    return this.variants.list(parameters.productId);
  }

  @Post()
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.create')
  @ApiOperation({ summary: 'Create a non-public product variant' })
  create(
    @Param() parameters: ProductParametersDto,
    @Body() input: CreateProductVariantDto,
    @Req() request: Request,
  ) {
    return this.variants.create(parameters.productId, input, request);
  }

  @Patch(':variantId')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.update')
  @ApiOperation({ summary: 'Update a product variant with optimistic concurrency' })
  update(
    @Param() parameters: ProductVariantParametersDto,
    @Body() input: UpdateProductVariantDto,
    @Req() request: Request,
  ) {
    return this.variants.update(parameters.productId, parameters.variantId, input, request);
  }

  @Post(':variantId/archive')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.archive')
  @ApiOperation({ summary: 'Archive a variant without deleting order history' })
  archive(
    @Param() parameters: ProductVariantParametersDto,
    @Body() input: VariantVersionDto,
    @Req() request: Request,
  ) {
    return this.variants.archive(
      parameters.productId,
      parameters.variantId,
      input.version,
      request,
    );
  }

  @Post(':variantId/restore')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.archive')
  @ApiOperation({ summary: 'Restore an archived variant as a non-public draft' })
  restore(
    @Param() parameters: ProductVariantParametersDto,
    @Body() input: VariantVersionDto,
    @Req() request: Request,
  ) {
    return this.variants.restore(
      parameters.productId,
      parameters.variantId,
      input.version,
      request,
    );
  }
}
