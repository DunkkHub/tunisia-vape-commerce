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
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { AdminOrdersService } from './admin-orders.service';
import {
  AdminOrderNoteResponseDto,
  AdminOrderResponseDto,
  AdminOrderContactAttemptResponseDto,
  AdminOrderSlipResponseDto,
  CancelOrderDto,
  ConfirmOrderDto,
  CreateOrderNoteDto,
  RecordOrderContactAttemptDto,
  RejectOrderDto,
  TransitionOrderDto,
} from './dto/admin-order.dto';

@ApiTags('administrator-orders')
@ApiCookieAuth('admin')
@Controller('admin/orders')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get(':id')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Get an operational order detail from immutable snapshots' })
  @ApiOkResponse({ type: AdminOrderResponseDto })
  get(@Param('id') id: string) {
    return this.orders.get(id);
  }

  @Get(':id/slip')
  @RequirePermissions('orders.read')
  @ApiOperation({ summary: 'Generate an audited allowlisted printable order-slip representation' })
  @ApiOkResponse({ type: AdminOrderSlipResponseDto })
  slip(@Param('id') id: string, @Req() request: Request) {
    return this.orders.getSlip(id, request);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('orders.update')
  @ApiOperation({
    summary: 'Confirm a pending order and consume its locked stock reservations once',
  })
  @ApiOkResponse({ type: AdminOrderResponseDto })
  confirm(@Param('id') id: string, @Body() input: ConfirmOrderDto, @Req() request: Request) {
    return this.orders.confirm(id, input, request);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('orders.cancel')
  @ApiOperation({
    summary: 'Cancel an eligible early-state order and release active reservations',
  })
  @ApiOkResponse({ type: AdminOrderResponseDto })
  cancel(@Param('id') id: string, @Body() input: CancelOrderDto, @Req() request: Request) {
    return this.orders.cancel(id, input, request);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('orders.cancel')
  @ApiOperation({ summary: 'Reject a pending intake order with a mandatory reason' })
  @ApiOkResponse({ type: AdminOrderResponseDto })
  reject(@Param('id') id: string, @Body() input: RejectOrderDto, @Req() request: Request) {
    return this.orders.reject(id, input, request);
  }

  @Post(':id/prepare')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequirePermissions('orders.update')
  @ApiOperation({ summary: 'Move a confirmed order into preparation' })
  @ApiOkResponse({ type: AdminOrderResponseDto })
  prepare(@Param('id') id: string, @Body() input: TransitionOrderDto, @Req() request: Request) {
    return this.orders.prepare(id, input, request);
  }

  @Post(':id/ready-for-pickup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequirePermissions('orders.update')
  @ApiOperation({ summary: 'Mark a prepared store-pickup order ready for pickup' })
  @ApiOkResponse({ type: AdminOrderResponseDto })
  readyForPickup(
    @Param('id') id: string,
    @Body() input: TransitionOrderDto,
    @Req() request: Request,
  ) {
    return this.orders.readyForPickup(id, input, request);
  }

  @Post(':id/contact-attempts')
  @UseGuards(CsrfGuard)
  @RequirePermissions('orders.update')
  @ApiOperation({
    summary: 'Record a controlled manual customer-contact attempt without provider claims',
  })
  @ApiCreatedResponse({ type: AdminOrderContactAttemptResponseDto })
  recordContactAttempt(
    @Param('id') id: string,
    @Body() input: RecordOrderContactAttemptDto,
    @Req() request: Request,
  ) {
    return this.orders.recordContactAttempt(id, input, request);
  }

  @Post(':id/notes')
  @UseGuards(CsrfGuard)
  @RequirePermissions('orders.update')
  @ApiOperation({ summary: 'Append a visibility-scoped order note' })
  @ApiCreatedResponse({ type: AdminOrderNoteResponseDto })
  addNote(@Param('id') id: string, @Body() input: CreateOrderNoteDto, @Req() request: Request) {
    return this.orders.addNote(id, input, request);
  }
}
