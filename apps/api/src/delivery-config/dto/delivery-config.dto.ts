import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { DeliveryRateType, Weekday } from '@prisma/client';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDateString,
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
} from 'class-validator';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const CODE_PATTERN = /^[A-Z0-9]+(?:[_-][A-Z0-9]+)*$/;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : (value as unknown);

export class DeliveryConfigIdParamDto {
  @ApiProperty()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  id!: string;
}

export class DeliveryConfigListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 100_000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({ maxLength: 80 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class TimestampLifecycleDto {
  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true })
  expectedUpdatedAt!: string;

  @ApiProperty({ enum: [true] })
  @IsBoolean()
  @Equals(true)
  confirmed!: true;
}

export class VersionLifecycleDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ enum: [true] })
  @IsBoolean()
  @Equals(true)
  confirmed!: true;
}

export class TokenLifecycleDto {
  @ApiProperty({ pattern: TOKEN_PATTERN.source })
  @IsString()
  @Matches(TOKEN_PATTERN)
  expectedStateToken!: string;

  @ApiProperty({ enum: [true] })
  @IsBoolean()
  @Equals(true)
  confirmed!: true;
}

export class CreateDeliveryZoneDto {
  @ApiProperty({ maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  @Matches(CODE_PATTERN)
  code!: string;

  @ApiProperty({ maxLength: 160 })
  @Transform(trim)
  @IsString()
  @Length(1, 160)
  nameFr!: string;

  @ApiProperty({ maxLength: 160 })
  @Transform(trim)
  @IsString()
  @Length(1, 160)
  nameAr!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  priority?: number;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderMillimes?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxCodMillimes?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  freeDeliveryThresholdMillimes?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedMinDays?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedMaxDays?: number | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  phoneConfirmationRequired?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  manualReviewRequired?: boolean;
}

export class UpdateDeliveryZoneDto extends PartialType(CreateDeliveryZoneDto) {
  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true })
  expectedUpdatedAt!: string;
}

export class LinkZoneGeographyDto extends TimestampLifecycleDto {
  @ApiProperty({ enum: ['GOVERNORATE', 'DELEGATION', 'LOCALITY'] })
  @IsIn(['GOVERNORATE', 'DELEGATION', 'LOCALITY'])
  scope!: 'GOVERNORATE' | 'DELEGATION' | 'LOCALITY';

  @ApiProperty()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  geographyId!: string;

  @ApiProperty({ description: 'Whether the resolved locality links should be active.' })
  @IsBoolean()
  active!: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  priorityOverride?: number | null;
}

export class CreateDeliveryRateDto {
  @ApiProperty({ enum: DeliveryRateType })
  @IsEnum(DeliveryRateType)
  type!: DeliveryRateType;

  @ApiProperty({ maxLength: 160 })
  @Transform(trim)
  @IsString()
  @Length(1, 160)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  deliveryZoneId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  governorateId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  delegationId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  localityId?: string | null;

  @ApiProperty({ minimum: 0, description: 'Integer Tunisian millimes.' })
  @IsInt()
  @Min(0)
  feeMillimes!: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  priority?: number;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minWeightGrams?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxWeightGrams?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderMillimes?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxOrderMillimes?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxCodMillimes?: number | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  express?: boolean;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  @IsOptional()
  @IsDateString({ strict: true })
  validFrom?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  @IsOptional()
  @IsDateString({ strict: true })
  validUntil?: string | null;
}

export class UpdateDeliveryRateDto extends PartialType(CreateDeliveryRateDto) {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreatePickupLocationDto {
  @ApiProperty({ maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  @Matches(CODE_PATTERN)
  code!: string;

  @ApiProperty({ maxLength: 160 })
  @Transform(trim)
  @IsString()
  @Length(1, 160)
  nameFr!: string;

  @ApiProperty({ maxLength: 160 })
  @Transform(trim)
  @IsString()
  @Length(1, 160)
  nameAr!: string;

  @ApiProperty({ maxLength: 500 })
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  address!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^\+216[24579]\d{7}$/)
  phoneE164?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  inventoryLocationId?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderMillimes?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxCodMillimes?: number | null;
}

export class UpdatePickupLocationDto extends PartialType(CreatePickupLocationDto) {
  @ApiProperty({ pattern: TOKEN_PATTERN.source })
  @IsString()
  @Matches(TOKEN_PATTERN)
  expectedStateToken!: string;
}

export class CreateDeliveryWindowDto {
  @ApiProperty({ maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  @Matches(CODE_PATTERN)
  code!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  deliveryZoneId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  pickupLocationId?: string | null;

  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  labelFr!: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  labelAr!: string;

  @ApiPropertyOptional({ enum: Weekday, nullable: true })
  @IsOptional()
  @IsEnum(Weekday)
  dayOfWeek?: Weekday | null;

  @ApiProperty({ example: '09:00' })
  @Matches(TIME_PATTERN)
  startsAt!: string;

  @ApiProperty({ example: '17:00' })
  @Matches(TIME_PATTERN)
  endsAt!: string;

  @ApiPropertyOptional({ nullable: true, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number | null;
}

export class UpdateDeliveryWindowDto extends PartialType(CreateDeliveryWindowDto) {
  @ApiProperty({ pattern: TOKEN_PATTERN.source })
  @IsString()
  @Matches(TOKEN_PATTERN)
  expectedStateToken!: string;
}

export class DeliveryZoneConfigDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() nameFr!: string;
  @ApiProperty() nameAr!: string;
  @ApiProperty() priority!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty() supported!: boolean;
  @ApiProperty() localityCount!: number;
  @ApiProperty() activeRateCount!: number;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class DeliveryRateConfigDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: DeliveryRateType }) type!: DeliveryRateType;
  @ApiProperty() name!: string;
  @ApiProperty() feeMillimes!: number;
  @ApiProperty() priority!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty() version!: number;
}

export class PickupLocationConfigDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() nameFr!: string;
  @ApiProperty() nameAr!: string;
  @ApiProperty() address!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty() stateToken!: string;
}

export class DeliveryWindowConfigDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() labelFr!: string;
  @ApiProperty() labelAr!: string;
  @ApiProperty() startsAt!: string;
  @ApiProperty() endsAt!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty() stateToken!: string;
}

export class DeliveryZoneResponseDto {
  @ApiProperty({ type: DeliveryZoneConfigDto }) data!: DeliveryZoneConfigDto;
}
export class DeliveryRateResponseDto {
  @ApiProperty({ type: DeliveryRateConfigDto }) data!: DeliveryRateConfigDto;
}
export class PickupLocationResponseDto {
  @ApiProperty({ type: PickupLocationConfigDto }) data!: PickupLocationConfigDto;
}
export class DeliveryWindowResponseDto {
  @ApiProperty({ type: DeliveryWindowConfigDto }) data!: DeliveryWindowConfigDto;
}

class PageMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}
export class DeliveryZoneListDataDto extends PageMetaDto {
  @ApiProperty({ type: [DeliveryZoneConfigDto] }) items!: DeliveryZoneConfigDto[];
}
export class DeliveryRateListDataDto extends PageMetaDto {
  @ApiProperty({ type: [DeliveryRateConfigDto] }) items!: DeliveryRateConfigDto[];
}
export class PickupLocationListDataDto extends PageMetaDto {
  @ApiProperty({ type: [PickupLocationConfigDto] }) items!: PickupLocationConfigDto[];
}
export class DeliveryWindowListDataDto extends PageMetaDto {
  @ApiProperty({ type: [DeliveryWindowConfigDto] }) items!: DeliveryWindowConfigDto[];
}
export class DeliveryZoneListResponseDto {
  @ApiProperty({ type: DeliveryZoneListDataDto }) data!: DeliveryZoneListDataDto;
}
export class DeliveryRateListResponseDto {
  @ApiProperty({ type: DeliveryRateListDataDto }) data!: DeliveryRateListDataDto;
}
export class PickupLocationListResponseDto {
  @ApiProperty({ type: PickupLocationListDataDto }) data!: PickupLocationListDataDto;
}
export class DeliveryWindowListResponseDto {
  @ApiProperty({ type: DeliveryWindowListDataDto }) data!: DeliveryWindowListDataDto;
}
