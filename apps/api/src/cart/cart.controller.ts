import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { CustomerSessionGuard } from '../auth/guards/customer-session.guard';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { requestLocale } from '../compliance/age-gate.service';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { CartService } from './cart.service';
import {
  AddCartItemDto,
  CartItemParamDto,
  CartResponseDto,
  CartSummaryResponseDto,
  UpdateCartItemDto,
} from './dto/cart.dto';

@ApiTags('customer-cart')
@ApiCookieAuth('customer')
@Controller('cart')
@UseGuards(CustomerSessionGuard, AgeGateGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class CartController {
  constructor(private readonly carts: CartService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the authenticated customer cart with authoritative current prices',
  })
  @ApiOkResponse({ type: CartResponseDto })
  get(@Req() request: Request) {
    return this.carts.get(request.auth!.userId, requestLocale(request));
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get the authenticated customer cart item count' })
  @ApiOkResponse({ type: CartSummaryResponseDto })
  summary(@Req() request: Request) {
    return this.carts.summary(request.auth!.userId);
  }

  @Post('items')
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Add a validated published variant to the customer cart' })
  @ApiOkResponse({ type: CartResponseDto })
  add(@Body() input: AddCartItemDto, @Req() request: Request) {
    return this.carts.add(request.auth!.userId, input, requestLocale(request));
  }

  @Patch('items/:id')
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Set a validated quantity on an owned customer cart item' })
  @ApiOkResponse({ type: CartResponseDto })
  update(
    @Param() parameters: CartItemParamDto,
    @Body() input: UpdateCartItemDto,
    @Req() request: Request,
  ) {
    return this.carts.update(request.auth!.userId, parameters.id, input, requestLocale(request));
  }

  @Delete('items/:id')
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Remove an owned customer cart item' })
  @ApiOkResponse({ type: CartResponseDto })
  remove(@Param() parameters: CartItemParamDto, @Req() request: Request) {
    return this.carts.remove(request.auth!.userId, parameters.id, requestLocale(request));
  }
}
