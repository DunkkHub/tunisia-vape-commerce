import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class CreateCustomerNoteDto {
  @ApiProperty({ minLength: 2, maxLength: 2_000 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 2_000)
  body!: string;
}

export class CustomerNoteDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty()
  authorId!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CustomerNoteResponseDto {
  @ApiProperty({ type: () => CustomerNoteDto })
  data!: CustomerNoteDto;
}

export class CustomerSessionRevocationResponseDto {
  @ApiProperty({ minimum: 0 })
  revokedSessions!: number;
}

export class CustomerPasswordResetResponseDto {
  @ApiProperty({ example: true })
  queued!: boolean;
}

export class AdminCustomerAddressDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string | null;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  phone!: string;

  @ApiProperty()
  street!: string;

  @ApiProperty()
  governorate!: string;

  @ApiProperty()
  delegation!: string;

  @ApiPropertyOptional({ nullable: true })
  locality!: string | null;

  @ApiPropertyOptional({ nullable: true })
  postalCode!: string | null;

  @ApiProperty()
  isDefault!: boolean;
}

export class AdminCustomerOrderSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderNumber!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ description: 'Integer Tunisian millimes.', minimum: 0 })
  grandTotalMillimes!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AdminCustomerSessionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'date-time' })
  lastSeenAt!: string;

  @ApiProperty({ format: 'date-time' })
  absoluteExpiresAt!: string;

  @ApiPropertyOptional({ nullable: true })
  ipAddress!: string | null;

  @ApiPropertyOptional({ nullable: true })
  userAgent!: string | null;
}

export class AdminCustomerDetailResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  data!: Record<string, unknown>;
}

export class AdminCustomerExportResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  data!: Record<string, unknown>;
}
