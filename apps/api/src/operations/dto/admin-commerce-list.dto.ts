import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AdminCommerceListQueryDto {
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

export class AdminOrderListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiProperty()
  customerName!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ description: 'Integer Tunisian millimes.', minimum: 0 })
  grandTotalMillimes!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

class AdminOrderPageDto extends AdminPageDto {
  @ApiProperty({ type: () => [AdminOrderListItemDto] })
  items!: AdminOrderListItemDto[];
}

export class AdminOrderListResponseDto {
  @ApiProperty({ type: () => AdminOrderPageDto })
  data!: AdminOrderPageDto;
}

export class AdminCustomerListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ description: 'Normalized Tunisian E.164 phone number.' })
  normalizedPhone!: string;

  @ApiPropertyOptional({ nullable: true })
  email!: string | null;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  suspendedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  suspensionReason!: string | null;

  @ApiProperty({ minimum: 1 })
  userVersion!: number;

  @ApiProperty({ minimum: 1 })
  profileVersion!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

class AdminCustomerPageDto extends AdminPageDto {
  @ApiProperty({ type: () => [AdminCustomerListItemDto] })
  items!: AdminCustomerListItemDto[];
}

export class AdminCustomerListResponseDto {
  @ApiProperty({ type: () => AdminCustomerPageDto })
  data!: AdminCustomerPageDto;
}

export class AdminDeliveryListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Courier tracking number, or the order number before assignment.' })
  trackingNumber!: string;

  @ApiPropertyOptional({ nullable: true })
  zoneName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  courierName!: string | null;

  @ApiProperty()
  status!: string;
}

class AdminDeliveryPageDto extends AdminPageDto {
  @ApiProperty({ type: () => [AdminDeliveryListItemDto] })
  items!: AdminDeliveryListItemDto[];
}

export class AdminDeliveryListResponseDto {
  @ApiProperty({ type: () => AdminDeliveryPageDto })
  data!: AdminDeliveryPageDto;
}

export class AdminCashReconciliationListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  courierName!: string;

  @ApiProperty({ description: 'Allocated expected cash in integer Tunisian millimes.', minimum: 0 })
  expectedMillimes!: number;

  @ApiProperty({
    description: 'Remitted or verified cash in integer Tunisian millimes.',
    minimum: 0,
  })
  remittedMillimes!: number;

  @ApiProperty()
  status!: string;
}

class AdminCashReconciliationPageDto extends AdminPageDto {
  @ApiProperty({ type: () => [AdminCashReconciliationListItemDto] })
  items!: AdminCashReconciliationListItemDto[];
}

export class AdminCashReconciliationListResponseDto {
  @ApiProperty({ type: () => AdminCashReconciliationPageDto })
  data!: AdminCashReconciliationPageDto;
}
