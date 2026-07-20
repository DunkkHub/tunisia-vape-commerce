import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminCommerceReadsController } from './admin-commerce-reads.controller';
import { AdminCommerceReadsService } from './admin-commerce-reads.service';
import { AdminOperationalMetricsService } from './admin-operational-metrics.service';
import { AdminReadController } from './admin-read.controller';
import { AdminReadService } from './admin-read.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminReadController, AdminCommerceReadsController],
  providers: [AdminReadService, AdminCommerceReadsService, AdminOperationalMetricsService],
  exports: [AdminReadService, AdminCommerceReadsService, AdminOperationalMetricsService],
})
export class AdminReadModule {}
