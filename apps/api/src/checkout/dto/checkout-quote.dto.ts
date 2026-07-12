import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class CheckoutQuoteItemDto {
  @ApiProperty()
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

export class CheckoutQuoteDto {
  @ApiProperty({ type: [CheckoutQuoteItemDto], maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CheckoutQuoteItemDto)
  items!: CheckoutQuoteItemDto[];

  @ApiPropertyOptional({
    description: 'Required for courier delivery; exclusive with pickupLocationId.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  localityId?: string;

  @ApiPropertyOptional({ description: 'Required for pickup; exclusive with localityId.' })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  pickupLocationId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  express?: boolean;
}
