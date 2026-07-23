import { Controller, Get, Param, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { requestLocale } from '../compliance/age-gate.service';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { CatalogService } from './catalog.service';
import { CatalogProductsQueryDto } from './dto/catalog-query.dto';

@ApiTags('storefront')
@Controller()
@UseInterceptors(NoStoreInterceptor)
export class StorefrontCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('storefront/status')
  @ApiOperation({ summary: 'Get storefront operational, checkout and age-gate status' })
  status(@Req() request: Request) {
    return this.catalog.status(request);
  }

  @Get('storefront/home')
  @UseGuards(AgeGateGuard)
  @ApiOperation({ summary: 'Get localized featured products and categories' })
  home(@Req() request: Request) {
    return this.catalog.home(requestLocale(request));
  }

  @Get('products')
  @UseGuards(AgeGateGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'List localized, currently public and unrestricted products' })
  products(@Query() query: CatalogProductsQueryDto, @Req() request: Request) {
    return this.catalog.products(query, requestLocale(request));
  }

  @Get('products/:slug')
  @UseGuards(AgeGateGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get one localized, currently public and unrestricted product' })
  product(@Param('slug') slug: string, @Req() request: Request) {
    return this.catalog.product(slug, requestLocale(request));
  }
}
