import {
  Body,
  Controller,
  Get,
  Param,
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
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { SuperAdministratorGuard } from '../auth/guards/super-administrator.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { AdminAccountsService } from './admin-accounts.service';
import {
  AccountLifecycleDto,
  AdminAccountListQueryDto,
  AdminAccountListResponseDto,
  AdminAccountResponseDto,
  AnonymizeAdminAccountDto,
  CreateAdminAccountDto,
} from './dto/admin-account.dto';

@ApiTags('administrator-access-management')
@ApiCookieAuth('admin')
@Controller('admin/access/admins')
@UseGuards(AdminSessionGuard, PermissionsGuard, SuperAdministratorGuard)
@RequirePermissions('users.manage', 'system.manage')
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class AdminAccountsController {
  constructor(private readonly accounts: AdminAccountsService) {}

  @Get()
  @ApiOperation({ summary: 'List bounded administrator accounts for super-administrator review' })
  @ApiOkResponse({ type: AdminAccountListResponseDto })
  list(@Query() query: AdminAccountListQueryDto) {
    return this.accounts.list(query);
  }

  @Post()
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({
    summary: 'Create a non-super administrator that must enroll TOTP at first login',
  })
  @ApiCreatedResponse({ type: AdminAccountResponseDto })
  create(@Body() input: CreateAdminAccountDto, @Req() request: Request) {
    return this.accounts.create(input, request.auth!.userId, request);
  }

  @Post(':id/suspend')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Suspend an administrator and revoke every administrator session' })
  @ApiOkResponse({ type: AdminAccountResponseDto })
  suspend(@Param('id') id: string, @Body() input: AccountLifecycleDto, @Req() request: Request) {
    return this.accounts.suspend(id, input, request.auth!.userId, request);
  }

  @Post(':id/reactivate')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Reactivate a suspended administrator without issuing a session' })
  @ApiOkResponse({ type: AdminAccountResponseDto })
  reactivate(@Param('id') id: string, @Body() input: AccountLifecycleDto, @Req() request: Request) {
    return this.accounts.reactivate(id, input, request.auth!.userId, request);
  }

  @Post(':id/anonymize')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({
    summary: 'Irreversibly anonymize a suspended administrator while preserving audit history',
  })
  @ApiOkResponse({ type: AdminAccountResponseDto })
  anonymize(
    @Param('id') id: string,
    @Body() input: AnonymizeAdminAccountDto,
    @Req() request: Request,
  ) {
    return this.accounts.anonymize(id, input, request.auth!.userId, request);
  }
}
