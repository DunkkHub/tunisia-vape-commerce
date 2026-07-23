import { Controller, Get, Param, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { requestLocale } from '../compliance/age-gate.service';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import {
  DeliveryMethodsQueryDto,
  DeliveryMethodsResponseDto,
  DeliveryWindowsQueryDto,
  DeliveryWindowsResponseDto,
  GeographyIdParamDto,
  GeographyOptionsResponseDto,
} from './dto/geography.dto';
import { GeographyService } from './geography.service';

@ApiTags('geography')
@Controller('geography')
@UseGuards(AgeGateGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class GeographyController {
  constructor(private readonly geography: GeographyService) {}

  @Get('governorates')
  @ApiOperation({ summary: 'List active Tunisian governorates for checkout' })
  @ApiOkResponse({ type: GeographyOptionsResponseDto })
  governorates(@Req() request: Request) {
    return this.geography.governorates(requestLocale(request));
  }

  @Get('governorates/:id/delegations')
  @ApiOperation({ summary: 'List active delegations belonging to an active governorate' })
  @ApiOkResponse({ type: GeographyOptionsResponseDto })
  delegations(@Param() parameters: GeographyIdParamDto, @Req() request: Request) {
    return this.geography.delegations(parameters.id, requestLocale(request));
  }

  @Get('delegations/:id/localities')
  @ApiOperation({ summary: 'List active localities belonging to an active delegation' })
  @ApiOkResponse({ type: GeographyOptionsResponseDto })
  localities(@Param() parameters: GeographyIdParamDto, @Req() request: Request) {
    return this.geography.localities(parameters.id, requestLocale(request));
  }
}

@ApiTags('delivery-options')
@Controller('delivery')
@UseGuards(AgeGateGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class DeliveryOptionsController {
  constructor(private readonly geography: GeographyService) {}

  @Get('windows')
  @ApiOperation({ summary: 'List active delivery windows for a supported locality' })
  @ApiOkResponse({ type: DeliveryWindowsResponseDto })
  windows(@Query() query: DeliveryWindowsQueryDto, @Req() request: Request) {
    return this.geography.deliveryWindows(query.localityId, requestLocale(request));
  }

  @Get('methods')
  @ApiOperation({
    summary: 'List active pickup options and valid courier availability for a locality',
  })
  @ApiOkResponse({ type: DeliveryMethodsResponseDto })
  methods(@Query() query: DeliveryMethodsQueryDto, @Req() request: Request) {
    return this.geography.deliveryMethods(query.localityId, requestLocale(request));
  }
}
