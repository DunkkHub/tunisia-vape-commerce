import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import {
  CustomerCancelOrderDto,
  CustomerOrderDetailResponseDto,
  CustomerOrderListQueryDto,
  CustomerOrderListResponseDto,
  CustomerOrderParamDto,
} from './dto/customer-order.dto';
import { CustomerOrdersService } from './customer-orders.service';

@ApiTags('customer-orders')
@ApiCookieAuth('customer')
@Controller('orders')
@UseGuards(TrustedOriginGuard, CustomerSessionGuard, AgeGateGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class CustomerOrdersController {
  constructor(private readonly orders: CustomerOrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List the authenticated customer’s own orders' })
  @ApiOkResponse({ type: CustomerOrderListResponseDto })
  list(@Query() query: CustomerOrderListQueryDto, @Req() request: Request) {
    return this.orders.list(request.auth!.userId, query);
  }

  @Get(':orderNumber')
  @ApiOperation({ summary: 'Get one owned order from immutable customer-safe snapshots' })
  @ApiOkResponse({ type: CustomerOrderDetailResponseDto })
  get(@Param() parameters: CustomerOrderParamDto, @Req() request: Request) {
    return this.orders.get(request.auth!.userId, parameters.orderNumber);
  }

  @Post(':orderNumber/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Cancel an owned pending order and release its active reservations exactly once',
  })
  @ApiOkResponse({ type: CustomerOrderDetailResponseDto })
  cancel(
    @Param() parameters: CustomerOrderParamDto,
    @Body() input: CustomerCancelOrderDto,
    @Req() request: Request,
  ) {
    return this.orders.cancel(request.auth!.userId, parameters.orderNumber, input, request);
  }
}
