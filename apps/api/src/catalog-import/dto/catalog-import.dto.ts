import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const IMPORT_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,99}$/;
const multipartBoolean = ({ value }: TransformFnParams): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value as unknown;
};

export class CatalogImportPreviewDto {
  @ApiProperty({ minLength: 3, maxLength: 100 })
  @IsString()
  @Matches(IMPORT_KEY)
  importKey!: string;

  @ApiProperty({ enum: ['CSV', 'JSON'] })
  @IsIn(['CSV', 'JSON'])
  format!: 'CSV' | 'JSON';

  @ApiPropertyOptional({ default: false })
  @Transform(multipartBoolean)
  @IsOptional()
  @IsBoolean()
  partialMode: boolean = false;

  @ApiPropertyOptional({ default: false })
  @Transform(multipartBoolean)
  @IsOptional()
  @IsBoolean()
  overridePrice: boolean = false;

  @ApiPropertyOptional({ default: false })
  @Transform(multipartBoolean)
  @IsOptional()
  @IsBoolean()
  overrideStatus: boolean = false;

  @ApiPropertyOptional({ default: false })
  @Transform(multipartBoolean)
  @IsOptional()
  @IsBoolean()
  overrideImages: boolean = false;
}

export class WotofoImportPreviewDto {
  @ApiProperty({ minLength: 3, maxLength: 100 })
  @IsString()
  @Matches(IMPORT_KEY)
  importKey!: string;
}

export class ApplyCatalogImportDto {
  @ApiProperty({ enum: ['APPLY_CATALOG_IMPORT'] })
  @IsIn(['APPLY_CATALOG_IMPORT'])
  confirmation!: 'APPLY_CATALOG_IMPORT';
}

export class RollbackCatalogImportDto {
  @ApiProperty({ enum: ['ROLLBACK_CATALOG_IMPORT'] })
  @IsIn(['ROLLBACK_CATALOG_IMPORT'])
  confirmation!: 'ROLLBACK_CATALOG_IMPORT';
}

export class ImportCatalogMediaDto {
  @ApiProperty({ enum: ['IMPORT_CATALOG_MEDIA'] })
  @IsIn(['IMPORT_CATALOG_MEDIA'])
  confirmation!: 'IMPORT_CATALOG_MEDIA';
}

export class CatalogImportHistoryQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 20;
}
