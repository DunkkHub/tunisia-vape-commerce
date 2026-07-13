import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDefined, IsIn, IsInt, IsString, MaxLength, Min } from 'class-validator';

export const SETTING_SCOPES = ['store', 'compliance'] as const;
export type SettingScope = (typeof SETTING_SCOPES)[number];

export class SettingKeyParametersDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  key!: string;
}

export class UpdateOperationalSettingDto {
  @ApiProperty({ oneOf: [{ type: 'boolean' }, { type: 'integer' }, { type: 'string' }] })
  @IsDefined()
  value!: unknown;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;

  @ApiProperty({ enum: [true] })
  @IsBoolean()
  @IsIn([true])
  confirmed!: true;
}
