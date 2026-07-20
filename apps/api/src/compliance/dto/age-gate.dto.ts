import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean, IsInt, Max, Min } from 'class-validator';

export class ConfirmAgeGateDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true)
  confirmed!: true;

  @ApiProperty({ minimum: 1, maximum: 120 })
  @IsInt()
  @Min(1)
  @Max(120)
  minimumAge!: number;
}
