import { Controller, Get, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { requestLocale } from '../compliance/age-gate.service';
import { AdminReadService } from './admin-read.service';
import { AdminOperationalMetricsService } from './admin-operational-metrics.service';
import {
  AdminAuditQueryDto,
  AdminDashboardQueryDto,
  AdminInventoryQueryDto,
  BoundedAdminListQueryDto,
} from './dto/admin-read-query.dto';
import {
  AdminAuditResponseDto,
  AdminDashboardResponseDto,
  AdminInventoryResponseDto,
  AdminSettingsResponseDto,
} from './dto/admin-read-response.dto';
import { AdminOperationalMetricsResponseDto } from './dto/admin-operational-metrics.dto';

@ApiTags('administrator-operations')
@ApiCookieAuth('admin')
@Controller('admin')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminReadController {
  constructor(
    private readonly reads: AdminReadService,
    private readonly operationalMetrics: AdminOperationalMetricsService,
  ) {}

  @Get('dashboard')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Read a definition-backed administrator operational snapshot' })
  @ApiOkResponse({ type: AdminDashboardResponseDto })
  dashboard(@Query() query: AdminDashboardQueryDto) {
    return this.reads.dashboard(query);
  }

  @Get('operations/metrics')
  @RequirePermissions('reports.read')
  @ApiOperation({ summary: 'Read a bounded durable-work and worker-health snapshot' })
  @ApiOkResponse({ type: AdminOperationalMetricsResponseDto })
  metrics() {
    return this.operationalMetrics.snapshot();
  }

  @Get('inventory')
  @RequirePermissions('inventory.read')
  @ApiOperation({ summary: 'List derived remaining stock and filtered brand/flavor totals' })
  @ApiOkResponse({ type: AdminInventoryResponseDto })
  inventory(@Query() query: AdminInventoryQueryDto, @Req() request: Request) {
    return this.reads.inventory(query, requestLocale(request));
  }

  @Get('inventory/export.csv')
  @UseGuards(RecentAuthenticationGuard)
  @RequirePermissions('inventory.read', 'reports.export')
  @ApiOperation({ summary: 'Export up to 500 filtered inventory variants as audited safe CSV' })
  @ApiProduces('text/csv')
  async inventoryCsv(
    @Query() query: AdminInventoryQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.reads.exportInventory(query, requestLocale(request), request);
    response.type('text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    response.setHeader('X-Export-Row-Count', String(result.rowCount));
    return result.csv;
  }

  @Get('settings')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'List bounded settings with secret values redacted' })
  @ApiOkResponse({ type: AdminSettingsResponseDto })
  settings(@Query() query: BoundedAdminListQueryDto) {
    return this.reads.settings(query);
  }

  @Get('audit')
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'List a bounded, privacy-minimized administrator audit timeline' })
  @ApiOkResponse({ type: AdminAuditResponseDto })
  audit(@Query() query: AdminAuditQueryDto) {
    return this.reads.audit(query);
  }
}
