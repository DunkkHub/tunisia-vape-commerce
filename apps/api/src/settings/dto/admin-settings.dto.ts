import { ApiProperty } from '@nestjs/swagger';
import type { SettingValueType } from '@prisma/client';
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

export class ExportedOperationalSettingDto {
  @ApiProperty()
  key!: string;

  @ApiProperty({ enum: ['BOOLEAN', 'INTEGER', 'STRING', 'JSON'] })
  valueType!: SettingValueType;

  @ApiProperty({
    oneOf: [
      { type: 'boolean' },
      { type: 'integer' },
      { type: 'string' },
      { type: 'object' },
      { type: 'array' },
    ],
  })
  value!: unknown;
}

export class StoreConfigurationExportDto {
  @ApiProperty({ example: 'tunisia-vape-store-configuration' })
  format!: 'tunisia-vape-store-configuration';

  @ApiProperty({ example: 1 })
  schemaVersion!: 1;

  @ApiProperty({ type: [ExportedOperationalSettingDto] })
  store!: ExportedOperationalSettingDto[];

  @ApiProperty({ type: [ExportedOperationalSettingDto] })
  compliance!: ExportedOperationalSettingDto[];

  @ApiProperty({ description: 'Number of secret or defensively sensitive records omitted.' })
  excludedSecretCount!: number;

  @ApiProperty({ pattern: '^[a-f0-9]{64}$' })
  checksumSha256!: string;
}

export class StoreConfigurationExportResponseDto {
  @ApiProperty({ type: StoreConfigurationExportDto })
  data!: StoreConfigurationExportDto;
}
