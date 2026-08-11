import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { AdminCashService } from './admin-cash.service';
import {
  AdminCashCollectionListResponseDto,
  AdminCashCollectionResponseDto,
  AdminCashRemittanceListResponseDto,
  AdminCashRemittanceResponseDto,
  AdminCollectionListQueryDto,
  AdminRemittanceListQueryDto,
  CreateCashRemittanceDto,
  ReconcileCashRemittanceDto,
  RecordCashCollectionDto,
  ResolveCashDiscrepancyDto,
  SubmitCashRemittanceDto,
} from './dto/admin-cash.dto';

@ApiTags('administrator-cash')
@ApiCookieAuth('admin')
@ApiExtraModels(AdminCashCollectionResponseDto, AdminCashRemittanceResponseDto)
@Controller('admin/cash')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminCashController {
  constructor(private readonly cash: AdminCashService) {}

  @Get('collections')
  @RequirePermissions('cash.read')
  @ApiOperation({ summary: 'List bounded expected and recorded COD collections' })
  @ApiOkResponse({ type: AdminCashCollectionListResponseDto })
  collections(@Query() query: AdminCollectionListQueryDto) {
    return this.cash.listCollections(query);
  }

  @Get('collections/export.csv')
  @UseGuards(RecentAuthenticationGuard)
  @RequirePermissions('cash.read', 'reports.export')
  @ApiOperation({ summary: 'Export up to 500 filtered COD collection rows as audited safe CSV' })
  @ApiProduces('text/csv')
  async collectionCsv(
    @Query() query: AdminCollectionListQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.cash.exportCollections(query, request);
    this.csvResponse(response, result.filename, result.rowCount);
    return result.csv;
  }

  @Get('collections/:id')
  @RequirePermissions('cash.read')
  @ApiOperation({ summary: 'Get one COD collection and its bounded allocation history' })
  @ApiOkResponse({ type: AdminCashCollectionResponseDto })
  collection(@Param('id') id: string) {
    return this.cash.getCollection(id);
  }

  @Post('collections/:id/record')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('cash.collect')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'A stable 16-128 character key reused only to retry this exact collection.',
  })
  @ApiOperation({ summary: 'Record physical cash against exactly one expected collection' })
  @ApiOkResponse({ type: AdminCashCollectionResponseDto })
  recordCollection(
    @Param('id') id: string,
    @Body() input: RecordCashCollectionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    return this.cash.recordCollection(id, input, idempotencyKey, request);
  }

  @Get('remittances')
  @RequirePermissions('cash.read')
  @ApiOperation({ summary: 'List bounded courier remittances' })
  @ApiOkResponse({ type: AdminCashRemittanceListResponseDto })
  remittances(@Query() query: AdminRemittanceListQueryDto) {
    return this.cash.listRemittances(query);
  }

  @Get('remittances/export.csv')
  @UseGuards(RecentAuthenticationGuard)
  @RequirePermissions('cash.read', 'reports.export')
  @ApiOperation({ summary: 'Export up to 500 filtered COD remittance rows as audited safe CSV' })
  @ApiProduces('text/csv')
  async remittanceCsv(
    @Query() query: AdminRemittanceListQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.cash.exportRemittances(query, request);
    this.csvResponse(response, result.filename, result.rowCount);
    return result.csv;
  }

  @Get('remittances/:id')
  @RequirePermissions('cash.read')
  @ApiOperation({ summary: 'Get remittance allocations, discrepancies, and bounded history' })
  @ApiOkResponse({ type: AdminCashRemittanceResponseDto })
  remittance(@Param('id') id: string) {
    return this.cash.getRemittance(id);
  }

  @Post('remittances')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('cash.remit')
  @ApiOperation({ summary: 'Create a draft courier remittance with locked allocations' })
  @ApiOkResponse({ type: AdminCashRemittanceResponseDto })
  createRemittance(@Body() input: CreateCashRemittanceDto, @Req() request: Request) {
    return this.cash.createRemittance(input, request);
  }

  @Post('remittances/:id/submit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('cash.remit')
  @ApiOperation({ summary: 'Submit a draft remittance into cash custody review' })
  @ApiOkResponse({ type: AdminCashRemittanceResponseDto })
  submitRemittance(
    @Param('id') id: string,
    @Body() input: SubmitCashRemittanceDto,
    @Req() request: Request,
  ) {
    return this.cash.submitRemittance(id, input, request);
  }

  @Post('remittances/:id/reconcile')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('cash.reconcile')
  @ApiOperation({ summary: 'Verify a submitted remittance or open a reasoned discrepancy' })
  @ApiOkResponse({ type: AdminCashRemittanceResponseDto })
  reconcileRemittance(
    @Param('id') id: string,
    @Body() input: ReconcileCashRemittanceDto,
    @Req() request: Request,
  ) {
    return this.cash.reconcileRemittance(id, input, request);
  }

  @Post('discrepancies/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('cash.reconcile')
  @ApiOperation({ summary: 'Resolve or write off an open collection or remittance discrepancy' })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AdminCashCollectionResponseDto) },
        { $ref: getSchemaPath(AdminCashRemittanceResponseDto) },
      ],
    },
  })
  resolveDiscrepancy(
    @Param('id') id: string,
    @Body() input: ResolveCashDiscrepancyDto,
    @Req() request: Request,
  ) {
    return this.cash.resolveDiscrepancy(id, input, request);
  }

  private csvResponse(response: Response, filename: string, rowCount: number): void {
    response.type('text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.setHeader('X-Export-Row-Count', String(rowCount));
  }
}
