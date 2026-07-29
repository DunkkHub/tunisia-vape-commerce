import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class GeographyIdParamDto {
  @ApiProperty()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  id!: string;
}

export class DeliveryWindowsQueryDto {
  @ApiProperty()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  localityId!: string;
}

export class DeliveryMethodsQueryDto {
  @ApiPropertyOptional({ description: 'Required to determine courier availability.' })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  localityId?: string;
}

export class GeographyOptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  postalCode?: string;

  @ApiPropertyOptional()
  supported?: boolean;
}

export class GeographyOptionsResponseDto {
  @ApiProperty({ type: [GeographyOptionDto] })
  data!: GeographyOptionDto[];
}

export class DeliveryWindowOptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ nullable: true })
  dayOfWeek!: string | null;

  @ApiProperty({ example: '09:00:00' })
  startsAt!: string;

  @ApiProperty({ example: '17:00:00' })
  endsAt!: string;
}

export class DeliveryWindowsResponseDto {
  @ApiProperty({ type: [DeliveryWindowOptionDto] })
  data!: DeliveryWindowOptionDto[];
}

export class DeliveryMethodOptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['COURIER', 'STORE_PICKUP'] })
  type!: 'COURIER' | 'STORE_PICKUP';

  @ApiProperty()
  label!: string;

  @ApiProperty({ nullable: true })
  address!: string | null;

  @ApiProperty({ nullable: true })
  minimumOrderMillimes!: number | null;

  @ApiProperty({ nullable: true })
  maximumCodMillimes!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  estimatedMinDays!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  estimatedMaxDays!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  estimatedMinMinutes!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  estimatedMaxMinutes!: number | null;

  @ApiProperty({ enum: ['CASH_ON_DELIVERY'], nullable: true })
  paymentMethod!: 'CASH_ON_DELIVERY' | null;

  @ApiProperty()
  phoneConfirmationRequired!: boolean;
}

export class DeliveryMethodsResponseDto {
  @ApiProperty({ type: [DeliveryMethodOptionDto] })
  data!: DeliveryMethodOptionDto[];
}
