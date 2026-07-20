import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AgeVerificationResult,
  CourierStatus,
  DeliveryAttemptOutcome,
  DeliveryStatus,
  ManifestStatus,
  OrderStatus,
  PaymentStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
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

export class ManualCourierListQueryDto {
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

  @ApiPropertyOptional({ enum: CourierStatus })
  @IsOptional()
  @IsEnum(CourierStatus)
  status?: CourierStatus;
}

export class CreateManualCourierDto {
  @ApiProperty({ example: 'TUNIS-DRIVER-01', minLength: 2, maxLength: 80 })
  @IsString()
  @Length(2, 80)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
  code!: string;

  @ApiProperty({ minLength: 2, maxLength: 200 })
  @IsString()
  @Length(2, 200)
  @Matches(/\S/)
  name!: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @Length(2, 160)
  @Matches(/\S/)
  contactName?: string;

  @ApiPropertyOptional({ example: '+21612345678' })
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phoneE164?: string;

  @ApiPropertyOptional({ maxLength: 320 })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Matches(/\S/)
  notes?: string;

  @ApiProperty({ enum: ['CREATE_MANUAL_COURIER'] })
  @Equals('CREATE_MANUAL_COURIER')
  confirmation!: 'CREATE_MANUAL_COURIER';
}

export class UpdateManualCourierDto {
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;

  @ApiPropertyOptional({ minLength: 2, maxLength: 80 })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
  code?: string;

  @ApiPropertyOptional({ minLength: 2, maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  @Matches(/\S/)
  name?: string;

  @ApiPropertyOptional({ maxLength: 160, nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 160)
  @Matches(/\S/)
  contactName?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '+21612345678' })
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phoneE164?: string | null;

  @ApiPropertyOptional({ maxLength: 320, nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Matches(/\S/)
  notes?: string | null;

  @ApiPropertyOptional({ enum: CourierStatus })
  @IsOptional()
  @IsEnum(CourierStatus)
  status?: CourierStatus;

  @ApiProperty({ enum: ['UPDATE_MANUAL_COURIER'] })
  @Equals('UPDATE_MANUAL_COURIER')
  confirmation!: 'UPDATE_MANUAL_COURIER';
}

export class ManifestDeliveryItemDto {
  @ApiProperty({ maxLength: 30 })
  @IsString()
  @Length(1, 30)
  deliveryId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateDeliveryManifestDto {
  @ApiProperty({ maxLength: 30 })
  @IsString()
  @Length(1, 30)
  courierId!: string;

  @ApiProperty({ example: '2026-07-20' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  manifestDate!: string;

  @ApiProperty({ type: () => [ManifestDeliveryItemDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((item: ManifestDeliveryItemDto) => item.deliveryId)
  @ValidateNested({ each: true })
  @Type(() => ManifestDeliveryItemDto)
  deliveries!: ManifestDeliveryItemDto[];

  @ApiProperty({ enum: ['CREATE_DELIVERY_MANIFEST'] })
  @Equals('CREATE_DELIVERY_MANIFEST')
  confirmation!: 'CREATE_DELIVERY_MANIFEST';
}

export const MANIFEST_OPERATIONAL_TARGETS = [
  ManifestStatus.SEALED,
  ManifestStatus.HANDED_OVER,
  ManifestStatus.CLOSED,
  ManifestStatus.CANCELLED,
] as const;

export class TransitionDeliveryManifestDto {
  @ApiProperty({ enum: ManifestStatus })
  @IsEnum(ManifestStatus)
  expectedStatus!: ManifestStatus;

  @ApiProperty({ enum: MANIFEST_OPERATIONAL_TARGETS })
  @IsIn(MANIFEST_OPERATIONAL_TARGETS)
  targetStatus!: (typeof MANIFEST_OPERATIONAL_TARGETS)[number];

  @ApiPropertyOptional({ minLength: 4, maxLength: 1000 })
  @ValidateIf((input: TransitionDeliveryManifestDto) => input.targetStatus === 'CANCELLED')
  @IsString()
  @Length(4, 1000)
  @Matches(/\S/)
  reason?: string;

  @ApiProperty({ enum: ['TRANSITION_DELIVERY_MANIFEST'] })
  @Equals('TRANSITION_DELIVERY_MANIFEST')
  confirmation!: 'TRANSITION_DELIVERY_MANIFEST';
}

export class DeliveryManifestListQueryDto {
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

  @ApiPropertyOptional({ enum: ManifestStatus })
  @IsOptional()
  @IsEnum(ManifestStatus)
  status?: ManifestStatus;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  courierId?: string;
}

export class DeliveryStatusExportQueryDto {
  @ApiPropertyOptional({ enum: DeliveryStatus })
  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  courierId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ default: 500, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 500;
}

export class ImportDeliveryStatusCsvDto {
  @ApiProperty({ minLength: 8, maxLength: 80 })
  @IsString()
  @Length(8, 80)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/)
  importKey!: string;

  @ApiProperty()
  @IsBoolean()
  dryRun!: boolean;

  @ApiProperty({ description: 'UTF-8 DELIVERY_STATUS_V1 CSV, at most 250 KB and 500 rows.' })
  @IsString()
  @Length(1, 250_000)
  csv!: string;

  @ApiPropertyOptional({ enum: ['APPLY_DELIVERY_STATUS_IMPORT'] })
  @ValidateIf((input: ImportDeliveryStatusCsvDto) => !input.dryRun)
  @Equals('APPLY_DELIVERY_STATUS_IMPORT')
  confirmation?: 'APPLY_DELIVERY_STATUS_IMPORT';
}

export class AdminDeliveryOperationResponseDto {
  @ApiProperty()
  data!: unknown;
}
