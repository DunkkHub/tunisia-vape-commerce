import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PublicationStatus } from '@prisma/client';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MUTABLE_PUBLICATION_STATUSES = ['DRAFT', 'PUBLISHED', 'SUSPENDED'] as const;
const trimText = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : (value as unknown);

export type MutableTaxonomyStatus = (typeof MUTABLE_PUBLICATION_STATUSES)[number];

export class TaxonomyIdParamDto {
  @ApiProperty()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  id!: string;
}

export class TaxonomyListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 100_000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({ maxLength: 80 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ enum: PublicationStatus })
  @IsOptional()
  @IsEnum(PublicationStatus)
  status?: PublicationStatus;

  @ApiPropertyOptional({ enum: ['name_asc', 'name_desc', 'updated_desc'], default: 'name_asc' })
  @IsOptional()
  @IsIn(['name_asc', 'name_desc', 'updated_desc'])
  sort: 'name_asc' | 'name_desc' | 'updated_desc' = 'name_asc';
}

export class CategoryListQueryDto extends TaxonomyListQueryDto {
  @ApiPropertyOptional({ description: 'Exact parent category ID.' })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  parentId?: string;
}

export class CreateBrandDto {
  @ApiProperty({ maxLength: 160 })
  @Transform(trimText)
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  name!: string;

  @ApiProperty({ maxLength: 180, pattern: SLUG_PATTERN.source })
  @Transform(trimText)
  @IsString()
  @Length(1, 180)
  @Matches(SLUG_PATTERN)
  slug!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 20_000 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  descriptionFr?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 20_000 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  descriptionAr?: string | null;
}

export class UpdateBrandDto {
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true, strictSeparator: true })
  expectedUpdatedAt!: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  name?: string;

  @ApiPropertyOptional({ maxLength: 180, pattern: SLUG_PATTERN.source })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @Length(1, 180)
  @Matches(SLUG_PATTERN)
  slug?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 20_000 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  descriptionFr?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 20_000 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  descriptionAr?: string | null;

  @ApiPropertyOptional({ enum: MUTABLE_PUBLICATION_STATUSES })
  @IsOptional()
  @IsIn(MUTABLE_PUBLICATION_STATUSES)
  publicationStatus?: MutableTaxonomyStatus;
}

export class CreateCategoryDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  parentId?: string | null;

  @ApiProperty({ maxLength: 160 })
  @Transform(trimText)
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  nameFr!: string;

  @ApiProperty({ maxLength: 160 })
  @Transform(trimText)
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  nameAr!: string;

  @ApiProperty({ maxLength: 180, pattern: SLUG_PATTERN.source })
  @Transform(trimText)
  @IsString()
  @Length(1, 180)
  @Matches(SLUG_PATTERN)
  slug!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 20_000 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  descriptionFr?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 20_000 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  descriptionAr?: string | null;

  @ApiPropertyOptional({ default: 0, minimum: -1_000_000, maximum: 1_000_000 })
  @IsOptional()
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true, strictSeparator: true })
  expectedUpdatedAt!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  parentId?: string | null;

  @ApiPropertyOptional({ maxLength: 160 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  nameFr?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  nameAr?: string;

  @ApiPropertyOptional({ maxLength: 180, pattern: SLUG_PATTERN.source })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @Length(1, 180)
  @Matches(SLUG_PATTERN)
  slug?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 20_000 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  descriptionFr?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 20_000 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  descriptionAr?: string | null;

  @ApiPropertyOptional({ minimum: -1_000_000, maximum: 1_000_000 })
  @IsOptional()
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  sortOrder?: number;

  @ApiPropertyOptional({ enum: MUTABLE_PUBLICATION_STATUSES })
  @IsOptional()
  @IsIn(MUTABLE_PUBLICATION_STATUSES)
  publicationStatus?: MutableTaxonomyStatus;
}

export class TaxonomyLifecycleDto {
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true, strictSeparator: true })
  expectedUpdatedAt!: string;

  @ApiProperty({ enum: [true] })
  @IsBoolean()
  @Equals(true)
  confirmed!: true;
}

export class AdminBrandDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiPropertyOptional({ nullable: true })
  descriptionFr!: string | null;

  @ApiPropertyOptional({ nullable: true })
  descriptionAr!: string | null;

  @ApiProperty({ enum: PublicationStatus })
  publicationStatus!: PublicationStatus;

  @ApiProperty()
  productCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AdminCategoryDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  parentId!: string | null;

  @ApiProperty()
  nameFr!: string;

  @ApiProperty()
  nameAr!: string;

  @ApiProperty()
  slug!: string;

  @ApiPropertyOptional({ nullable: true })
  descriptionFr!: string | null;

  @ApiPropertyOptional({ nullable: true })
  descriptionAr!: string | null;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ enum: PublicationStatus })
  publicationStatus!: PublicationStatus;

  @ApiProperty()
  productCount!: number;

  @ApiProperty()
  childCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AdminBrandResponseDto {
  @ApiProperty({ type: AdminBrandDto })
  data!: AdminBrandDto;
}

export class AdminCategoryResponseDto {
  @ApiProperty({ type: AdminCategoryDto })
  data!: AdminCategoryDto;
}

export class AdminBrandListDataDto {
  @ApiProperty({ type: [AdminBrandDto] })
  items!: AdminBrandDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  totalPages!: number;
}

export class AdminCategoryListDataDto {
  @ApiProperty({ type: [AdminCategoryDto] })
  items!: AdminCategoryDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  totalPages!: number;
}

export class AdminBrandListResponseDto {
  @ApiProperty({ type: AdminBrandListDataDto })
  data!: AdminBrandListDataDto;
}

export class AdminCategoryListResponseDto {
  @ApiProperty({ type: AdminCategoryListDataDto })
  data!: AdminCategoryListDataDto;
}
