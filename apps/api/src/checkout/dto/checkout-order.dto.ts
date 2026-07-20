import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { normalizeTunisianPhone } from '../checkout-order.helpers';
import { CheckoutQuoteDto } from './checkout-quote.dto';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const POSTAL_CODE_PATTERN = /^\d{4}$/;

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizePhone = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? normalizeTunisianPhone(value) : value;

export class CheckoutAddressDto {
  @ApiProperty({ maxLength: 255 })
  @Transform(trimString)
  @IsString()
  @Length(3, 255)
  street!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(1, 100)
  building?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(1, 30)
  floor?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(1, 30)
  apartment?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(1, 255)
  landmark?: string;

  @ApiPropertyOptional({ pattern: POSTAL_CODE_PATTERN.source })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Matches(POSTAL_CODE_PATTERN)
  postalCode?: string;

  @ApiPropertyOptional({ maxLength: 1_000 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(1, 1_000)
  instructions?: string;
}

export class CheckoutConsentDto {
  @ApiProperty({ default: false })
  @IsBoolean()
  ageConfirmed!: boolean;

  @ApiProperty({ default: false })
  @IsBoolean()
  termsAccepted!: boolean;

  @ApiProperty({ default: false })
  @IsBoolean()
  privacyAccepted!: boolean;

  @ApiPropertyOptional({ description: 'Published terms version shown to the customer.' })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  termsDocumentVersionId?: string;

  @ApiPropertyOptional({ description: 'Published privacy version shown to the customer.' })
  @IsOptional()
  @IsString()
  @Length(1, 30)
  @Matches(ID_PATTERN)
  privacyDocumentVersionId?: string;
}

export class CheckoutOrderDto extends CheckoutQuoteDto {
  @ApiProperty({ maxLength: 200 })
  @Transform(trimString)
  @IsString()
  @Length(2, 200)
  customerName!: string;

  @ApiProperty({ example: '+21620111222' })
  @Transform(normalizePhone)
  @IsString()
  @Matches(/^\+216[24579]\d{7}$/)
  phone!: string;

  @ApiPropertyOptional({ maxLength: 320 })
  @Transform(trimString)
  @IsOptional()
  @IsEmail()
  @Length(3, 320)
  email?: string;

  @ApiPropertyOptional({ type: CheckoutAddressDto, description: 'Required for courier delivery.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutAddressDto)
  address?: CheckoutAddressDto;

  @ApiProperty({ type: CheckoutConsentDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CheckoutConsentDto)
  consent!: CheckoutConsentDto;
}

export class CheckoutOrderCreatedDataDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiProperty({ enum: ['PENDING_CONFIRMATION'] })
  status!: 'PENDING_CONFIRMATION';

  @ApiProperty({ enum: ['CASH_EXPECTED'] })
  paymentStatus!: 'CASH_EXPECTED';

  @ApiProperty({ enum: ['TND'] })
  currency!: 'TND';

  @ApiProperty()
  subtotalMillimes!: number;

  @ApiProperty()
  discountTotalMillimes!: number;

  @ApiProperty()
  deliveryTotalMillimes!: number;

  @ApiProperty()
  taxTotalMillimes!: number;

  @ApiProperty()
  grandTotalMillimes!: number;

  @ApiProperty()
  expectedCodMillimes!: number;

  @ApiProperty({ enum: ['COURIER', 'STORE_PICKUP'] })
  deliveryMethodType!: 'COURIER' | 'STORE_PICKUP';

  @ApiProperty()
  createdAt!: string;
}

export class CheckoutOrderCreatedResponseDto {
  @ApiProperty({ type: CheckoutOrderCreatedDataDto })
  data!: CheckoutOrderCreatedDataDto;
}
