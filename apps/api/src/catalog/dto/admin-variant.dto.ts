import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DATABASE_INT_MAX = 2_147_483_647;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MUTABLE_PUBLICATION_STATUSES = ['DRAFT', 'PUBLISHED', 'SUSPENDED'] as const;

export class ProductVariantParametersDto {
  @ApiProperty()
  @IsString()
  @MaxLength(30)
  @Matches(ID_PATTERN)
  productId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(30)
  @Matches(ID_PATTERN)
  variantId!: string;
}

export class ProductParametersDto {
  @ApiProperty()
  @IsString()
  @MaxLength(30)
  @Matches(ID_PATTERN)
  productId!: string;
}

export class CreateProductVariantDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  nameFr!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  nameAr!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  @Matches(/\S/)
  sku!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  color?: string | null;

  @ApiProperty({ minimum: 0, description: 'Integer TND millimes.' })
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  costMillimes!: number;

  @ApiProperty({ minimum: 0, description: 'Integer TND millimes.' })
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  priceMillimes!: number;

  @ApiPropertyOptional({ nullable: true, minimum: 0, description: 'Integer TND millimes.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  promotionalPriceMillimes?: number | null;

  @ApiPropertyOptional({ default: 0, maximum: 10_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  taxRateBps?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  weightGrams?: number;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  lengthMm?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  widthMm?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  heightMm?: number | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  sortOrder?: number;

  @ApiPropertyOptional({ type: [String], maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Matches(ID_PATTERN, { each: true })
  attributeValueIds?: string[];
}

export class UpdateProductVariantDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  nameFr?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  nameAr?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/\S/)
  sku?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  color?: string | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  costMillimes?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  priceMillimes?: number;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  promotionalPriceMillimes?: number | null;

  @ApiPropertyOptional({ maximum: 10_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  taxRateBps?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  weightGrams?: number;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  lengthMm?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  widthMm?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  heightMm?: number | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  sortOrder?: number;

  @ApiPropertyOptional({ enum: MUTABLE_PUBLICATION_STATUSES })
  @IsOptional()
  @IsIn(MUTABLE_PUBLICATION_STATUSES)
  publicationStatus?: (typeof MUTABLE_PUBLICATION_STATUSES)[number];

  @ApiPropertyOptional({ type: [String], maxItems: 30 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Matches(ID_PATTERN, { each: true })
  attributeValueIds?: string[];
}

export class VariantVersionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}
