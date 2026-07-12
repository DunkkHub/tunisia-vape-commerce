import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const PRODUCT_TYPES = [
  'DEVICE',
  'E_LIQUID',
  'POD',
  'COIL',
  'DISPOSABLE',
  'ACCESSORY',
  'OTHER',
] as const;
const AUDIT_OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED'] as const;
const AUDIT_ACTOR_TYPES = ['CUSTOMER', 'ADMIN', 'COURIER', 'SYSTEM'] as const;

export type InventoryProductType = (typeof PRODUCT_TYPES)[number];
export type AuditOutcomeFilter = (typeof AUDIT_OUTCOMES)[number];
export type AuditActorTypeFilter = (typeof AUDIT_ACTOR_TYPES)[number];

export class BoundedAdminListQueryDto {
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

export class AdminInventoryQueryDto extends BoundedAdminListQueryDto {
  @ApiPropertyOptional({
    maxLength: 180,
    description: 'Exact brand ID or slug.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  brand?: string;

  @ApiPropertyOptional({ enum: PRODUCT_TYPES })
  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  productType?: InventoryProductType;

  @ApiPropertyOptional({ maxLength: 160, description: 'Exact flavor label.' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  flavor?: string;
}

export class AdminAuditQueryDto extends BoundedAdminListQueryDto {
  @ApiPropertyOptional({ enum: AUDIT_OUTCOMES })
  @IsOptional()
  @IsIn(AUDIT_OUTCOMES)
  outcome?: AuditOutcomeFilter;

  @ApiPropertyOptional({ enum: AUDIT_ACTOR_TYPES })
  @IsOptional()
  @IsIn(AUDIT_ACTOR_TYPES)
  actorType?: AuditActorTypeFilter;
}

export class AdminDashboardQueryDto {
  @ApiPropertyOptional({
    default: 30,
    minimum: 1,
    maximum: 90,
    description: 'Size of the rolling UTC reporting period.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days: number = 30;
}
