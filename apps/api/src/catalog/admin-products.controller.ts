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
import { requestLocale } from '../compliance/age-gate.service';
import { AdminProductsService, type AdminMutationContext } from './admin-products.service';
import {
  AdminProductListQueryDto,
  ConfirmProductMediaReviewDto,
  CreateProductDto,
  ProductVersionDto,
  UpdateProductDto,
} from './dto/admin-product.dto';

const mutationContext = (request: Request): AdminMutationContext => {
  const userAgent = request.get('user-agent');
  return {
    userId: request.auth!.userId,
    requestId: request.requestId,
    ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
    ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
};

@ApiTags('administrator-catalog')
@ApiCookieAuth('admin')
@Controller('admin/products')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminProductsController {
  constructor(private readonly products: AdminProductsService) {}

  @Get()
  @RequirePermissions('products.read')
  @ApiOperation({ summary: 'List products for administrator catalog operations' })
  list(@Query() query: AdminProductListQueryDto, @Req() request: Request) {
    return this.products.list(query, requestLocale(request));
  }

  @Get(':id')
  @RequirePermissions('products.read')
  @ApiOperation({ summary: 'Get one product for administrator editing' })
  get(@Param('id') id: string) {
    return this.products.get(id);
  }

  @Post()
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.create')
  @ApiOperation({ summary: 'Create a draft product' })
  create(@Body() input: CreateProductDto, @Req() request: Request) {
    return this.products.create(input, mutationContext(request));
  }

  @Patch(':id')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.update')
  @ApiOperation({ summary: 'Update a product with optimistic concurrency' })
  update(@Param('id') id: string, @Body() input: UpdateProductDto, @Req() request: Request) {
    return this.products.update(id, input, mutationContext(request));
  }

  @Post(':id/media-review/confirm')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.update')
  @ApiOperation({
    summary: 'Confirm completed media review while the product remains a draft',
  })
  confirmMediaReview(
    @Param('id') id: string,
    @Body() input: ConfirmProductMediaReviewDto,
    @Req() request: Request,
  ) {
    return this.products.confirmMediaReview(id, input, mutationContext(request));
  }

  @Post(':id/archive')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.archive')
  @ApiOperation({ summary: 'Archive a product without destroying historical references' })
  archive(@Param('id') id: string, @Body() input: ProductVersionDto, @Req() request: Request) {
    return this.products.archive(id, input.version, mutationContext(request));
  }

  @Post(':id/restore')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.archive')
  @ApiOperation({ summary: 'Restore an archived product as a non-public draft' })
  restore(@Param('id') id: string, @Body() input: ProductVersionDto, @Req() request: Request) {
    return this.products.restore(id, input.version, mutationContext(request));
  }
}
