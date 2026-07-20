import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { CustomerSessionGuard } from '../auth/guards/customer-session.guard';
import { TrustedOriginGuard } from '../auth/guards/trusted-origin.guard';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { requestLocale } from '../compliance/age-gate.service';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import {
  AddWishlistItemDto,
  WishlistMutationResponseDto,
  WishlistQueryDto,
  WishlistResponseDto,
  WishlistVariantParamDto,
} from './dto/wishlist.dto';
import { WishlistService } from './wishlist.service';

@ApiTags('customer-wishlist')
@ApiCookieAuth('customer')
@Controller('wishlist')
@UseGuards(TrustedOriginGuard, CustomerSessionGuard, AgeGateGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  @ApiOperation({ summary: 'List the authenticated customer’s public wishlist products' })
  @ApiOkResponse({ type: WishlistResponseDto })
  list(@Query() query: WishlistQueryDto, @Req() request: Request) {
    return this.wishlist.list(request.auth!.userId, query, requestLocale(request));
  }

  @Post('items')
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Save one published product variant to the customer wishlist' })
  @ApiOkResponse({ type: WishlistMutationResponseDto })
  add(@Body() input: AddWishlistItemDto, @Req() request: Request) {
    return this.wishlist.add(request.auth!.userId, input);
  }

  @Delete('items/:variantId')
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Remove one owned product variant from the customer wishlist' })
  @ApiOkResponse({ type: WishlistMutationResponseDto })
  remove(@Param() parameters: WishlistVariantParamDto, @Req() request: Request) {
    return this.wishlist.remove(request.auth!.userId, parameters.variantId);
  }
}
