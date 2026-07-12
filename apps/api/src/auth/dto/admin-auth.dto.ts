import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

export class AdminLoginDto {
  @ApiProperty({ example: 'admin@example.tn' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @Length(12, 128)
  password!: string;
}

export class AdminTotpDto {
  @ApiProperty({ description: 'Opaque five-minute challenge identifier.' })
  @IsString()
  @Length(32, 128)
  challengeId!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
