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
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { CustomerSessionGuard } from '../auth/guards/customer-session.guard';
import { TrustedOriginGuard } from '../auth/guards/trusted-origin.guard';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { requestLocale } from '../compliance/age-gate.service';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { CustomerAddressesService } from './customer-addresses.service';
import {
  CreateCustomerAddressDto,
  CustomerAddressIdParamDto,
  CustomerAddressListResponseDto,
  CustomerAddressResponseDto,
  DeleteCustomerAddressQueryDto,
  DeleteCustomerAddressResponseDto,
  UpdateCustomerAddressDto,
} from './dto/customer-address.dto';

@ApiTags('customer-addresses')
@ApiCookieAuth('customer')
@Controller('customers/me/addresses')
@UseGuards(TrustedOriginGuard, CustomerSessionGuard, AgeGateGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class CustomerAddressesController {
  constructor(private readonly addresses: CustomerAddressesService) {}

  @Get()
  @ApiOperation({ summary: 'List the authenticated customer’s saved addresses' })
  @ApiOkResponse({ type: CustomerAddressListResponseDto })
  list(@Req() request: Request) {
    return this.addresses.list(request.auth!.userId, requestLocale(request));
  }

  @Post()
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a validated saved address for the authenticated customer' })
  @ApiCreatedResponse({ type: CustomerAddressResponseDto })
  create(@Body() input: CreateCustomerAddressDto, @Req() request: Request) {
    return this.addresses.create(request.auth!.userId, input, requestLocale(request));
  }

  @Patch(':id')
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Update an owned saved address with optimistic concurrency' })
  @ApiOkResponse({ type: CustomerAddressResponseDto })
  update(
    @Param() parameters: CustomerAddressIdParamDto,
    @Body() input: UpdateCustomerAddressDto,
    @Req() request: Request,
  ) {
    return this.addresses.update(
      request.auth!.userId,
      parameters.id,
      input,
      requestLocale(request),
    );
  }

  @Delete(':id')
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Soft-delete an owned saved address' })
  @ApiOkResponse({ type: DeleteCustomerAddressResponseDto })
  remove(
    @Param() parameters: CustomerAddressIdParamDto,
    @Query() query: DeleteCustomerAddressQueryDto,
    @Req() request: Request,
  ) {
    return this.addresses.remove(request.auth!.userId, parameters.id, query.expectedVersion);
  }
}
