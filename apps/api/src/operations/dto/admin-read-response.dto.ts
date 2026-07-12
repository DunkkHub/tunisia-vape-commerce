import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

abstract class AdminPageDto {
  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 50 })
  pageSize!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;

  @ApiProperty({ minimum: 0 })
  totalPages!: number;
}

export class AdminInventoryItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  brandName!: string | null;

  @ApiProperty()
  productType!: string;

  @ApiPropertyOptional({ nullable: true })
  flavor!: string | null;

  @ApiProperty({ minimum: 0 })
  onHandQuantity!: number;

  @ApiProperty({ minimum: 0 })
  reservedQuantity!: number;

  @ApiProperty({ description: 'Eligible on-hand minus active, unexpired reservations.' })
  remainingQuantity!: number;

  @ApiProperty({ description: 'Compatibility alias of remainingQuantity.' })
  availableQuantity!: number;

  @ApiProperty({ minimum: 0 })
  lowStockThreshold!: number;

  @ApiProperty()
  status!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AdminInventoryGroupDto {
  @ApiPropertyOptional({ nullable: true })
  brandId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  brandName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  flavor?: string | null;

  @ApiPropertyOptional()
  productType?: string;

  @ApiProperty({ minimum: 0 })
  onHandQuantity!: number;

  @ApiProperty({ minimum: 0 })
  reservedQuantity!: number;

  @ApiProperty()
  remainingQuantity!: number;
}

class AdminInventoryGroupingDto {
  @ApiProperty({ enum: ['FILTERED_RESULT'] })
  scope!: 'FILTERED_RESULT';

  @ApiProperty({ type: () => [AdminInventoryGroupDto] })
  byBrand!: AdminInventoryGroupDto[];

  @ApiProperty({ type: () => [AdminInventoryGroupDto] })
  byProductType!: AdminInventoryGroupDto[];

  @ApiProperty({ type: () => [AdminInventoryGroupDto] })
  byFlavor!: AdminInventoryGroupDto[];

  @ApiProperty({ type: () => [AdminInventoryGroupDto] })
  byBrandAndFlavor!: AdminInventoryGroupDto[];
}

class AdminInventoryPageDto extends AdminPageDto {
  @ApiProperty({ type: () => [AdminInventoryItemDto] })
  items!: AdminInventoryItemDto[];

  @ApiProperty({ format: 'date-time' })
  asOf!: string;

  @ApiProperty()
  availabilityDefinition!: string;

  @ApiProperty({ type: () => AdminInventoryGroupingDto })
  grouping!: AdminInventoryGroupingDto;
}

export class AdminInventoryResponseDto {
  @ApiProperty({ type: () => AdminInventoryPageDto })
  data!: AdminInventoryPageDto;
}

export class AdminSettingItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Underlying record ID within its scope.' })
  sourceId!: string;

  @ApiProperty({ enum: ['STORE', 'COMPLIANCE'] })
  scope!: 'STORE' | 'COMPLIANCE';

  @ApiProperty()
  key!: string;

  @ApiProperty()
  valueType!: string;

  @ApiProperty({ nullable: true, description: 'Null whenever redacted is true.' })
  value!: unknown;

  @ApiProperty()
  redacted!: boolean;

  @ApiPropertyOptional({ nullable: true })
  legallyReviewed!: boolean | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  reviewedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

class AdminSettingsPageDto extends AdminPageDto {
  @ApiProperty({ type: () => [AdminSettingItemDto] })
  items!: AdminSettingItemDto[];
}

export class AdminSettingsResponseDto {
  @ApiProperty({ type: () => AdminSettingsPageDto })
  data!: AdminSettingsPageDto;
}

export class AdminAuditItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  actorName!: string;

  @ApiProperty()
  actorType!: string;

  @ApiProperty()
  action!: string;

  @ApiProperty()
  resourceType!: string;

  @ApiPropertyOptional({ nullable: true })
  resourceId!: string | null;

  @ApiProperty()
  outcome!: string;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;
}

class AdminAuditPageDto extends AdminPageDto {
  @ApiProperty({ type: () => [AdminAuditItemDto] })
  items!: AdminAuditItemDto[];
}

export class AdminAuditResponseDto {
  @ApiProperty({ type: () => AdminAuditPageDto })
  data!: AdminAuditPageDto;
}

class AdminDashboardPeriodDto {
  @ApiProperty({ enum: ['ROLLING'] })
  kind!: 'ROLLING';

  @ApiProperty({ minimum: 1, maximum: 90 })
  days!: number;

  @ApiProperty({ format: 'date-time' })
  startInclusive!: string;

  @ApiProperty({ format: 'date-time' })
  endExclusive!: string;

  @ApiProperty({ enum: ['Africa/Tunis'] })
  timezone!: 'Africa/Tunis';
}

class AdminDashboardDataDto {
  @ApiProperty({ format: 'date-time' })
  asOf!: string;

  @ApiProperty({ type: () => AdminDashboardPeriodDto })
  period!: AdminDashboardPeriodDto;

  @ApiProperty({ enum: ['TND'] })
  currency!: 'TND';

  @ApiProperty({ minimum: 0 })
  ordersCreated!: number;

  @ApiProperty({ minimum: 0 })
  ordersDelivered!: number;

  @ApiProperty({ minimum: 0, description: 'Integer Tunisian millimes.' })
  codExpectedMillimes!: number;

  @ApiProperty({ minimum: 0, description: 'Integer Tunisian millimes.' })
  codRemittedMillimes!: number;

  @ApiProperty({ minimum: 0 })
  lowStockCount!: number;

  @ApiProperty({ minimum: 0 })
  deliveryFailureCount!: number;

  @ApiProperty({ additionalProperties: { type: 'string' } })
  definitions!: Record<string, string>;
}

export class AdminDashboardResponseDto {
  @ApiProperty({ type: () => AdminDashboardDataDto })
  data!: AdminDashboardDataDto;
}
