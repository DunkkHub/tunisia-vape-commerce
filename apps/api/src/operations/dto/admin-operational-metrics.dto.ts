import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class AdminOutboxMetricsDto {
  @ApiProperty({ minimum: 0 })
  PENDING!: number;

  @ApiProperty({ minimum: 0 })
  LEASED!: number;

  @ApiProperty({ minimum: 0 })
  PUBLISHED!: number;

  @ApiProperty({ minimum: 0 })
  PROCESSING!: number;

  @ApiProperty({ minimum: 0 })
  RETRY!: number;

  @ApiProperty({ minimum: 0 })
  PROCESSED!: number;

  @ApiProperty({ minimum: 0 })
  DEAD_LETTER!: number;

  @ApiProperty({ minimum: 0 })
  CANCELLED!: number;

  @ApiProperty({ minimum: 0 })
  actionableBacklog!: number;

  @ApiProperty({ minimum: 0 })
  scheduledBacklog!: number;

  @ApiProperty({ minimum: 0 })
  expiredLeases!: number;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  oldestActionableAvailableAt!: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  oldestActionableAgeSeconds!: number | null;
}

class AdminWorkerMetricsDto {
  @ApiProperty({ enum: ['MISSING', 'HEALTHY', 'UNHEALTHY', 'STALE'] })
  state!: 'MISSING' | 'HEALTHY' | 'UNHEALTHY' | 'STALE';

  @ApiPropertyOptional({ nullable: true, enum: ['HEALTHY', 'DEGRADED', 'UNHEALTHY'] })
  status!: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  checkedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  ageSeconds!: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  latencyMs!: number | null;

  @ApiProperty({ minimum: 1 })
  maximumAgeSeconds!: number;
}

class AdminOperationalMetricsDataDto {
  @ApiProperty({ format: 'date-time' })
  asOf!: string;

  @ApiProperty({ type: () => AdminOutboxMetricsDto })
  outbox!: AdminOutboxMetricsDto;

  @ApiProperty({ type: () => AdminWorkerMetricsDto })
  worker!: AdminWorkerMetricsDto;

  @ApiProperty({ additionalProperties: { type: 'string' } })
  definitions!: Record<string, string>;
}

export class AdminOperationalMetricsResponseDto {
  @ApiProperty({ type: () => AdminOperationalMetricsDataDto })
  data!: AdminOperationalMetricsDataDto;
}
