import { Controller, Get, Param, Req, UseInterceptors } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { requestLocale } from '../compliance/age-gate.service';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import {
  PublishedLegalDocumentResponseDto,
  StorefrontContentResponseDto,
  StorefrontContentSlugParamDto,
} from './dto/storefront-content.dto';
import { StorefrontContentService } from './storefront-content.service';

@ApiTags('public-legal-documents')
@Controller('legal/documents')
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class LegalDocumentsController {
  constructor(private readonly content: StorefrontContentService) {}

  @Get(':slug')
  @ApiOperation({
    summary: 'Read the current published and effective legal document in the request locale',
  })
  @ApiOkResponse({ type: PublishedLegalDocumentResponseDto })
  @ApiNotFoundResponse({ description: 'No published and effective localized version exists.' })
  get(@Param() parameters: StorefrontContentSlugParamDto, @Req() request: Request) {
    return this.content.legalDocument(parameters.slug, requestLocale(request));
  }
}

@ApiTags('public-storefront-content')
@Controller('storefront/content')
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class StorefrontContentController {
  constructor(private readonly content: StorefrontContentService) {}

  @Get(':slug')
  @ApiOperation({
    summary: 'Read current published operator content in the request locale',
  })
  @ApiOkResponse({ type: StorefrontContentResponseDto })
  @ApiNotFoundResponse({ description: 'No published and effective localized content exists.' })
  get(@Param() parameters: StorefrontContentSlugParamDto, @Req() request: Request) {
    return this.content.operatorContent(parameters.slug, requestLocale(request));
  }
}
