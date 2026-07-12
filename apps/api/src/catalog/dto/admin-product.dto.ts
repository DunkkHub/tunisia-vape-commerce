import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DATABASE_INT_MAX = 2_147_483_647;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRODUCT_TYPES = [
  'DEVICE',
  'E_LIQUID',
  'POD',
  'COIL',
  'DISPOSABLE',
  'ACCESSORY',
  'OTHER',
] as const;
const MUTABLE_PUBLICATION_STATUSES = ['DRAFT', 'PUBLISHED', 'SUSPENDED'] as const;

export type ProductTypeInput = (typeof PRODUCT_TYPES)[number];
export type MutablePublicationStatus = (typeof MUTABLE_PUBLICATION_STATUSES)[number];

export class AdminProductListQueryDto {
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
  limit: number = 20;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class CreateProductDto {
  @ApiProperty()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  categoryId!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  brandId?: string | null;

  @ApiProperty({ maxLength: 240 })
  @IsString()
  @Length(1, 240)
  @Matches(/\S/)
  nameFr!: string;

  @ApiProperty({ maxLength: 240 })
  @IsString()
  @Length(1, 240)
  @Matches(/\S/)
  nameAr!: string;

  @ApiProperty({ pattern: SLUG_PATTERN.source })
  @IsString()
  @MaxLength(260)
  @Matches(SLUG_PATTERN)
  slug!: string;

  @ApiProperty({ enum: PRODUCT_TYPES })
  @IsIn(PRODUCT_TYPES)
  productType!: ProductTypeInput;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  shortDescriptionFr?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  shortDescriptionAr?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  descriptionFr?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  descriptionAr?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  containsNicotine?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  flavor?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  deviceType?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  puffCount?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deviceCompatibility?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Integer Tunisian millimes.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  baseCostMillimes?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Integer Tunisian millimes.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  basePriceMillimes?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Integer Tunisian millimes.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  promotionalPriceMillimes?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  taxCategory?: string | null;

  @ApiPropertyOptional({ default: 0, maximum: 10_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  taxRateBps?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  warningFr?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  warningAr?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  minimumAge?: number | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}

export class UpdateProductDto {
  @ApiProperty({ description: 'Current optimistic-lock version.' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  categoryId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  brandId?: string | null;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @Length(1, 240)
  @Matches(/\S/)
  nameFr?: string;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @Length(1, 240)
  @Matches(/\S/)
  nameAr?: string;

  @ApiPropertyOptional({ pattern: SLUG_PATTERN.source })
  @IsOptional()
  @IsString()
  @MaxLength(260)
  @Matches(SLUG_PATTERN)
  slug?: string;

  @ApiPropertyOptional({ enum: PRODUCT_TYPES })
  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  productType?: ProductTypeInput;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  shortDescriptionFr?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  shortDescriptionAr?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  descriptionFr?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  descriptionAr?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  containsNicotine?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  flavor?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  deviceType?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  puffCount?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deviceCompatibility?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Integer Tunisian millimes.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  baseCostMillimes?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Integer Tunisian millimes.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  basePriceMillimes?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Integer Tunisian millimes.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  promotionalPriceMillimes?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  taxCategory?: string | null;

  @ApiPropertyOptional({ maximum: 10_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  taxRateBps?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  warningFr?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  warningAr?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  minimumAge?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ enum: MUTABLE_PUBLICATION_STATUSES })
  @IsOptional()
  @IsIn(MUTABLE_PUBLICATION_STATUSES)
  publicationStatus?: MutablePublicationStatus;
}

export class ProductVersionDto {
  @ApiProperty({ description: 'Current optimistic-lock version.' })
  @IsInt()
  @Min(1)
  version!: number;
}
