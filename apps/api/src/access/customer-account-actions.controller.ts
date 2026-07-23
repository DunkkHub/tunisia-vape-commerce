import { Body, Controller, Param, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { SuperAdministratorGuard } from '../auth/guards/super-administrator.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { CustomerAccountActionsService } from './customer-account-actions.service';
import {
  AccountLifecycleDto,
  AnonymizeCustomerAccountDto,
  CustomerAccountResponseDto,
  DisableCustomerAccountDto,
} from './dto/admin-account.dto';

@ApiTags('administrator-customer-account-management')
@ApiCookieAuth('admin')
@Controller('admin/customers')
@UseGuards(AdminSessionGuard, PermissionsGuard, SuperAdministratorGuard)
@RequirePermissions('customers.suspend', 'system.manage')
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class CustomerAccountActionsController {
  constructor(private readonly accounts: CustomerAccountActionsService) {}

  @Post(':id/suspend')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Suspend a customer and revoke only customer-realm sessions' })
  @ApiOkResponse({ type: CustomerAccountResponseDto })
  suspend(@Param('id') id: string, @Body() input: AccountLifecycleDto, @Req() request: Request) {
    return this.accounts.suspend(id, input, request.auth!.userId, request);
  }

  @Post(':id/reactivate')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Reactivate a suspended customer without issuing a session' })
  @ApiOkResponse({ type: CustomerAccountResponseDto })
  reactivate(@Param('id') id: string, @Body() input: AccountLifecycleDto, @Req() request: Request) {
    return this.accounts.reactivate(id, input, request.auth!.userId, request);
  }

  @Post(':id/disable')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({
    summary: 'Disable a suspended customer account without destroying historical commerce records',
  })
  @ApiOkResponse({ type: CustomerAccountResponseDto })
  disable(
    @Param('id') id: string,
    @Body() input: DisableCustomerAccountDto,
    @Req() request: Request,
  ) {
    return this.accounts.disable(id, input, request.auth!.userId, request);
  }

  @Post(':id/anonymize')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({
    summary: 'Anonymize an eligible customer while preserving immutable commerce history',
  })
  @ApiOkResponse({ type: CustomerAccountResponseDto })
  anonymize(
    @Param('id') id: string,
    @Body() input: AnonymizeCustomerAccountDto,
    @Req() request: Request,
  ) {
    return this.accounts.anonymize(id, input, request.auth!.userId, request);
  }
}
