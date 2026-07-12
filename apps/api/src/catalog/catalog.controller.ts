import { Controller, Get, Param, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { requestLocale } from '../compliance/age-gate.service';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { CatalogService } from './catalog.service';
import { BoundedPageQueryDto, CatalogProductsQueryDto } from './dto/catalog-query.dto';

@ApiTags('public-catalog')
@Controller('catalog')
@UseInterceptors(NoStoreInterceptor)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get the public storefront availability and configured age gate' })
  status(@Req() request: Request) {
    return this.catalog.status(request);
  }

  @Get('products')
  @UseGuards(AgeGateGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'List only currently public, unrestricted products' })
  products(@Query() query: CatalogProductsQueryDto, @Req() request: Request) {
    return this.catalog.products(query, requestLocale(request));
  }

  @Get('products/:slug')
  @UseGuards(AgeGateGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get one currently public, unrestricted product by slug' })
  product(@Param('slug') slug: string, @Req() request: Request) {
    return this.catalog.product(slug, requestLocale(request));
  }

  @Get('categories')
  @UseGuards(AgeGateGuard)
  @ApiOperation({ summary: 'List published and unrestricted categories' })
  categories(@Query() query: BoundedPageQueryDto, @Req() request: Request) {
    return this.catalog.categories(query, requestLocale(request));
  }

  @Get('brands')
  @UseGuards(AgeGateGuard)
  @ApiOperation({ summary: 'List published and unrestricted brands' })
  brands(@Query() query: BoundedPageQueryDto, @Req() request: Request) {
    return this.catalog.brands(query, requestLocale(request));
  }

  @Get('facets')
  @UseGuards(AgeGateGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get bounded public brand, product type, flavor and price facets' })
  facets() {
    return this.catalog.facets();
  }
}
