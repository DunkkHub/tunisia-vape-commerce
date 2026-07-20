import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AddressType } from '@prisma/client';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const POSTAL_CODE_PATTERN = /^\d{4}$/;
const TUNISIAN_PHONE_PATTERN = /^\+216[24579]\d{7}$/;

const trimText = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : (value as unknown);

const normalizePhone = ({ value }: TransformFnParams): unknown => {
  if (typeof value !== 'string') return value as unknown;
  const compact = value
    .trim()
    .replace(/[\s().-]/g, '')
    .replace(/^00216/, '+216');
  return compact.startsWith('+216') ? compact : `+216${compact}`;
};

export class CustomerAddressIdParamDto {
  @ApiProperty()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  id!: string;
}

export class DeleteCustomerAddressQueryDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateCustomerAddressDto {
  @ApiPropertyOptional({ enum: AddressType, default: AddressType.HOME })
  @IsOptional()
  @IsEnum(AddressType)
  type?: AddressType;

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string | null;

  @ApiProperty({ maxLength: 200 })
  @Transform(trimText)
  @IsString()
  @Length(2, 200)
  fullName!: string;

  @ApiProperty({ example: '+21620111222' })
  @Transform(normalizePhone)
  @IsString()
  @Matches(TUNISIAN_PHONE_PATTERN)
  phone!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  governorateId!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  delegationId!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  localityId?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: POSTAL_CODE_PATTERN.source })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @Matches(POSTAL_CODE_PATTERN)
  postalCode?: string | null;

  @ApiProperty({ maxLength: 255 })
  @Transform(trimText)
  @IsString()
  @Length(3, 255)
  street!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  building?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 30 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  floor?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 30 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  apartment?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 255 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  landmark?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 1_000 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  deliveryInstructions?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateCustomerAddressDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ enum: AddressType })
  @IsOptional()
  @IsEnum(AddressType)
  type?: AddressType;

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @Length(2, 200)
  fullName?: string;

  @ApiPropertyOptional({ example: '+21620111222' })
  @Transform(normalizePhone)
  @IsOptional()
  @IsString()
  @Matches(TUNISIAN_PHONE_PATTERN)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  governorateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  delegationId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  localityId?: string | null;

  @ApiPropertyOptional({ nullable: true, pattern: POSTAL_CODE_PATTERN.source })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @Matches(POSTAL_CODE_PATTERN)
  postalCode?: string | null;

  @ApiPropertyOptional({ maxLength: 255 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @Length(3, 255)
  street?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 100 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  building?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 30 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  floor?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 30 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  apartment?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 255 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  landmark?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 1_000 })
  @Transform(trimText)
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  deliveryInstructions?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CustomerAddressDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: AddressType })
  type!: AddressType;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ description: 'Normalized Tunisian E.164 phone number.' })
  phone!: string;

  @ApiProperty()
  governorateId!: string;

  @ApiProperty()
  governorate!: string;

  @ApiProperty()
  delegationId!: string;

  @ApiProperty()
  delegation!: string;

  @ApiPropertyOptional({ nullable: true })
  localityId!: string | null;

  @ApiProperty()
  locality!: string;

  @ApiProperty()
  postalCode!: string;

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
  deliveryInstructions!: string | null;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CustomerAddressListResponseDto {
  @ApiProperty({ type: [CustomerAddressDto] })
  data!: CustomerAddressDto[];
}

export class CustomerAddressResponseDto {
  @ApiProperty({ type: CustomerAddressDto })
  data!: CustomerAddressDto;
}

export class DeleteCustomerAddressDataDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: [true] })
  deleted!: true;
}

export class DeleteCustomerAddressResponseDto {
  @ApiProperty({ type: DeleteCustomerAddressDataDto })
  data!: DeleteCustomerAddressDataDto;
}
