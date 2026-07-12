import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean, IsInt, Max, Min } from 'class-validator';

export class ConfirmAgeGateDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true)
  confirmed!: true;

  @ApiProperty({ minimum: 18, maximum: 120 })
  @IsInt()
  @Min(18)
  @Max(120)
  minimumAge!: number;
}
