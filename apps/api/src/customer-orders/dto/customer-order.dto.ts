import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AgeVerificationResult,
  CashCollectionStatus,
  ConsentType,
  DeliveryAttemptOutcome,
  DeliveryMethodType,
  DeliveryStatus,
  OrderAddressType,
  OrderStatus,
  PaymentStatus,
} from '@prisma/client';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const ORDER_NUMBER_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const trimText = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : (value as unknown);

export class CustomerOrderParamDto {
  @ApiProperty()
  @IsString()
  @Length(1, 30)
  @Matches(ORDER_NUMBER_PATTERN)
  orderNumber!: string;
}

export class CustomerOrderListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100_000, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({ enum: ['newest', 'oldest'], default: 'newest' })
  @IsOptional()
  @IsIn(['newest', 'oldest'])
  sort: 'newest' | 'oldest' = 'newest';
}

export class CustomerCancelOrderDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ enum: [true] })
  @IsBoolean()
  @Equals(true)
  confirmed!: true;

  @ApiProperty({ enum: ['CANCEL_ORDER'] })
  @IsString()
  @Equals('CANCEL_ORDER')
  confirmation!: 'CANCEL_ORDER';

  @ApiProperty({ minLength: 4, maxLength: 500 })
  @Transform(trimText)
  @IsString()
  @Length(4, 500)
  @Matches(/\S/)
  reason!: string;
}

export class CustomerOrderSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty({ enum: PaymentStatus })
  paymentStatus!: PaymentStatus;

  @ApiPropertyOptional({ enum: DeliveryStatus, nullable: true })
  deliveryStatus!: DeliveryStatus | null;

  @ApiProperty()
  grandTotalMillimes!: number;

  @ApiProperty({ enum: ['TND'] })
  currency!: string;

  @ApiProperty()
  cancellable!: boolean;

  @ApiProperty()
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CustomerOrderListDataDto {
  @ApiProperty({ type: [CustomerOrderSummaryDto] })
  items!: CustomerOrderSummaryDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  totalPages!: number;
}

export class CustomerOrderListResponseDto {
  @ApiProperty({ type: CustomerOrderListDataDto })
  data!: CustomerOrderListDataDto;
}

export class CustomerOrderItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  variantName!: string;

  @ApiProperty()
  sku!: string;

  @ApiPropertyOptional({ nullable: true })
  warningFr!: string | null;

  @ApiPropertyOptional({ nullable: true })
  warningAr!: string | null;

  @ApiProperty()
  unitPriceMillimes!: number;

  @ApiProperty()
  unitDiscountMillimes!: number;

  @ApiProperty()
  unitTaxMillimes!: number;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  lineSubtotalMillimes!: number;

  @ApiProperty()
  lineDiscountMillimes!: number;

  @ApiProperty()
  lineTaxMillimes!: number;

  @ApiProperty()
  lineTotalMillimes!: number;
}

export class CustomerOrderAddressDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: OrderAddressType })
  type!: OrderAddressType;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  phone!: string;

  @ApiProperty()
  governorate!: string;

  @ApiProperty()
  delegation!: string;

  @ApiPropertyOptional({ nullable: true })
  locality!: string | null;

  @ApiPropertyOptional({ nullable: true })
  postalCode!: string | null;

  @ApiProperty()
  street!: string;

  @ApiPropertyOptional({ nullable: true })
  building!: string | null;

  @ApiPropertyOptional({ nullable: true })
  floor!: string | null;

  @ApiPropertyOptional({ nullable: true })
  apartment!: string | null;

  @ApiPropertyOptional({ nullable: true })
  landmark!: string | null;

  @ApiPropertyOptional({ nullable: true })
  instructions!: string | null;
}

export class CustomerOrderHistoryDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ enum: OrderStatus, nullable: true })
  fromStatus!: OrderStatus | null;

  @ApiProperty({ enum: OrderStatus })
  toStatus!: OrderStatus;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;
}

export class CustomerVisibleOrderNoteDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CustomerDeliveryAttemptDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  attemptNumber!: number;

  @ApiProperty({ enum: DeliveryAttemptOutcome })
  outcome!: DeliveryAttemptOutcome;

  @ApiProperty({ enum: AgeVerificationResult })
  ageVerificationResult!: AgeVerificationResult;

  @ApiProperty({ format: 'date-time' })
  attemptedAt!: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  nextAttemptAt!: string | null;
}

export class CustomerDeliveryEventDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ enum: DeliveryStatus, nullable: true })
  fromStatus!: DeliveryStatus | null;

  @ApiProperty({ enum: DeliveryStatus })
  toStatus!: DeliveryStatus;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;
}

export class CustomerOrderDeliveryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: DeliveryStatus })
  status!: DeliveryStatus;

  @ApiPropertyOptional({ nullable: true })
  trackingNumber!: string | null;

  @ApiPropertyOptional({ nullable: true })
  courierName!: string | null;

  @ApiProperty({ enum: AgeVerificationResult })
  ageVerificationResult!: AgeVerificationResult;

  @ApiPropertyOptional({ nullable: true })
  customerVisibleNotes!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  assignedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  handedToCourierAt!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  deliveredAt!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  nextAttemptAt!: string | null;

  @ApiProperty({ type: [CustomerDeliveryAttemptDto] })
  attempts!: CustomerDeliveryAttemptDto[];

  @ApiProperty({ type: [CustomerDeliveryEventDto] })
  events!: CustomerDeliveryEventDto[];
}

export class CustomerOrderConsentDto {
  @ApiProperty({ enum: ConsentType })
  type!: ConsentType;

  @ApiProperty()
  granted!: boolean;

  @ApiPropertyOptional({ nullable: true })
  documentTitle!: string | null;

  @ApiPropertyOptional({ nullable: true })
  documentVersion!: number | null;

  @ApiPropertyOptional({ nullable: true })
  contentHash!: string | null;

  @ApiProperty({ format: 'date-time' })
  consentedAt!: string;
}

export class CustomerOrderDiscountDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  code!: string | null;

  @ApiProperty()
  amountMillimes!: number;
}

export class CustomerCodCollectionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CashCollectionStatus })
  status!: CashCollectionStatus;

  @ApiProperty()
  expectedMillimes!: number;

  @ApiProperty()
  collectedMillimes!: number;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  collectedAt!: string | null;
}

export class CustomerOrderDetailDto extends CustomerOrderSummaryDto {
  @ApiProperty()
  customerName!: string;

  @ApiProperty()
  customerPhone!: string;

  @ApiPropertyOptional({ nullable: true })
  customerEmail!: string | null;

  @ApiProperty({ enum: DeliveryMethodType })
  deliveryMethodType!: DeliveryMethodType;

  @ApiProperty()
  deliveryMethod!: string;

  @ApiProperty()
  subtotalMillimes!: number;

  @ApiProperty()
  discountTotalMillimes!: number;

  @ApiProperty()
  deliveryTotalMillimes!: number;

  @ApiProperty()
  taxTotalMillimes!: number;

  @ApiProperty()
  expectedCodMillimes!: number;

  @ApiProperty({ type: [CustomerOrderItemDto] })
  items!: CustomerOrderItemDto[];

  @ApiProperty({ type: [CustomerOrderAddressDto] })
  addresses!: CustomerOrderAddressDto[];

  @ApiProperty({ type: [CustomerOrderHistoryDto] })
  history!: CustomerOrderHistoryDto[];

  @ApiProperty({ type: [CustomerVisibleOrderNoteDto] })
  customerVisibleNotes!: CustomerVisibleOrderNoteDto[];

  @ApiPropertyOptional({ type: CustomerOrderDeliveryDto, nullable: true })
  delivery!: CustomerOrderDeliveryDto | null;

  @ApiProperty({ type: [CustomerOrderConsentDto] })
  consents!: CustomerOrderConsentDto[];

  @ApiProperty({ type: [CustomerOrderDiscountDto] })
  discounts!: CustomerOrderDiscountDto[];

  @ApiProperty({ type: [CustomerCodCollectionDto] })
  codCollections!: CustomerCodCollectionDto[];

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  confirmedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  cancelledAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  cancellationReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CustomerOrderDetailResponseDto {
  @ApiProperty({ type: CustomerOrderDetailDto })
  data!: CustomerOrderDetailDto;
}
