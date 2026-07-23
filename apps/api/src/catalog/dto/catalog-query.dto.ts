import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATABASE_INT_MAX = 2_147_483_647;
export const PUBLIC_PRODUCT_TYPES = [
  'DEVICE',
  'E_LIQUID',
  'POD',
  'PREFILLED_POD_KIT',
  'PREFILLED_REPLACEMENT_POD',
  'COIL',
  'DISPOSABLE',
  'ACCESSORY',
  'OTHER',
] as const;
export type PublicProductType = (typeof PUBLIC_PRODUCT_TYPES)[number];

const normalizeBooleanQuery = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

@ValidatorConstraint({ name: 'catalogPriceRange', async: false })
class CatalogPriceRangeConstraint implements ValidatorConstraintInterface {
  validate(maximum: unknown, args: ValidationArguments): boolean {
    const query = args.object as CatalogProductsQueryDto;
    return (
      maximum === undefined ||
      query.minPriceMillimes === undefined ||
      (typeof maximum === 'number' && maximum >= query.minPriceMillimes)
    );
  }

  defaultMessage(): string {
    return 'maxPriceMillimes must be greater than or equal to minPriceMillimes';
  }
}

export class BoundedPageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 20;
}

export class CatalogProductsQueryDto extends BoundedPageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  @Matches(SLUG_PATTERN)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  @Matches(SLUG_PATTERN)
  brand?: string;

  @IsOptional()
  @IsIn(PUBLIC_PRODUCT_TYPES)
  @ApiPropertyOptional({ enum: PUBLIC_PRODUCT_TYPES })
  productType?: PublicProductType;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Matches(/\S/)
  @ApiPropertyOptional({ maxLength: 160 })
  flavor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DATABASE_INT_MAX)
  @ApiPropertyOptional({ minimum: 1, maximum: DATABASE_INT_MAX })
  puffCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(99_999)
  @ApiPropertyOptional({ minimum: 0, maximum: 99_999, description: 'Milligrams.' })
  nicotineStrengthMg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  @ApiPropertyOptional({ minimum: 0, maximum: DATABASE_INT_MAX, description: 'TND millimes.' })
  minPriceMillimes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  @Validate(CatalogPriceRangeConstraint)
  @ApiPropertyOptional({ minimum: 0, maximum: DATABASE_INT_MAX, description: 'TND millimes.' })
  maxPriceMillimes?: number;

  @IsOptional()
  @Transform(normalizeBooleanQuery)
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsIn(['newest', 'price_asc', 'price_desc', 'name_asc'])
  sort: 'newest' | 'price_asc' | 'price_desc' | 'name_asc' = 'newest';
}
