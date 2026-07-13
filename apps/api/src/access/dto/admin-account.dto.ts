import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AdminCustomerListItemDto } from '../../operations/dto/admin-commerce-list.dto';

export class AdminAccountListQueryDto {
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

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class CreateAdminAccountDto {
  @ApiProperty({ example: 'operations@example.tn' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Operations Manager' })
  @IsString()
  @Length(2, 200)
  displayName!: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  employeeCode?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  jobTitle?: string;

  @ApiProperty({ format: 'password', minLength: 14, maxLength: 128 })
  @IsString()
  @Length(14, 128)
  @Matches(/[a-z]/)
  @Matches(/[A-Z]/)
  @Matches(/[0-9]/)
  @Matches(/[^A-Za-z0-9]/)
  password!: string;

  @ApiPropertyOptional({ type: [String], default: ['administrator'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  roleKeys?: string[];

  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true)
  confirmed!: true;
}

export class AccountLifecycleDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedUserVersion!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedProfileVersion!: number;

  @ApiProperty({ minLength: 4, maxLength: 500 })
  @IsString()
  @Length(4, 500)
  reason!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true)
  confirmed!: true;
}

export class AnonymizeAdminAccountDto extends AccountLifecycleDto {
  @ApiProperty({ enum: ['ANONYMIZE_ADMIN'] })
  @IsString()
  @Equals('ANONYMIZE_ADMIN')
  confirmation!: 'ANONYMIZE_ADMIN';
}

export class DisableCustomerAccountDto extends AccountLifecycleDto {
  @ApiProperty({ enum: ['DISABLE_CUSTOMER'] })
  @IsString()
  @Equals('DISABLE_CUSTOMER')
  confirmation!: 'DISABLE_CUSTOMER';
}

export class AdminRoleSummaryDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  name!: string;
}

export class AdminAccountListItemDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  email!: string | null;

  @ApiProperty()
  displayName!: string;

  @ApiPropertyOptional({ nullable: true })
  employeeCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  jobTitle!: string | null;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiProperty({ type: () => [AdminRoleSummaryDto] })
  roles!: AdminRoleSummaryDto[];

  @ApiProperty()
  twoFactorEnrolled!: boolean;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  suspendedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  suspensionReason!: string | null;

  @ApiProperty({ minimum: 1 })
  userVersion!: number;

  @ApiProperty({ minimum: 1 })
  profileVersion!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AdminAccountResponseDto {
  @ApiProperty({ type: () => AdminAccountListItemDto })
  data!: AdminAccountListItemDto;
}

class AdminAccountPageDto {
  @ApiProperty({ type: () => [AdminAccountListItemDto] })
  items!: AdminAccountListItemDto[];

  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 50 })
  pageSize!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;

  @ApiProperty({ minimum: 0 })
  totalPages!: number;
}

export class AdminAccountListResponseDto {
  @ApiProperty({ type: () => AdminAccountPageDto })
  data!: AdminAccountPageDto;
}

export class CustomerAccountResponseDto {
  @ApiProperty({ type: () => AdminCustomerListItemDto })
  data!: AdminCustomerListItemDto;
}
