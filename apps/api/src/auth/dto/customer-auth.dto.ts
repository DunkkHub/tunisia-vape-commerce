import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CustomerLoginDto {
  @ApiProperty({ example: 'client@example.tn' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  emailOrPhone!: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @Length(8, 128)
  password!: string;
}

export class CustomerRegistrationDto {
  @ApiProperty({ example: 'Amel Ben Salah' })
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @ApiProperty({ example: 'amel@example.tn' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: '+21620123456' })
  @IsString()
  @Matches(/^(?:\+216|00216)?[24579]\d{7}$/)
  phone!: string;

  @ApiProperty({ format: 'password', minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/[a-z]/)
  @Matches(/[A-Z]/)
  @Matches(/[0-9]/)
  @Matches(/[^A-Za-z0-9]/)
  password!: string;

  @ApiProperty({ description: 'Explicit confirmation that the customer meets the configured age.' })
  @IsBoolean()
  adultConfirmed!: boolean;

  @ApiProperty({ description: 'Acceptance of the current terms.' })
  @IsBoolean()
  termsAccepted!: boolean;

  @ApiProperty({ enum: ['fr', 'ar'], default: 'fr', required: false })
  @IsOptional()
  @IsIn(['fr', 'ar'])
  locale: 'fr' | 'ar' = 'fr';
}

export class PasswordResetRequestDto {
  @ApiProperty({ example: 'client@example.tn' })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class PasswordResetCompleteDto {
  @ApiProperty({ description: 'Single-use reset token received out of band.' })
  @IsString()
  @Length(32, 256)
  token!: string;

  @ApiProperty({ format: 'password', minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/[a-z]/)
  @Matches(/[A-Z]/)
  @Matches(/[0-9]/)
  @Matches(/[^A-Za-z0-9]/)
  newPassword!: string;
}

export class GoogleOAuthStartDto {
  @ApiProperty({ enum: ['LOGIN', 'REGISTER'] })
  @IsIn(['LOGIN', 'REGISTER'])
  intent!: 'LOGIN' | 'REGISTER';

  @ApiProperty({ required: false, example: '/account' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^\/(?!\/)(?!(?:admin|api)(?:[/?#]|$))[^\\#]*$/)
  returnTo = '/account';

  @ApiProperty({ enum: ['fr', 'ar'], default: 'fr', required: false })
  @IsOptional()
  @IsIn(['fr', 'ar'])
  locale: 'fr' | 'ar' = 'fr';
}

export class GoogleOAuthCallbackDto {
  @IsOptional()
  @IsString()
  @Length(16, 2_048)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(32, 256)
  state?: string;

  @IsOptional()
  @IsIn([
    'access_denied',
    'invalid_request',
    'invalid_scope',
    'server_error',
    'temporarily_unavailable',
    'unauthorized_client',
    'unsupported_response_type',
  ])
  error?:
    | 'access_denied'
    | 'invalid_request'
    | 'invalid_scope'
    | 'server_error'
    | 'temporarily_unavailable'
    | 'unauthorized_client'
    | 'unsupported_response_type';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error_description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  error_uri?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  scope?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,3}$/)
  authuser?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  hd?: string;
}

export class GoogleOAuthCompleteDto {
  @ApiProperty({ required: false, example: 'Amel Ben Salah' })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  fullName?: string;

  @ApiProperty({ required: false, example: '+21620123456' })
  @IsOptional()
  @IsString()
  @Matches(/^(?:\+216|00216)?[24579]\d{7}$/)
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  adultConfirmed?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  termsAccepted?: boolean;

  @ApiProperty({ required: false, enum: ['fr', 'ar'] })
  @IsOptional()
  @IsIn(['fr', 'ar'])
  locale?: 'fr' | 'ar';

  @ApiProperty({ required: false, format: 'password' })
  @IsOptional()
  @IsString()
  @Length(8, 128)
  currentPassword?: string;
}
