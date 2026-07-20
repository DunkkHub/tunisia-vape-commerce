import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { AdminDeliveryOperationsService } from './admin-delivery-operations.service';
import { AdminDeliveriesService } from './admin-deliveries.service';
import {
  AdminDeliveryOperationResponseDto,
  AdminCourierOptionsResponseDto,
  AdminDeliveryResponseDto,
  AssignDeliveryDto,
  CompleteDeliveryDto,
  CompleteDeliveryReturnDto,
  CreateDeliveryManifestDto,
  CreateManualCourierDto,
  DeliveryManifestListQueryDto,
  DeliveryStatusExportQueryDto,
  ImportDeliveryStatusCsvDto,
  ManualCourierListQueryDto,
  ReassignDeliveryDto,
  RecordDeliveryAttemptDto,
  TransitionDeliveryManifestDto,
  TransitionDeliveryDto,
  UpdateManualCourierDto,
} from './dto/admin-delivery.dto';

@ApiTags('administrator-delivery')
@ApiCookieAuth('admin')
@Controller('admin/deliveries')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminDeliveriesController {
  constructor(
    private readonly deliveries: AdminDeliveriesService,
    private readonly operations: AdminDeliveryOperationsService,
  ) {}

  @Get('couriers')
  @RequirePermissions('deliveries.read')
  @ApiOperation({ summary: 'List up to 100 active couriers for manual assignment' })
  @ApiOkResponse({ type: AdminCourierOptionsResponseDto })
  couriers() {
    return this.deliveries.listCouriers();
  }

  @Get('courier-records')
  @RequirePermissions('deliveries.read')
  @ApiOperation({ summary: 'List bounded manual courier and driver-contact records' })
  @ApiOkResponse({ type: AdminDeliveryOperationResponseDto })
  courierRecords(@Query() query: ManualCourierListQueryDto) {
    return this.operations.listCourierRecords(query);
  }

  @Post('courier-records')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOperation({ summary: 'Create an audited manual courier record without a provider API' })
  @ApiCreatedResponse({ type: AdminDeliveryOperationResponseDto })
  createCourier(@Body() input: CreateManualCourierDto, @Req() request: Request) {
    return this.operations.createManualCourier(input, request);
  }

  @Patch('courier-records/:id')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOperation({ summary: 'Update, suspend, or archive an eligible manual courier record' })
  @ApiOkResponse({ type: AdminDeliveryOperationResponseDto })
  updateCourier(
    @Param('id') id: string,
    @Body() input: UpdateManualCourierDto,
    @Req() request: Request,
  ) {
    return this.operations.updateManualCourier(id, input, request);
  }

  @Get('manifests')
  @RequirePermissions('deliveries.read')
  @ApiOperation({ summary: 'List bounded delivery manifests' })
  @ApiOkResponse({ type: AdminDeliveryOperationResponseDto })
  manifests(@Query() query: DeliveryManifestListQueryDto) {
    return this.operations.listManifests(query);
  }

  @Get('manifests/:id')
  @RequirePermissions('deliveries.read')
  @ApiOperation({ summary: 'Read an audited, data-minimized dispatch manifest' })
  @ApiOkResponse({ type: AdminDeliveryOperationResponseDto })
  manifest(@Param('id') id: string, @Req() request: Request) {
    return this.operations.getManifest(id, request);
  }

  @Get('manifests/:id/export.csv')
  @UseGuards(RecentAuthenticationGuard)
  @RequirePermissions('deliveries.read', 'reports.export')
  @ApiOperation({ summary: 'Export an audited, formula-neutralized dispatch manifest CSV' })
  @ApiProduces('text/csv')
  async manifestCsv(
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.operations.exportManifestCsv(id, request);
    this.csvResponse(response, result.filename, result.rowCount);
    return result.csv;
  }

  @Post('manifests')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.assign')
  @ApiOperation({ summary: 'Create an atomic draft manifest for assigned courier deliveries' })
  @ApiCreatedResponse({ type: AdminDeliveryOperationResponseDto })
  createManifest(@Body() input: CreateDeliveryManifestDto, @Req() request: Request) {
    return this.operations.createManifest(input, request);
  }

  @Post('manifests/:id/transitions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOperation({ summary: 'Seal, hand over, close, or cancel a delivery manifest' })
  @ApiOkResponse({ type: AdminDeliveryOperationResponseDto })
  transitionManifest(
    @Param('id') id: string,
    @Body() input: TransitionDeliveryManifestDto,
    @Req() request: Request,
  ) {
    return this.operations.transitionManifest(id, input, request);
  }

  @Get('exports/status.csv')
  @UseGuards(RecentAuthenticationGuard)
  @RequirePermissions('deliveries.read', 'reports.export')
  @ApiOperation({ summary: 'Export up to 500 delivery status rows in DELIVERY_STATUS_V1 format' })
  @ApiProduces('text/csv')
  async statusCsv(
    @Query() query: DeliveryStatusExportQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.operations.exportStatusCsv(query, request);
    this.csvResponse(response, result.filename, result.rowCount);
    return result.csv;
  }

  @Post('imports/status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.update')
  @ApiOperation({
    summary: 'Dry-run or atomically apply an idempotent DELIVERY_STATUS_V1 CSV import',
  })
  @ApiOkResponse({ type: AdminDeliveryOperationResponseDto })
  importStatus(@Body() input: ImportDeliveryStatusCsvDto, @Req() request: Request) {
    return this.operations.importStatusCsv(input, request);
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
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.assign')
  @ApiOperation({ summary: 'Assign an active courier without invoking an external integration' })
  @ApiOkResponse({ type: AdminDeliveryResponseDto })
  assign(@Param('id') id: string, @Body() input: AssignDeliveryDto, @Req() request: Request) {
    return this.deliveries.assign(id, input, request);
  }

  @Post(':id/reassign')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @RequirePermissions('deliveries.assign')
  @ApiOperation({ summary: 'Reassign an eligible delivery with a mandatory reason' })
  @ApiOkResponse({ type: AdminDeliveryResponseDto })
  reassign(@Param('id') id: string, @Body() input: ReassignDeliveryDto, @Req() request: Request) {
    return this.deliveries.reassign(id, input, request);
  }

  @Post(':id/transitions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
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
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
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

  private csvResponse(response: Response, filename: string, rowCount: number): void {
    response.type('text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.setHeader('X-Export-Row-Count', String(rowCount));
  }
}
