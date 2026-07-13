import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { AdminDeliveriesService } from './admin-deliveries.service';
import {
  AdminCourierOptionsResponseDto,
  AdminDeliveryResponseDto,
  AssignDeliveryDto,
  CompleteDeliveryDto,
  CompleteDeliveryReturnDto,
  ReassignDeliveryDto,
  RecordDeliveryAttemptDto,
  TransitionDeliveryDto,
} from './dto/admin-delivery.dto';

@ApiTags('administrator-delivery')
@ApiCookieAuth('admin')
@Controller('admin/deliveries')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminDeliveriesController {
  constructor(private readonly deliveries: AdminDeliveriesService) {}

  @Get('couriers')
  @RequirePermissions('deliveries.read')
  @ApiOperation({ summary: 'List up to 100 active couriers for manual assignment' })
  @ApiOkResponse({ type: AdminCourierOptionsResponseDto })
  couriers() {
    return this.deliveries.listCouriers();
  }

  @Get(':id')
  @RequirePermissions('deliveries.read')
  @ApiOperation({ summary: 'Get manual delivery workflow detail and immutable events' })
  @ApiOkResponse({ type: AdminDeliveryResponseDto })
  get(@Param('id') id: string) {
    return this.deliveries.get(id);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequirePermissions('deliveries.assign')
  @ApiOperation({ summary: 'Assign an active courier without invoking an external integration' })
  @ApiOkResponse({ type: AdminDeliveryResponseDto })
  assign(@Param('id') id: string, @Body() input: AssignDeliveryDto, @Req() request: Request) {
    return this.deliveries.assign(id, input, request);
  }

  @Post(':id/reassign')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequirePermissions('deliveries.assign')
  @ApiOperation({ summary: 'Reassign an eligible delivery with a mandatory reason' })
  @ApiOkResponse({ type: AdminDeliveryResponseDto })
  reassign(@Param('id') id: string, @Body() input: ReassignDeliveryDto, @Req() request: Request) {
    return this.deliveries.reassign(id, input, request);
  }

  @Post(':id/transitions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequirePermissions('deliveries.update')
  @ApiOperation({ summary: 'Apply an allowed reversible manual delivery transition' })
  @ApiOkResponse({ type: AdminDeliveryResponseDto })
  transition(
    @Param('id') id: string,
    @Body() input: TransitionDeliveryDto,
    @Req() request: Request,
  ) {
    return this.deliveries.transition(id, input, request);
  }

  @Post(':id/attempts')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequirePermissions('deliveries.update')
  @ApiOperation({ summary: 'Record one controlled non-success delivery attempt' })
  @ApiOkResponse({ type: AdminDeliveryResponseDto })
  recordAttempt(
    @Param('id') id: string,
    @Body() input: RecordDeliveryAttemptDto,
    @Req() request: Request,
  ) {
    return this.deliveries.recordAttempt(id, input, request);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOperation({
    summary: 'Complete a delivery only after age and exact COD evidence are durable',
  })
  @ApiOkResponse({ type: AdminDeliveryResponseDto })
  complete(@Param('id') id: string, @Body() input: CompleteDeliveryDto, @Req() request: Request) {
    return this.deliveries.complete(id, input, request);
  }

  @Post(':id/return-complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOperation({
    summary: 'Record return-to-sender completion without automatically restoring inventory',
  })
  @ApiOkResponse({ type: AdminDeliveryResponseDto })
  completeReturn(
    @Param('id') id: string,
    @Body() input: CompleteDeliveryReturnDto,
    @Req() request: Request,
  ) {
    return this.deliveries.completeReturn(id, input, request);
  }
}
