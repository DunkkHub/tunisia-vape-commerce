import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ReadinessRedisService } from './readiness-redis.service';

@Module({ controllers: [HealthController], providers: [HealthService, ReadinessRedisService] })
export class HealthModule {}
