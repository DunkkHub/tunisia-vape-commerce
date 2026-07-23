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
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import {
  AdminBrandListResponseDto,
  AdminBrandResponseDto,
  AdminCategoryListResponseDto,
  AdminCategoryResponseDto,
  CategoryListQueryDto,
  CreateBrandDto,
  CreateCategoryDto,
  TaxonomyIdParamDto,
  TaxonomyLifecycleDto,
  TaxonomyListQueryDto,
  UpdateBrandDto,
  UpdateCategoryDto,
} from './dto/taxonomy.dto';
import {
  AdminBrandsService,
  AdminCategoriesService,
  type TaxonomyMutationContext,
} from './taxonomy.service';

const mutationContext = (request: Request): TaxonomyMutationContext => {
  const userAgent = request.get('user-agent');
  return {
    userId: request.auth!.userId,
    requestId: request.requestId,
    ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
    ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
};

@ApiTags('administrator-brands')
@ApiCookieAuth('admin')
@Controller('admin/brands')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@RequirePermissions('brands.manage')
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminBrandsController {
  constructor(private readonly brands: AdminBrandsService) {}

  @Get()
  @ApiOperation({ summary: 'List brands for administrator catalog operations' })
  @ApiOkResponse({ type: AdminBrandListResponseDto })
  list(@Query() query: TaxonomyListQueryDto) {
    return this.brands.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one brand for administrator editing' })
  @ApiOkResponse({ type: AdminBrandResponseDto })
  get(@Param() parameters: TaxonomyIdParamDto) {
    return this.brands.get(parameters.id);
  }

  @Post()
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Create a non-public draft brand' })
  @ApiCreatedResponse({ type: AdminBrandResponseDto })
  create(@Body() input: CreateBrandDto, @Req() request: Request) {
    return this.brands.create(input, mutationContext(request));
  }

  @Patch(':id')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Update a brand using its expected modification timestamp' })
  @ApiOkResponse({ type: AdminBrandResponseDto })
  update(
    @Param() parameters: TaxonomyIdParamDto,
    @Body() input: UpdateBrandDto,
    @Req() request: Request,
  ) {
    return this.brands.update(parameters.id, input, mutationContext(request));
  }

  @Post(':id/archive')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Archive a brand without destroying historical references' })
  @ApiOkResponse({ type: AdminBrandResponseDto })
  archive(
    @Param() parameters: TaxonomyIdParamDto,
    @Body() input: TaxonomyLifecycleDto,
    @Req() request: Request,
  ) {
    return this.brands.archive(parameters.id, input.expectedUpdatedAt, mutationContext(request));
  }

  @Post(':id/restore')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Restore an archived brand as a non-public draft' })
  @ApiOkResponse({ type: AdminBrandResponseDto })
  restore(
    @Param() parameters: TaxonomyIdParamDto,
    @Body() input: TaxonomyLifecycleDto,
    @Req() request: Request,
  ) {
    return this.brands.restore(parameters.id, input.expectedUpdatedAt, mutationContext(request));
  }
}

@ApiTags('administrator-categories')
@ApiCookieAuth('admin')
@Controller('admin/categories')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@RequirePermissions('categories.manage')
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminCategoriesController {
  constructor(private readonly categories: AdminCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List categories for administrator catalog operations' })
  @ApiOkResponse({ type: AdminCategoryListResponseDto })
  list(@Query() query: CategoryListQueryDto) {
    return this.categories.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one category for administrator editing' })
  @ApiOkResponse({ type: AdminCategoryResponseDto })
  get(@Param() parameters: TaxonomyIdParamDto) {
    return this.categories.get(parameters.id);
  }

  @Post()
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Create a non-public draft category' })
  @ApiCreatedResponse({ type: AdminCategoryResponseDto })
  create(@Body() input: CreateCategoryDto, @Req() request: Request) {
    return this.categories.create(input, mutationContext(request));
  }

  @Patch(':id')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Update a category using its expected modification timestamp' })
  @ApiOkResponse({ type: AdminCategoryResponseDto })
  update(
    @Param() parameters: TaxonomyIdParamDto,
    @Body() input: UpdateCategoryDto,
    @Req() request: Request,
  ) {
    return this.categories.update(parameters.id, input, mutationContext(request));
  }

  @Post(':id/archive')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Archive a category only after public dependents are removed' })
  @ApiOkResponse({ type: AdminCategoryResponseDto })
  archive(
    @Param() parameters: TaxonomyIdParamDto,
    @Body() input: TaxonomyLifecycleDto,
    @Req() request: Request,
  ) {
    return this.categories.archive(
      parameters.id,
      input.expectedUpdatedAt,
      mutationContext(request),
    );
  }

  @Post(':id/restore')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Restore an archived category as a non-public draft' })
  @ApiOkResponse({ type: AdminCategoryResponseDto })
  restore(
    @Param() parameters: TaxonomyIdParamDto,
    @Body() input: TaxonomyLifecycleDto,
    @Req() request: Request,
  ) {
    return this.categories.restore(
      parameters.id,
      input.expectedUpdatedAt,
      mutationContext(request),
    );
  }
}
