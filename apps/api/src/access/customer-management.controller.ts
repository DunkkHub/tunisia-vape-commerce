import {
  Body,
  Controller,
  Get,
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
import { CustomerManagementService } from './customer-management.service';
import {
  AdminCustomerDetailResponseDto,
  AdminCustomerExportResponseDto,
  CreateCustomerNoteDto,
  CustomerNoteResponseDto,
  CustomerPasswordResetResponseDto,
  CustomerSessionRevocationResponseDto,
} from './dto/customer-management.dto';

@ApiTags('administrator-customer-management')
@ApiCookieAuth('admin')
@Controller('admin/customers')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class CustomerManagementController {
  constructor(private readonly customers: CustomerManagementService) {}

  @Get(':id')
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'View a minimized customer operations record' })
  @ApiOkResponse({ type: AdminCustomerDetailResponseDto })
  detail(@Param('id') id: string) {
    return this.customers.detail(id);
  }

  @Get(':id/export')
  @RequirePermissions('customers.export')
  @UseGuards(RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Generate an audited, minimized customer JSON export' })
  @ApiOkResponse({ type: AdminCustomerExportResponseDto })
  exportCustomer(@Param('id') id: string, @Req() request: Request) {
    return this.customers.exportCustomer(id, request.auth!.userId, request);
  }

  @Post(':id/notes')
  @RequirePermissions('customers.update')
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Add an append-only internal customer note' })
  @ApiOkResponse({ type: CustomerNoteResponseDto })
  addNote(@Param('id') id: string, @Body() input: CreateCustomerNoteDto, @Req() request: Request) {
    return this.customers.addNote(id, input, request.auth!.userId, request);
  }

  @Post(':id/password-reset')
  @RequirePermissions('customers.update')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Queue the standard customer password-reset communication' })
  @ApiOkResponse({ type: CustomerPasswordResetResponseDto })
  passwordReset(@Param('id') id: string, @Req() request: Request) {
    return this.customers.triggerPasswordReset(id, request.auth!.userId, request);
  }

  @Post(':id/sessions/revoke')
  @RequirePermissions('customers.update')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Revoke every active customer-realm session for a customer' })
  @ApiOkResponse({ type: CustomerSessionRevocationResponseDto })
  revokeSessions(@Param('id') id: string, @Req() request: Request) {
    return this.customers.revokeSessions(id, request.auth!.userId, request);
  }
}
