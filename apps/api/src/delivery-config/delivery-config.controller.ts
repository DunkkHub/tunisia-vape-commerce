import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import {
  DeliveryRatesConfigService,
  DeliveryWindowsConfigService,
  DeliveryZonesConfigService,
  PickupLocationsConfigService,
  type DeliveryConfigMutationContext,
} from './delivery-config.service';
import {
  CreateDeliveryRateDto,
  CreateDeliveryWindowDto,
  CreateDeliveryZoneDto,
  CreatePickupLocationDto,
  DeliveryConfigIdParamDto,
  DeliveryConfigListQueryDto,
  DeliveryRateListResponseDto,
  DeliveryRateResponseDto,
  DeliveryWindowListResponseDto,
  DeliveryWindowResponseDto,
  DeliveryZoneListResponseDto,
  DeliveryZoneResponseDto,
  LinkZoneGeographyDto,
  PickupLocationListResponseDto,
  PickupLocationResponseDto,
  TimestampLifecycleDto,
  TokenLifecycleDto,
  UpdateDeliveryRateDto,
  UpdateDeliveryWindowDto,
  UpdateDeliveryZoneDto,
  UpdatePickupLocationDto,
  VersionLifecycleDto,
} from './dto/delivery-config.dto';

const context = (request: Request): DeliveryConfigMutationContext => {
  const userAgent = request.get('user-agent');
  return {
    userId: request.auth!.userId,
    requestId: request.requestId,
    ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
    ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
};

@ApiTags('administrator-delivery-configuration')
@ApiCookieAuth('admin')
@Controller('admin/delivery-config')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminDeliveryConfigController {
  constructor(
    private readonly zones: DeliveryZonesConfigService,
    private readonly rates: DeliveryRatesConfigService,
    private readonly pickups: PickupLocationsConfigService,
    private readonly windows: DeliveryWindowsConfigService,
  ) {}

  @Get('zones')
  @RequirePermissions('deliveries.read')
  @ApiOkResponse({ type: DeliveryZoneListResponseDto })
  listZones(@Query() query: DeliveryConfigListQueryDto) {
    return this.zones.list(query);
  }
  @Get('zones/:id')
  @RequirePermissions('deliveries.read')
  @ApiOkResponse({ type: DeliveryZoneResponseDto })
  getZone(@Param() params: DeliveryConfigIdParamDto) {
    return this.zones.get(params.id);
  }
  @Post('zones')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOperation({ summary: 'Create an inactive manual delivery zone' })
  @ApiOkResponse({ type: DeliveryZoneResponseDto })
  createZone(@Body() input: CreateDeliveryZoneDto, @Req() request: Request) {
    return this.zones.create(input, context(request));
  }
  @Patch('zones/:id')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: DeliveryZoneResponseDto })
  updateZone(
    @Param() params: DeliveryConfigIdParamDto,
    @Body() input: UpdateDeliveryZoneDto,
    @Req() request: Request,
  ) {
    return this.zones.update(params.id, input, context(request));
  }
  @Post('zones/:id/activate')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: DeliveryZoneResponseDto })
  activateZone(
    @Param() params: DeliveryConfigIdParamDto,
    @Body() input: TimestampLifecycleDto,
    @Req() request: Request,
  ) {
    return this.zones.setActive(params.id, input.expectedUpdatedAt, true, context(request));
  }
  @Post('zones/:id/deactivate')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: DeliveryZoneResponseDto })
  deactivateZone(
    @Param() params: DeliveryConfigIdParamDto,
    @Body() input: TimestampLifecycleDto,
    @Req() request: Request,
  ) {
    return this.zones.setActive(params.id, input.expectedUpdatedAt, false, context(request));
  }
  @Put('zones/:id/geography-links')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: DeliveryZoneResponseDto })
  linkZoneGeography(
    @Param() params: DeliveryConfigIdParamDto,
    @Body() input: LinkZoneGeographyDto,
    @Req() request: Request,
  ) {
    return this.zones.linkGeography(params.id, input, context(request));
  }

  @Get('rates')
  @RequirePermissions('deliveries.read')
  @ApiOkResponse({ type: DeliveryRateListResponseDto })
  listRates(@Query() query: DeliveryConfigListQueryDto) {
    return this.rates.list(query);
  }
  @Get('rates/:id')
  @RequirePermissions('deliveries.read')
  @ApiOkResponse({ type: DeliveryRateResponseDto })
  getRate(@Param() params: DeliveryConfigIdParamDto) {
    return this.rates.get(params.id);
  }
  @Post('rates')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: DeliveryRateResponseDto })
  createRate(@Body() input: CreateDeliveryRateDto, @Req() request: Request) {
    return this.rates.create(input, context(request));
  }
  @Patch('rates/:id')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: DeliveryRateResponseDto })
  updateRate(
    @Param() params: DeliveryConfigIdParamDto,
    @Body() input: UpdateDeliveryRateDto,
    @Req() request: Request,
  ) {
    return this.rates.update(params.id, input, context(request));
  }
  @Post('rates/:id/activate')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: DeliveryRateResponseDto })
  activateRate(
    @Param() params: DeliveryConfigIdParamDto,
    @Body() input: VersionLifecycleDto,
    @Req() request: Request,
  ) {
    return this.rates.setActive(params.id, input.expectedVersion, true, context(request));
  }
  @Post('rates/:id/deactivate')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: DeliveryRateResponseDto })
  deactivateRate(
    @Param() params: DeliveryConfigIdParamDto,
    @Body() input: VersionLifecycleDto,
    @Req() request: Request,
  ) {
    return this.rates.setActive(params.id, input.expectedVersion, false, context(request));
  }

  @Get('pickups')
  @RequirePermissions('deliveries.read')
  @ApiOkResponse({ type: PickupLocationListResponseDto })
  listPickups(@Query() query: DeliveryConfigListQueryDto) {
    return this.pickups.list(query);
  }
  @Get('pickups/:id')
  @RequirePermissions('deliveries.read')
  @ApiOkResponse({ type: PickupLocationResponseDto })
  getPickup(@Param() params: DeliveryConfigIdParamDto) {
    return this.pickups.get(params.id);
  }
  @Post('pickups')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: PickupLocationResponseDto })
  createPickup(@Body() input: CreatePickupLocationDto, @Req() request: Request) {
    return this.pickups.create(input, context(request));
  }
  @Patch('pickups/:id')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: PickupLocationResponseDto })
  updatePickup(
    @Param() params: DeliveryConfigIdParamDto,
    @Body() input: UpdatePickupLocationDto,
    @Req() request: Request,
  ) {
    return this.pickups.update(params.id, input, context(request));
  }
  @Post('pickups/:id/activate')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: PickupLocationResponseDto })
  activatePickup(
    @Param() params: DeliveryConfigIdParamDto,
    @Body() input: TokenLifecycleDto,
    @Req() request: Request,
  ) {
    return this.pickups.setActive(params.id, input.expectedStateToken, true, context(request));
  }
  @Post('pickups/:id/deactivate')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: PickupLocationResponseDto })
  deactivatePickup(
    @Param() params: DeliveryConfigIdParamDto,
    @Body() input: TokenLifecycleDto,
    @Req() request: Request,
  ) {
    return this.pickups.setActive(params.id, input.expectedStateToken, false, context(request));
  }

  @Get('windows')
  @RequirePermissions('deliveries.read')
  @ApiOkResponse({ type: DeliveryWindowListResponseDto })
  listWindows(@Query() query: DeliveryConfigListQueryDto) {
    return this.windows.list(query);
  }
  @Get('windows/:id')
  @RequirePermissions('deliveries.read')
  @ApiOkResponse({ type: DeliveryWindowResponseDto })
  getWindow(@Param() params: DeliveryConfigIdParamDto) {
    return this.windows.get(params.id);
  }
  @Post('windows')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: DeliveryWindowResponseDto })
  createWindow(@Body() input: CreateDeliveryWindowDto, @Req() request: Request) {
    return this.windows.create(input, context(request));
  }
  @Patch('windows/:id')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: DeliveryWindowResponseDto })
  updateWindow(
    @Param() params: DeliveryConfigIdParamDto,
    @Body() input: UpdateDeliveryWindowDto,
    @Req() request: Request,
  ) {
    return this.windows.update(params.id, input, context(request));
  }
  @Post('windows/:id/activate')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: DeliveryWindowResponseDto })
  activateWindow(
    @Param() params: DeliveryConfigIdParamDto,
    @Body() input: TokenLifecycleDto,
    @Req() request: Request,
  ) {
    return this.windows.setActive(params.id, input.expectedStateToken, true, context(request));
  }
  @Post('windows/:id/deactivate')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOkResponse({ type: DeliveryWindowResponseDto })
  deactivateWindow(
    @Param() params: DeliveryConfigIdParamDto,
    @Body() input: TokenLifecycleDto,
    @Req() request: Request,
  ) {
    return this.windows.setActive(params.id, input.expectedStateToken, false, context(request));
  }
}
