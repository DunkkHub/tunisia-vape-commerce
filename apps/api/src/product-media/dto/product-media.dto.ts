import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const trimText = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : (value as unknown);
const multipartBoolean = ({ value }: TransformFnParams): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value as unknown;
};

export class ProductMediaProductParamDto {
  @ApiProperty()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  productId!: string;
}

export class ProductMediaImageParamDto extends ProductMediaProductParamDto {
  @ApiProperty()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  imageId!: string;
}

export class PublicMediaHashParamDto {
  @ApiProperty({ minLength: 64, maxLength: 64 })
  @IsString()
  @Length(64, 64)
  @Matches(SHA256_PATTERN)
  objectKeyHash!: string;
}

export class ProductMediaListQueryDto {
  @ApiPropertyOptional({ description: 'Limit the list to one variant owner.' })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  variantId?: string;

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

export class UploadProductImageDto {
  @ApiProperty({ minimum: 1, description: 'Current product or variant version.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedOwnerVersion!: number;

  @ApiPropertyOptional({ description: 'When supplied, the image belongs only to this variant.' })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  variantId?: string;

  @ApiProperty({ maxLength: 300 })
  @Transform(trimText)
  @IsString()
  @Length(1, 300)
  altTextFr!: string;

  @ApiProperty({ maxLength: 300 })
  @Transform(trimText)
  @IsString()
  @Length(1, 300)
  altTextAr!: string;

  @ApiPropertyOptional({ default: false })
  @Transform(multipartBoolean)
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class ReplaceProductImageDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedOwnerVersion!: number;

  @ApiPropertyOptional({ maxLength: 300 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @Length(1, 300)
  altTextFr?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @Length(1, 300)
  altTextAr?: string;
}

export class UpdateProductImageMetadataDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedOwnerVersion!: number;

  @ApiPropertyOptional({ maxLength: 300 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @Length(1, 300)
  altTextFr?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @Length(1, 300)
  altTextAr?: string;
}

export class ProductImageOwnerVersionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedOwnerVersion!: number;
}

export class DeleteProductImageQueryDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedOwnerVersion!: number;
}

export class ReorderProductImagesDto extends ProductImageOwnerVersionDto {
  @ApiPropertyOptional({ description: 'Absent for product-owned images.' })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  variantId?: string;

  @ApiProperty({ type: [String], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  @Matches(ID_PATTERN, { each: true })
  imageIds!: string[];
}

export class AdminProductImageDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  productId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  variantId!: string | null;

  @ApiProperty()
  url!: string;

  @ApiProperty()
  contentType!: string;

  @ApiProperty({ minimum: 1 })
  byteSize!: number;

  @ApiProperty()
  checksumSha256!: string;

  @ApiPropertyOptional({ nullable: true, minimum: 1 })
  width!: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1 })
  height!: number | null;

  @ApiProperty()
  altTextFr!: string;

  @ApiProperty()
  altTextAr!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'QUARANTINED'] })
  moderationStatus!: 'PENDING' | 'APPROVED' | 'REJECTED' | 'QUARANTINED';

  @ApiProperty({ minimum: 1 })
  ownerVersion!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AdminProductImageResponseDto {
  @ApiProperty({ type: AdminProductImageDto })
  data!: AdminProductImageDto;
}

export class AdminProductImagePageDto {
  @ApiProperty({ type: [AdminProductImageDto] })
  items!: AdminProductImageDto[];

  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 50 })
  pageSize!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;

  @ApiProperty({ minimum: 0 })
  totalPages!: number;
}

export class AdminProductImageListResponseDto {
  @ApiProperty({ type: AdminProductImagePageDto })
  data!: AdminProductImagePageDto;
}

export class DeleteProductImageDataDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: [true] })
  deleted!: true;

  @ApiProperty({ minimum: 1 })
  ownerVersion!: number;
}

export class DeleteProductImageResponseDto {
  @ApiProperty({ type: DeleteProductImageDataDto })
  data!: DeleteProductImageDataDto;
}

export class ReorderProductImagesDataDto {
  @ApiProperty({ type: [AdminProductImageDto] })
  items!: AdminProductImageDto[];

  @ApiProperty({ minimum: 1 })
  ownerVersion!: number;
}

export class ReorderProductImagesResponseDto {
  @ApiProperty({ type: ReorderProductImagesDataDto })
  data!: ReorderProductImagesDataDto;
}
