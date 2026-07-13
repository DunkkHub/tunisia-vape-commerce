import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AgeVerificationResult,
  DeliveryAttemptOutcome,
  DeliveryMethodType,
  DeliveryStatus,
  OrderAddressType,
  OrderNoteVisibility,
  OrderStatus,
  PaymentStatus,
} from '@prisma/client';
import { Transform, type TransformFnParams } from 'class-transformer';
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
  Min,
} from 'class-validator';

const trimText = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : (value as unknown);

export class ConfirmOrderDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true)
  confirmed!: true;
}

export class CancelOrderDto extends ConfirmOrderDto {
  @ApiProperty({ minLength: 4, maxLength: 500 })
  @Transform(trimText)
  @IsString()
  @Length(4, 500)
  @Matches(/\S/)
  reason!: string;

  @ApiProperty({ enum: ['CANCEL_ORDER'] })
  @IsString()
  @Equals('CANCEL_ORDER')
  confirmation!: 'CANCEL_ORDER';
}

export class RejectOrderDto extends ConfirmOrderDto {
  @ApiProperty({ minLength: 4, maxLength: 500 })
  @Transform(trimText)
  @IsString()
  @Length(4, 500)
  @Matches(/\S/)
  reason!: string;

  @ApiProperty({ enum: ['REJECT_ORDER'] })
  @IsString()
  @Equals('REJECT_ORDER')
  confirmation!: 'REJECT_ORDER';
}

export class TransitionOrderDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export const ORDER_CONTACT_METHODS = ['PHONE', 'SMS', 'EMAIL'] as const;
export const ORDER_CONTACT_RESULTS = [
  'REACHED',
  'NO_ANSWER',
  'WRONG_NUMBER',
  'CALLBACK_REQUESTED',
  'UNREACHABLE',
  'OTHER',
] as const;

export class RecordOrderContactAttemptDto extends TransitionOrderDto {
  @ApiProperty({ enum: ORDER_CONTACT_METHODS })
  @IsIn(ORDER_CONTACT_METHODS)
  method!: (typeof ORDER_CONTACT_METHODS)[number];

  @ApiProperty({ enum: ORDER_CONTACT_RESULTS })
  @IsIn(ORDER_CONTACT_RESULTS)
  result!: (typeof ORDER_CONTACT_RESULTS)[number];

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  reasonCode?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(trimText)
  @IsString()
  @Length(4, 1000)
  @Matches(/\S/)
  explanation?: string;
}

export class CreateOrderNoteDto {
  @ApiProperty({ enum: OrderNoteVisibility })
  @IsEnum(OrderNoteVisibility)
  visibility!: OrderNoteVisibility;

  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @Transform(trimText)
  @IsString()
  @Length(1, 2000)
  @Matches(/\S/)
  body!: string;
}

export class AdminOrderItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  variantName!: string;

  @ApiProperty()
  sku!: string;

  @ApiPropertyOptional({ nullable: true })
  barcode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  warningFr!: string | null;

  @ApiPropertyOptional({ nullable: true })
  warningAr!: string | null;

  @ApiProperty({ minimum: 0 })
  unitPriceMillimes!: number;

  @ApiProperty({ minimum: 0 })
  unitDiscountMillimes!: number;

  @ApiProperty({ minimum: 0 })
  taxRateBps!: number;

  @ApiProperty({ minimum: 0 })
  unitTaxMillimes!: number;

  @ApiProperty({ minimum: 1 })
  quantity!: number;

  @ApiProperty({ minimum: 0 })
  lineSubtotalMillimes!: number;

  @ApiProperty({ minimum: 0 })
  lineDiscountMillimes!: number;

  @ApiProperty({ minimum: 0 })
  lineTaxMillimes!: number;

  @ApiProperty({ minimum: 0 })
  lineTotalMillimes!: number;
}

export class AdminOrderAddressDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: OrderAddressType })
  type!: OrderAddressType;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  phoneE164!: string;

  @ApiProperty()
  governorateName!: string;

  @ApiProperty()
  delegationName!: string;

  @ApiPropertyOptional({ nullable: true })
  localityName!: string | null;

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

export class AdminOrderHistoryDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ enum: OrderStatus, nullable: true })
  fromStatus!: OrderStatus | null;

  @ApiProperty({ enum: OrderStatus })
  toStatus!: OrderStatus;

  @ApiPropertyOptional({ nullable: true })
  reasonCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  note!: string | null;

  @ApiPropertyOptional({ nullable: true })
  changedByUserId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AdminOrderNoteDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  authorUserId!: string | null;

  @ApiProperty({ enum: OrderNoteVisibility })
  visibility!: OrderNoteVisibility;

  @ApiProperty()
  body!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AdminOrderCourierDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class AdminOrderDeliveryAttemptDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ minimum: 1 })
  attemptNumber!: number;

  @ApiProperty({ format: 'date-time' })
  attemptedAt!: string;

  @ApiProperty({ enum: DeliveryAttemptOutcome })
  outcome!: DeliveryAttemptOutcome;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  nextAttemptAt!: string | null;

  @ApiProperty({ enum: AgeVerificationResult })
  ageVerificationResult!: AgeVerificationResult;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  cashExpectedMillimes!: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  cashCollectedMillimes!: number | null;

  @ApiPropertyOptional({ nullable: true })
  recordedByUserId!: string | null;
}

export class AdminOrderDeliveryEventDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ enum: DeliveryStatus, nullable: true })
  fromStatus!: DeliveryStatus | null;

  @ApiProperty({ enum: DeliveryStatus })
  toStatus!: DeliveryStatus;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;

  @ApiPropertyOptional({ nullable: true })
  actorUserId!: string | null;

  @ApiProperty()
  source!: string;

  @ApiPropertyOptional({ nullable: true })
  reasonCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  note!: string | null;
}

export class AdminOrderDeliveryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: DeliveryStatus })
  status!: DeliveryStatus;

  @ApiPropertyOptional({ nullable: true })
  trackingNumber!: string | null;

  @ApiPropertyOptional({ type: () => AdminOrderCourierDto, nullable: true })
  courier!: AdminOrderCourierDto | null;

  @ApiProperty()
  ageVerificationRequired!: boolean;

  @ApiProperty()
  ageVerificationResult!: string;

  @ApiPropertyOptional({ nullable: true })
  cashCollectedResult!: boolean | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  assignedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  handedToCourierAt!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  deliveredAt!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  nextAttemptAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  internalNotes!: string | null;

  @ApiPropertyOptional({ nullable: true })
  customerVisibleNotes!: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  courierFeeMillimes!: number | null;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ type: () => [AdminOrderDeliveryAttemptDto] })
  attempts!: AdminOrderDeliveryAttemptDto[];

  @ApiProperty({ type: () => [AdminOrderDeliveryEventDto] })
  events!: AdminOrderDeliveryEventDto[];
}

export class AdminOrderCashCollectionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ minimum: 0 })
  expectedMillimes!: number;

  @ApiProperty({ minimum: 0 })
  collectedMillimes!: number;

  @ApiProperty()
  method!: string;

  @ApiPropertyOptional({ nullable: true })
  collectedByUserId!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  collectedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  note!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AdminOrderCashDiscrepancyDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ minimum: 0 })
  expectedMillimes!: number;

  @ApiProperty({ minimum: 0 })
  actualMillimes!: number;

  @ApiProperty()
  differenceMillimes!: number;

  @ApiPropertyOptional({ nullable: true })
  reasonCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  reasonDetail!: string | null;

  @ApiProperty({ format: 'date-time' })
  openedAt!: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  resolvedAt!: string | null;
}

export class AdminOrderDetailDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiProperty()
  customerName!: string;

  @ApiProperty()
  customerPhone!: string;

  @ApiPropertyOptional({ nullable: true })
  customerEmail!: string | null;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty({ enum: PaymentStatus })
  paymentStatus!: PaymentStatus;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: DeliveryMethodType })
  deliveryMethodType!: DeliveryMethodType;

  @ApiProperty()
  deliveryMethod!: string;

  @ApiProperty({ minimum: 0 })
  subtotalMillimes!: number;

  @ApiProperty({ minimum: 0 })
  discountTotalMillimes!: number;

  @ApiProperty({ minimum: 0 })
  deliveryTotalMillimes!: number;

  @ApiProperty({ minimum: 0 })
  taxTotalMillimes!: number;

  @ApiProperty({ minimum: 0 })
  grandTotalMillimes!: number;

  @ApiProperty({ minimum: 0 })
  expectedCodMillimes!: number;

  @ApiProperty()
  minimumAge!: number;

  @ApiProperty({ format: 'date-time' })
  ageConfirmedAt!: string;

  @ApiProperty()
  ageVerificationAtDeliveryRequired!: boolean;

  @ApiPropertyOptional({ nullable: true })
  deliveryInstructions!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  preferredDeliveryDate!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  confirmedAt!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  cancelledAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  cancellationReason!: string | null;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ type: () => [AdminOrderItemDto] })
  items!: AdminOrderItemDto[];

  @ApiProperty({ type: () => [AdminOrderAddressDto] })
  addresses!: AdminOrderAddressDto[];

  @ApiProperty({ type: () => [AdminOrderHistoryDto] })
  history!: AdminOrderHistoryDto[];

  @ApiProperty({ type: () => [AdminOrderNoteDto] })
  notes!: AdminOrderNoteDto[];

  @ApiPropertyOptional({ type: () => AdminOrderDeliveryDto, nullable: true })
  delivery!: AdminOrderDeliveryDto | null;

  @ApiProperty({ type: () => [AdminOrderCashCollectionDto] })
  cashCollections!: AdminOrderCashCollectionDto[];

  @ApiProperty({ type: () => [AdminOrderCashDiscrepancyDto] })
  cashDiscrepancies!: AdminOrderCashDiscrepancyDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AdminOrderResponseDto {
  @ApiProperty({ type: () => AdminOrderDetailDto })
  data!: AdminOrderDetailDto;
}

export class AdminOrderNoteResponseDto {
  @ApiProperty({ type: () => AdminOrderNoteDto })
  data!: AdminOrderNoteDto;
}

export class AdminOrderContactAttemptDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ORDER_CONTACT_METHODS })
  method!: (typeof ORDER_CONTACT_METHODS)[number];

  @ApiProperty({ enum: ORDER_CONTACT_RESULTS })
  result!: (typeof ORDER_CONTACT_RESULTS)[number];

  @ApiPropertyOptional({ nullable: true })
  reasonCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  explanation!: string | null;

  @ApiProperty()
  recordedByUserId!: string;

  @ApiProperty({ format: 'date-time' })
  recordedAt!: string;
}

export class AdminOrderContactAttemptResponseDto {
  @ApiProperty({ type: () => AdminOrderContactAttemptDto })
  data!: AdminOrderContactAttemptDto;
}

export class AdminOrderSlipItemDto {
  @ApiProperty()
  sku!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  variantName!: string;

  @ApiProperty({ minimum: 1 })
  quantity!: number;

  @ApiProperty({ minimum: 0 })
  unitPriceMillimes!: number;

  @ApiProperty({ minimum: 0 })
  lineTotalMillimes!: number;
}

export class AdminOrderSlipDto {
  @ApiProperty({ enum: ['ORDER_SLIP_JSON_V1'] })
  documentType!: 'ORDER_SLIP_JSON_V1';

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty()
  customerName!: string;

  @ApiProperty()
  customerPhone!: string;

  @ApiPropertyOptional({ type: 'object', nullable: true, additionalProperties: true })
  address!: Record<string, unknown> | null;

  @ApiProperty({ type: () => [AdminOrderSlipItemDto] })
  items!: AdminOrderSlipItemDto[];

  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer' } })
  totals!: Record<string, number>;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  deliveryMethod!: string;

  @ApiPropertyOptional({ nullable: true })
  deliveryInstructions!: string | null;

  @ApiProperty()
  ageVerificationAtDeliveryRequired!: boolean;
}

export class AdminOrderSlipResponseDto {
  @ApiProperty({ type: () => AdminOrderSlipDto })
  data!: AdminOrderSlipDto;
}
