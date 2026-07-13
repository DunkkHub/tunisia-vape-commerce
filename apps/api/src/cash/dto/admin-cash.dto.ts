import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CashCollectionStatus,
  CashDiscrepancyStatus,
  CashRemittanceStatus,
  OrderStatus,
  PaymentStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class AdminCashListQueryDto {
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

export class AdminCollectionListQueryDto extends AdminCashListQueryDto {
  @ApiPropertyOptional({ enum: CashCollectionStatus })
  @IsOptional()
  @IsEnum(CashCollectionStatus)
  status?: CashCollectionStatus;
}

export class AdminRemittanceListQueryDto extends AdminCashListQueryDto {
  @ApiPropertyOptional({ enum: CashRemittanceStatus })
  @IsOptional()
  @IsEnum(CashRemittanceStatus)
  status?: CashRemittanceStatus;
}

export class RecordCashCollectionDto {
  @ApiProperty({ minimum: 0, maximum: 2_000_000_000 })
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  collectedMillimes!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedOrderVersion!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedDeliveryVersion!: number;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  reasonCode?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Length(4, 1000)
  @Matches(/\S/)
  reasonDetail?: string;

  @ApiProperty({ enum: ['RECORD_COLLECTION'] })
  @Equals('RECORD_COLLECTION')
  confirmation!: 'RECORD_COLLECTION';
}

export class RemittanceAllocationDto {
  @ApiProperty()
  @IsString()
  @Length(1, 30)
  cashCollectionId!: string;

  @ApiProperty({ minimum: 1, maximum: 2_000_000_000 })
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  amountMillimes!: number;
}

export class CreateCashRemittanceDto {
  @ApiProperty()
  @IsString()
  @Length(1, 30)
  courierId!: string;

  @ApiProperty({ minLength: 4, maxLength: 60 })
  @IsString()
  @Length(4, 60)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  remittanceNumber!: string;

  @ApiProperty({ minimum: 1, maximum: 2_000_000_000 })
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  declaredMillimes!: number;

  @ApiProperty({ type: () => [RemittanceAllocationDto], maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RemittanceAllocationDto)
  allocations!: RemittanceAllocationDto[];

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Matches(/\S/)
  note?: string;

  @ApiProperty({ enum: ['CREATE_REMITTANCE'] })
  @Equals('CREATE_REMITTANCE')
  confirmation!: 'CREATE_REMITTANCE';
}

export class SubmitCashRemittanceDto {
  @ApiProperty({ enum: ['SUBMIT_REMITTANCE'] })
  @Equals('SUBMIT_REMITTANCE')
  confirmation!: 'SUBMIT_REMITTANCE';
}

export class ReconcileCashRemittanceDto {
  @ApiProperty({ minimum: 0, maximum: 2_000_000_000 })
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  verifiedMillimes!: number;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  reasonCode?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Length(4, 1000)
  @Matches(/\S/)
  reasonDetail?: string;

  @ApiProperty({ enum: ['RECONCILE_REMITTANCE'] })
  @Equals('RECONCILE_REMITTANCE')
  confirmation!: 'RECONCILE_REMITTANCE';
}

export class ResolveCashDiscrepancyDto {
  @ApiProperty({ enum: [CashDiscrepancyStatus.RESOLVED, CashDiscrepancyStatus.WRITTEN_OFF] })
  @IsIn([CashDiscrepancyStatus.RESOLVED, CashDiscrepancyStatus.WRITTEN_OFF])
  resolution!: 'RESOLVED' | 'WRITTEN_OFF';

  @ApiPropertyOptional({ minimum: 0, maximum: 2_000_000_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  finalVerifiedMillimes?: number;

  @ApiProperty({ minLength: 4, maxLength: 1000 })
  @IsString()
  @Length(4, 1000)
  @Matches(/\S/)
  reasonDetail!: string;

  @ApiProperty({ enum: ['RESOLVE_DISCREPANCY'] })
  @Equals('RESOLVE_DISCREPANCY')
  confirmation!: 'RESOLVE_DISCREPANCY';
}

export class AdminCashCollectionListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiPropertyOptional({ nullable: true })
  courierName!: string | null;

  @ApiProperty({ enum: CashCollectionStatus })
  status!: CashCollectionStatus;

  @ApiProperty({ enum: PaymentStatus })
  paymentStatus!: PaymentStatus;

  @ApiProperty({ minimum: 0 })
  expectedMillimes!: number;

  @ApiProperty({ minimum: 0 })
  collectedMillimes!: number;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  collectedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AdminCashRemittanceListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  remittanceNumber!: string;

  @ApiProperty()
  courierName!: string;

  @ApiProperty({ enum: CashRemittanceStatus })
  status!: CashRemittanceStatus;

  @ApiProperty({ minimum: 0 })
  declaredMillimes!: number;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  verifiedMillimes!: number | null;

  @ApiPropertyOptional({ nullable: true })
  differenceMillimes!: number | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

abstract class AdminCashPageDto {
  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  totalPages!: number;
}

class AdminCashCollectionPageDto extends AdminCashPageDto {
  @ApiProperty({ type: () => [AdminCashCollectionListItemDto] })
  items!: AdminCashCollectionListItemDto[];
}

class AdminCashRemittancePageDto extends AdminCashPageDto {
  @ApiProperty({ type: () => [AdminCashRemittanceListItemDto] })
  items!: AdminCashRemittanceListItemDto[];
}

export class AdminCashCollectionListResponseDto {
  @ApiProperty({ type: () => AdminCashCollectionPageDto })
  data!: AdminCashCollectionPageDto;
}

export class AdminCashRemittanceListResponseDto {
  @ApiProperty({ type: () => AdminCashRemittancePageDto })
  data!: AdminCashRemittancePageDto;
}

export class AdminCashCollectionDetailDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiProperty({ enum: OrderStatus })
  orderStatus!: OrderStatus;

  @ApiProperty({ enum: PaymentStatus })
  paymentStatus!: PaymentStatus;

  @ApiProperty({ minimum: 1 })
  orderVersion!: number;

  @ApiPropertyOptional({ nullable: true })
  deliveryId!: string | null;

  @ApiPropertyOptional({ type: 'object', nullable: true, additionalProperties: true })
  delivery!: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  courierId!: string | null;

  @ApiProperty({ enum: CashCollectionStatus })
  status!: CashCollectionStatus;

  @ApiProperty({ minimum: 0 })
  expectedMillimes!: number;

  @ApiProperty({ minimum: 0 })
  collectedMillimes!: number;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  collectedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  collectedByUserId!: string | null;

  @ApiProperty()
  method!: string;

  @ApiPropertyOptional({ nullable: true })
  note!: string | null;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  allocations!: Record<string, unknown>[];

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  discrepancies!: Record<string, unknown>[];

  @ApiProperty()
  historyTruncated!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AdminCashRemittanceDetailDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  remittanceNumber!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  courier!: Record<string, unknown>;

  @ApiProperty({ enum: CashRemittanceStatus })
  status!: CashRemittanceStatus;

  @ApiProperty({ minimum: 0 })
  declaredMillimes!: number;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  verifiedMillimes!: number | null;

  @ApiPropertyOptional({ nullable: true })
  differenceMillimes!: number | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  submittedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  remittedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  receivedByUserId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  verifiedByUserId!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  verifiedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  note!: string | null;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  items!: Record<string, unknown>[];

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  discrepancies!: Record<string, unknown>[];

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  events!: Record<string, unknown>[];

  @ApiProperty()
  historyTruncated!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AdminCashCollectionResponseDto {
  @ApiProperty({ type: () => AdminCashCollectionDetailDto })
  data!: AdminCashCollectionDetailDto;
}

export class AdminCashRemittanceResponseDto {
  @ApiProperty({ type: () => AdminCashRemittanceDetailDto })
  data!: AdminCashRemittanceDetailDto;
}
