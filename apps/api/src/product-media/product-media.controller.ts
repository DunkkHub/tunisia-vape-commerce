import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import {
  AdminProductImageListResponseDto,
  AdminProductImageResponseDto,
  DeleteProductImageQueryDto,
  DeleteProductImageResponseDto,
  ProductImageOwnerVersionDto,
  ProductMediaImageParamDto,
  ProductMediaListQueryDto,
  ProductMediaProductParamDto,
  PublicMediaHashParamDto,
  ReorderProductImagesDto,
  ReorderProductImagesResponseDto,
  ReplaceProductImageDto,
  UpdateProductImageMetadataDto,
  UploadProductImageDto,
} from './dto/product-media.dto';
import { ProductMediaService, type ProductMediaMutationContext } from './product-media.service';
import type { UploadedProductImage } from './product-image-validator.service';

const ABSOLUTE_MULTIPART_LIMIT_BYTES = 25 * 1_024 * 1_024;

const mutationContext = (request: Request): ProductMediaMutationContext => {
  const userAgent = request.get('user-agent');
  return {
    userId: request.auth!.userId,
    requestId: request.requestId,
    ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
    ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
};

const multipartSchema = (replacement: boolean) => ({
  schema: {
    type: 'object',
    required: replacement
      ? ['file', 'expectedOwnerVersion']
      : ['file', 'expectedOwnerVersion', 'altTextFr', 'altTextAr'],
    properties: {
      file: { type: 'string', format: 'binary' },
      expectedOwnerVersion: { type: 'integer', minimum: 1 },
      ...(replacement ? {} : { variantId: { type: 'string', maxLength: 30 } }),
      altTextFr: { type: 'string', maxLength: 300 },
      altTextAr: { type: 'string', maxLength: 300 },
      ...(replacement ? {} : { isPrimary: { type: 'boolean' } }),
    },
  },
});

@ApiTags('administrator-product-media')
@ApiCookieAuth('admin')
@Controller('admin/products/:productId/images')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminProductMediaController {
  constructor(private readonly media: ProductMediaService) {}

  @Get()
  @RequirePermissions('products.read')
  @ApiOperation({ summary: 'List bounded product and variant image metadata' })
  @ApiOkResponse({ type: AdminProductImageListResponseDto })
  list(@Param() parameters: ProductMediaProductParamDto, @Query() query: ProductMediaListQueryDto) {
    return this.media.list(parameters.productId, query);
  }

  @Post()
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.update')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: ABSOLUTE_MULTIPART_LIMIT_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody(multipartSchema(false))
  @ApiOperation({ summary: 'Validate and upload an approved product or variant image' })
  @ApiCreatedResponse({ type: AdminProductImageResponseDto })
  upload(
    @Param() parameters: ProductMediaProductParamDto,
    @Body() input: UploadProductImageDto,
    @UploadedFile() file: UploadedProductImage | undefined,
    @Req() request: Request,
  ) {
    return this.media.upload(parameters.productId, input, file, mutationContext(request));
  }

  @Patch(':imageId')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.update')
  @ApiOperation({ summary: 'Update bilingual alternative text with optimistic concurrency' })
  @ApiOkResponse({ type: AdminProductImageResponseDto })
  updateMetadata(
    @Param() parameters: ProductMediaImageParamDto,
    @Body() input: UpdateProductImageMetadataDto,
    @Req() request: Request,
  ) {
    return this.media.updateMetadata(
      parameters.productId,
      parameters.imageId,
      input,
      mutationContext(request),
    );
  }

  @Post('reorder')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.update')
  @ApiOperation({ summary: 'Apply an exact deterministic order to one image owner' })
  @ApiOkResponse({ type: ReorderProductImagesResponseDto })
  reorder(
    @Param() parameters: ProductMediaProductParamDto,
    @Body() input: ReorderProductImagesDto,
    @Req() request: Request,
  ) {
    return this.media.reorder(parameters.productId, input, mutationContext(request));
  }

  @Post(':imageId/replace')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.update')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: ABSOLUTE_MULTIPART_LIMIT_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody(multipartSchema(true))
  @ApiOperation({ summary: 'Replace image bytes while preserving ordered metadata and history' })
  @ApiCreatedResponse({ type: AdminProductImageResponseDto })
  replace(
    @Param() parameters: ProductMediaImageParamDto,
    @Body() input: ReplaceProductImageDto,
    @UploadedFile() file: UploadedProductImage | undefined,
    @Req() request: Request,
  ) {
    return this.media.replace(
      parameters.productId,
      parameters.imageId,
      input,
      file,
      mutationContext(request),
    );
  }

  @Post(':imageId/primary')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.update')
  @ApiOperation({ summary: 'Set the single primary image for one product or variant owner' })
  @ApiOkResponse({ type: AdminProductImageResponseDto })
  setPrimary(
    @Param() parameters: ProductMediaImageParamDto,
    @Body() input: ProductImageOwnerVersionDto,
    @Req() request: Request,
  ) {
    return this.media.setPrimary(
      parameters.productId,
      parameters.imageId,
      input,
      mutationContext(request),
    );
  }

  @Delete(':imageId')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('products.update')
  @ApiOperation({ summary: 'Soft-delete an owned product image and safely promote a replacement' })
  @ApiOkResponse({ type: DeleteProductImageResponseDto })
  remove(
    @Param() parameters: ProductMediaImageParamDto,
    @Query() query: DeleteProductImageQueryDto,
    @Req() request: Request,
  ) {
    return this.media.remove(
      parameters.productId,
      parameters.imageId,
      query.expectedOwnerVersion,
      mutationContext(request),
    );
  }
}

@ApiTags('public-product-media')
@Controller('media')
@UseGuards(AgeGateGuard)
@Throttle({ default: { limit: 240, ttl: 60_000 } })
export class PublicProductMediaController {
  constructor(private readonly media: ProductMediaService) {}

  @Get(':objectKeyHash')
  @ApiOperation({ summary: 'Read one approved image belonging to a currently public product' })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  async get(
    @Param() parameters: PublicMediaHashParamDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const image = await this.media.readPublic(parameters.objectKeyHash);
    response.setHeader('Content-Type', image.contentType);
    response.setHeader('Content-Length', String(image.byteSize));
    response.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(image.bytes);
  }
}
