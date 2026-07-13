import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AgeVerificationResult,
  DeliveryAttemptOutcome,
  DeliveryStatus,
  OrderStatus,
  PaymentStatus,
} from '@prisma/client';
import {
  Equals,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  FAILED_ATTEMPT_OUTCOMES,
  OPERATIONAL_DELIVERY_TARGETS,
} from '../delivery-transition-policy';

export class DeliveryVersionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class AssignDeliveryDto extends DeliveryVersionDto {
  @ApiProperty()
  @IsString()
  @Length(1, 30)
  courierId!: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  trackingNumber?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 2_000_000_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  courierFeeMillimes?: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Matches(/\S/)
  note?: string;
}

export class ReassignDeliveryDto extends AssignDeliveryDto {
  @ApiProperty({ minLength: 4, maxLength: 1000 })
  @IsString()
  @Length(4, 1000)
  @Matches(/\S/)
  reason!: string;
}

export class TransitionDeliveryDto extends DeliveryVersionDto {
  @ApiProperty({ enum: OPERATIONAL_DELIVERY_TARGETS })
  @IsIn(OPERATIONAL_DELIVERY_TARGETS)
  targetStatus!: (typeof OPERATIONAL_DELIVERY_TARGETS)[number];

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  reasonCode?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Matches(/\S/)
  explanation?: string;
}

export class RecordDeliveryAttemptDto extends DeliveryVersionDto {
  @ApiProperty({ enum: FAILED_ATTEMPT_OUTCOMES })
  @IsIn(FAILED_ATTEMPT_OUTCOMES)
  outcome!: (typeof FAILED_ATTEMPT_OUTCOMES)[number];

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Matches(/\S/)
  explanation?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  nextAttemptAt?: string;
}

export class CompleteDeliveryDto extends DeliveryVersionDto {
  @ApiProperty({ enum: [AgeVerificationResult.NOT_REQUIRED, AgeVerificationResult.PASSED] })
  @IsIn([AgeVerificationResult.NOT_REQUIRED, AgeVerificationResult.PASSED])
  ageVerificationResult!: 'NOT_REQUIRED' | 'PASSED';

  @ApiProperty({ enum: ['COMPLETE_DELIVERY'] })
  @Equals('COMPLETE_DELIVERY')
  confirmation!: 'COMPLETE_DELIVERY';
}

export class CompleteDeliveryReturnDto extends DeliveryVersionDto {
  @ApiProperty({ minLength: 4, maxLength: 1000 })
  @IsString()
  @Length(4, 1000)
  @Matches(/\S/)
  reason!: string;

  @ApiProperty({ enum: ['COMPLETE_RETURN'] })
  @Equals('COMPLETE_RETURN')
  confirmation!: 'COMPLETE_RETURN';
}

export class AdminCourierOptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;
}

export class AdminCourierOptionsResponseDto {
  @ApiProperty({ type: () => [AdminCourierOptionDto] })
  data!: AdminCourierOptionDto[];
}

export class AdminDeliveryAttemptDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ minimum: 1 })
  attemptNumber!: number;

  @ApiProperty({ enum: DeliveryAttemptOutcome })
  outcome!: DeliveryAttemptOutcome;

  @ApiProperty({ enum: AgeVerificationResult })
  ageVerificationResult!: AgeVerificationResult;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  nextAttemptAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  attemptedAt!: string;
}

export class AdminDeliveryEventDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ enum: DeliveryStatus, nullable: true })
  fromStatus!: DeliveryStatus | null;

  @ApiProperty({ enum: DeliveryStatus })
  toStatus!: DeliveryStatus;

  @ApiProperty()
  source!: string;

  @ApiPropertyOptional({ nullable: true })
  reasonCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  note!: string | null;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;
}

export class AdminDeliveryDetailDto {
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

  @ApiProperty({ minimum: 0 })
  expectedCodMillimes!: number;

  @ApiProperty({ enum: DeliveryStatus })
  status!: DeliveryStatus;

  @ApiPropertyOptional({ type: () => AdminCourierOptionDto, nullable: true })
  courier!: AdminCourierOptionDto | null;

  @ApiPropertyOptional({ nullable: true })
  trackingNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  courierFeeMillimes!: number | null;

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

  @ApiProperty({ enum: AgeVerificationResult })
  ageVerificationResult!: AgeVerificationResult;

  @ApiProperty()
  ageVerificationRequired!: boolean;

  @ApiPropertyOptional({ nullable: true })
  cashCollectedResult!: boolean | null;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ type: () => [AdminDeliveryAttemptDto] })
  attempts!: AdminDeliveryAttemptDto[];

  @ApiProperty({ type: () => [AdminDeliveryEventDto] })
  events!: AdminDeliveryEventDto[];

  @ApiProperty({
    description: 'True when the bounded response omits older attempts or events.',
  })
  historyTruncated!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AdminDeliveryResponseDto {
  @ApiProperty({ type: () => AdminDeliveryDetailDto })
  data!: AdminDeliveryDetailDto;
}
