import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AdminSessionGuard } from '../auth/guards/admin-session.guard';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RecentAuthenticationGuard } from '../auth/guards/recent-authentication.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { CATALOG_IMPORT_MAX_BYTES, type ParsedCatalogImport } from './catalog-import-contract';
import { CATALOG_IMPORT_HEADERS } from './catalog-import-contract';
import { parseCatalogCsv, parseCatalogJson } from './catalog-import-parser';
import { CatalogMediaImportService } from './catalog-media-import.service';
import {
  CatalogImportService,
  type CatalogImportActor,
  type CatalogImportOptions,
} from './catalog-import.service';
import {
  ApplyCatalogImportDto,
  CatalogImportHistoryQueryDto,
  CatalogImportPreviewDto,
  ImportCatalogMediaDto,
  RollbackCatalogImportDto,
  WotofoImportPreviewDto,
} from './dto/catalog-import.dto';
import { fetchWotofoImportRows } from './wotofo-import-data';

interface UploadedCatalogFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

const actor = (request: Request): CatalogImportActor => {
  const userAgent = request.get('user-agent');
  return {
    userId: request.auth!.userId,
    requestId: request.requestId,
    ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
    ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
};

const options = (
  input: CatalogImportPreviewDto,
  source: CatalogImportOptions['source'],
): CatalogImportOptions => ({
  importKey: input.importKey,
  format: input.format,
  source,
  partialMode: input.partialMode,
  overridePrice: input.overridePrice,
  overrideStatus: input.overrideStatus,
  overrideImages: input.overrideImages,
});

const parseFile = (
  file: UploadedCatalogFile | undefined,
  format: 'CSV' | 'JSON',
): ParsedCatalogImport => {
  if (!file?.buffer || file.size === 0 || file.size !== file.buffer.length) {
    throw new BadRequestException({
      code: 'CATALOG_IMPORT_FILE_REQUIRED',
      message: 'A non-empty catalogue import file is required.',
    });
  }
  return format === 'CSV' ? parseCatalogCsv(file.buffer) : parseCatalogJson(file.buffer);
};

@ApiTags('administrator-catalog-imports')
@ApiCookieAuth('admin')
@Controller('admin/catalog/imports')
@UseGuards(AdminSessionGuard, PermissionsGuard)
@RequirePermissions('catalog.import')
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class CatalogImportController {
  constructor(
    private readonly imports: CatalogImportService,
    private readonly mediaImports: CatalogMediaImportService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List bounded catalogue import history' })
  history(@Query() query: CatalogImportHistoryQueryDto) {
    return this.imports.history(query.page, query.pageSize);
  }

  @Get('template.csv')
  @ApiOperation({ summary: 'Download the versioned, formula-safe catalogue CSV template' })
  template(@Res() response: Response) {
    const example = CATALOG_IMPORT_HEADERS.map((header) => {
      if (header === 'schemaVersion') return '1.0';
      if (header === 'containsNicotine') return 'false';
      return '';
    });
    const csv = `${CATALOG_IMPORT_HEADERS.join(',')}\r\n${example.join(',')}\r\n`;
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="catalog-import-v1.csv"');
    response.send(`\uFEFF${csv}`);
  }

  @Post('preview')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: CATALOG_IMPORT_MAX_BYTES, fields: 8 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Validate and persist a server-side CSV or JSON import preview' })
  preview(
    @Body() input: CatalogImportPreviewDto,
    @UploadedFile() file: UploadedCatalogFile | undefined,
    @Req() request: Request,
  ) {
    return this.imports.preview(
      parseFile(file, input.format),
      options(input, 'ADMIN_UPLOAD'),
      actor(request),
    );
  }

  @Post('wotofo/preview')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify official Wotofo sources and persist a reviewed dry run' })
  async previewWotofo(@Body() input: WotofoImportPreviewDto, @Req() request: Request) {
    const { rows } = await fetchWotofoImportRows();
    return this.imports.preview(
      {
        schemaVersion: '1.0',
        rows: rows.map((row, index) => ({ rowNumber: index + 1, input: row, issues: [] })),
      },
      {
        importKey: input.importKey,
        format: 'WOTOFO',
        source: 'WOTOFO_OFFICIAL',
        partialMode: false,
        overridePrice: false,
        overrideStatus: false,
        overrideImages: false,
      },
      actor(request),
    );
  }

  @Post(':id/apply')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({ summary: 'Atomically apply an unchanged valid server-side preview' })
  apply(@Param('id') id: string, @Body() _input: ApplyCatalogImportDto, @Req() request: Request) {
    return this.imports.apply(id, actor(request));
  }

  @Post(':id/rollback')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @ApiOperation({
    summary: 'Archive an unchanged create-only catalogue batch and record its rollback',
  })
  rollback(
    @Param('id') id: string,
    @Body() _input: RollbackCatalogImportDto,
    @Req() request: Request,
  ) {
    return this.imports.rollback(id, actor(request));
  }

  @Post(':id/media/apply')
  @UseGuards(CsrfGuard, RecentAuthenticationGuard)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Download, validate, and store allowlisted catalogue media with provenance',
  })
  importMedia(
    @Param('id') id: string,
    @Body() _input: ImportCatalogMediaDto,
    @Req() request: Request,
  ) {
    return this.mediaImports.importBatch(id, actor(request));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a catalogue import receipt and its row results' })
  get(@Param('id') id: string) {
    return this.imports.get(id);
  }
}
