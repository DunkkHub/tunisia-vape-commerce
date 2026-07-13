import { Body, Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { CustomerSessionGuard } from '../auth/guards/customer-session.guard';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { CheckoutOrderService } from './checkout-order.service';
import { CheckoutPolicyService } from './checkout-policy.service';
import { CheckoutQuoteService } from './checkout-quote.service';
import { CheckoutOrderCreatedResponseDto, CheckoutOrderDto } from './dto/checkout-order.dto';
import { CheckoutQuoteDto } from './dto/checkout-quote.dto';

@ApiTags('checkout')
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly policies: CheckoutPolicyService,
    private readonly quotes: CheckoutQuoteService,
    private readonly orders: CheckoutOrderService,
  ) {}

  @Get('policy')
  @ApiOperation({ summary: 'Evaluate every authoritative legal and operational checkout gate' })
  policy() {
    return this.policies.response();
  }

  @Post('quote')
  @UseGuards(AgeGateGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Calculate a non-reserving TND quote from authoritative catalog and delivery data',
  })
  quote(@Body() input: CheckoutQuoteDto) {
    return this.quotes.quote(input);
  }

  @Post('orders')
  @UseGuards(CustomerSessionGuard, CsrfGuard, AgeGateGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiCookieAuth('customer')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'A customer-scoped opaque key containing 16 to 128 safe ASCII characters.',
  })
  @ApiCreatedResponse({ type: CheckoutOrderCreatedResponseDto })
  @ApiOperation({
    summary: 'Atomically create an authenticated-customer cash-on-delivery order',
  })
  createOrder(
    @Body() input: CheckoutOrderDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    return this.orders.create(input, idempotencyKey, request.auth!.userId, request);
  }
}
