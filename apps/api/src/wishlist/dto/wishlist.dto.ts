import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class WishlistQueryDto {
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

export class AddWishlistItemDto {
  @ApiProperty({ description: 'Published product variant identifier.' })
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  variantId!: string;
}

export class WishlistVariantParamDto {
  @ApiProperty()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  variantId!: string;
}

export class WishlistProductImageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  url!: string;

  @ApiPropertyOptional({ nullable: true })
  altText!: string | null;
}

export class WishlistProductDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiPropertyOptional({ nullable: true })
  shortDescription!: string | null;

  @ApiPropertyOptional({ nullable: true })
  brandName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  brandSlug!: string | null;

  @ApiProperty({ enum: ProductType })
  productType!: ProductType;

  @ApiPropertyOptional({ nullable: true })
  flavor!: string | null;

  @ApiProperty({ minimum: 0, description: 'Integer Tunisian millimes.' })
  priceMillimes!: number;

  @ApiPropertyOptional({ nullable: true, description: 'Integer Tunisian millimes.' })
  promotionalPriceMillimes!: number | null;

  @ApiProperty({ minimum: 0 })
  availableQuantity!: number;

  @ApiProperty()
  lowStock!: boolean;

  @ApiProperty()
  ageRestricted!: boolean;

  @ApiPropertyOptional({ nullable: true, type: WishlistProductImageDto })
  primaryImage!: WishlistProductImageDto | null;
}

export class WishlistPageDto {
  @ApiProperty({ type: [WishlistProductDto] })
  items!: WishlistProductDto[];

  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 50 })
  pageSize!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;

  @ApiProperty({ minimum: 0 })
  totalPages!: number;
}

export class WishlistResponseDto {
  @ApiProperty({ type: WishlistPageDto })
  data!: WishlistPageDto;
}

export class WishlistMutationDataDto {
  @ApiProperty()
  variantId!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty()
  saved!: boolean;
}

export class WishlistMutationResponseDto {
  @ApiProperty({ type: WishlistMutationDataDto })
  data!: WishlistMutationDataDto;
}
