import {
  Body,
  Controller,
  Param,
  Patch,
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
import { AdminSettingsService } from './admin-settings.service';
import {
  SettingKeyParametersDto,
  StoreConfigurationExportResponseDto,
  UpdateOperationalSettingDto,
} from './dto/admin-settings.dto';

@ApiTags('administrator-settings')
@ApiCookieAuth('admin')
@Controller('admin/settings')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Post('export')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Generate an audited, bounded configuration export without secrets' })
  @ApiOkResponse({ type: StoreConfigurationExportResponseDto })
  exportConfiguration(@Req() request: Request) {
    return this.settings.exportConfiguration(request);
  }

  @Patch('store/:key')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Update an allowlisted store setting with audit evidence' })
  updateStore(
    @Param() parameters: SettingKeyParametersDto,
    @Body() input: UpdateOperationalSettingDto,
    @Req() request: Request,
  ) {
    return this.settings.update('store', parameters.key, input, request);
  }

  @Patch('compliance/:key')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('compliance.manage')
  @ApiOperation({ summary: 'Update an allowlisted compliance setting with audit evidence' })
  updateCompliance(
    @Param() parameters: SettingKeyParametersDto,
    @Body() input: UpdateOperationalSettingDto,
    @Req() request: Request,
  ) {
    return this.settings.update('compliance', parameters.key, input, request);
  }
}
