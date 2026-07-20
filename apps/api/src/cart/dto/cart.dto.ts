import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class AddCartItemDto {
  @ApiProperty({ description: 'Server-owned published product variant identifier.' })
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  variantId!: string;

  @ApiProperty({ minimum: 1, maximum: 20 })
  @IsInt()
  @Min(1)
  @Max(20)
  quantity!: number;
}

export class UpdateCartItemDto {
  @ApiProperty({ minimum: 1, maximum: 20 })
  @IsInt()
  @Min(1)
  @Max(20)
  quantity!: number;
}

export class CartItemParamDto {
  @ApiProperty()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  id!: string;
}

export class CartImageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty({ nullable: true })
  altText!: string | null;

  @ApiProperty({ required: false })
  width?: number;

  @ApiProperty({ required: false })
  height?: number;
}

export class CartVariantDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty()
  priceMillimes!: number;

  @ApiProperty({ nullable: true })
  promotionalPriceMillimes!: number | null;

  @ApiProperty()
  availableQuantity!: number;

  @ApiProperty({ nullable: true })
  image!: CartImageDto | null;
}

export class CartProductDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ nullable: true })
  shortDescription!: string | null;

  @ApiProperty({ nullable: true })
  brandName!: string | null;

  @ApiProperty({ nullable: true })
  brandSlug!: string | null;

  @ApiProperty()
  productType!: string;

  @ApiProperty({ nullable: true })
  flavor!: string | null;

  @ApiProperty()
  priceMillimes!: number;

  @ApiProperty({ nullable: true })
  promotionalPriceMillimes!: number | null;

  @ApiProperty()
  availableQuantity!: number;

  @ApiProperty()
  lowStock!: boolean;

  @ApiProperty()
  ageRestricted!: boolean;

  @ApiProperty({ nullable: true })
  primaryImage!: CartImageDto | null;
}

export class CartItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  unitPriceMillimes!: number;

  @ApiProperty()
  lineTotalMillimes!: number;

  @ApiProperty({ type: CartProductDto })
  product!: CartProductDto;

  @ApiProperty({ type: CartVariantDto })
  variant!: CartVariantDto;
}

export class CartDataDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: [CartItemDto] })
  items!: CartItemDto[];

  @ApiProperty()
  itemCount!: number;

  @ApiProperty()
  subtotalMillimes!: number;
}

export class CartResponseDto {
  @ApiProperty({ type: CartDataDto })
  data!: CartDataDto;
}

export class CartSummaryDataDto {
  @ApiProperty()
  itemCount!: number;
}

export class CartSummaryResponseDto {
  @ApiProperty({ type: CartSummaryDataDto })
  data!: CartSummaryDataDto;
}
