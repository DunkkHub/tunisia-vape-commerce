import { Controller, Get, Param, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { requestLocale } from '../compliance/age-gate.service';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { GeographyIdParamDto, GeographyOptionsResponseDto } from './dto/geography.dto';
import { GeographyService } from './geography.service';

@ApiTags('administrator-delivery-configuration')
@ApiCookieAuth('admin')
@Controller('admin/delivery-config/geography')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class AdminDeliveryGeographyController {
  constructor(private readonly geography: GeographyService) {}

  @Get('governorates')
  @RequirePermissions('deliveries.read')
  @ApiOperation({ summary: 'List active governorates for delivery configuration' })
  @ApiOkResponse({ type: GeographyOptionsResponseDto })
  governorates(@Req() request: Request) {
    return this.geography.governorates(requestLocale(request));
  }

  @Get('governorates/:id/delegations')
  @RequirePermissions('deliveries.read')
  @ApiOperation({ summary: 'List active delegations for delivery configuration' })
  @ApiOkResponse({ type: GeographyOptionsResponseDto })
  delegations(@Param() parameters: GeographyIdParamDto, @Req() request: Request) {
    return this.geography.delegations(parameters.id, requestLocale(request));
  }

  @Get('delegations/:id/localities')
  @RequirePermissions('deliveries.read')
  @ApiOperation({ summary: 'List active localities for delivery configuration' })
  @ApiOkResponse({ type: GeographyOptionsResponseDto })
  localities(@Param() parameters: GeographyIdParamDto, @Req() request: Request) {
    return this.geography.localities(parameters.id, requestLocale(request));
  }
}
