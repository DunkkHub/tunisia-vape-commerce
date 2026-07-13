import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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

export const INVENTORY_ADJUSTMENT_OPERATIONS = ['ADD', 'REMOVE', 'SET'] as const;
export type InventoryAdjustmentOperation = (typeof INVENTORY_ADJUSTMENT_OPERATIONS)[number];

export const INVENTORY_ADJUSTMENT_REASONS = [
  'PURCHASE_RECEIPT',
  'STOCK_COUNT_CORRECTION',
  'DAMAGE',
  'EXPIRY',
  'OTHER',
] as const;
export type InventoryAdjustmentReason = (typeof INVENTORY_ADJUSTMENT_REASONS)[number];

export class InventoryItemIdParametersDto {
  @ApiProperty()
  @IsString()
  @Matches(ID_PATTERN)
  @MaxLength(30)
  id!: string;
}

export class InventoryVariantIdParametersDto {
  @ApiProperty()
  @IsString()
  @Matches(ID_PATTERN)
  @MaxLength(30)
  variantId!: string;
}

export class InventoryMovementQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 25;
}

export class ApplyInventoryAdjustmentDto {
  @ApiProperty({ enum: INVENTORY_ADJUSTMENT_OPERATIONS })
  @IsIn(INVENTORY_ADJUSTMENT_OPERATIONS)
  operation!: InventoryAdjustmentOperation;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: DATABASE_INT_MAX,
    description: 'Required only for ADD or REMOVE.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(DATABASE_INT_MAX)
  quantity?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: DATABASE_INT_MAX,
    description: 'Required only for SET.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  targetOnHandQuantity?: number;

  @ApiProperty({ enum: INVENTORY_ADJUSTMENT_REASONS })
  @IsIn(INVENTORY_ADJUSTMENT_REASONS)
  reasonCode!: InventoryAdjustmentReason;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiProperty({ minimum: 1, description: 'Current InventoryItem optimistic-lock version.' })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class UpdateLowStockThresholdDto {
  @ApiProperty({ minimum: 0, maximum: DATABASE_INT_MAX })
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  lowStockThreshold!: number;

  @ApiProperty({ minimum: 1, description: 'Current ProductVariant optimistic-lock version.' })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateInventoryLocationDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Z0-9][A-Z0-9_-]*$/)
  code!: string;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  fulfillsOrders?: boolean;
}

export class CreateInventoryItemDto {
  @ApiProperty()
  @IsString()
  @MaxLength(30)
  @Matches(ID_PATTERN)
  variantId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(30)
  @Matches(ID_PATTERN)
  locationId!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(ID_PATTERN)
  batchId?: string | null;

  @ApiProperty({ minimum: 0, maximum: DATABASE_INT_MAX })
  @IsInt()
  @Min(0)
  @Max(DATABASE_INT_MAX)
  initialQuantity!: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
