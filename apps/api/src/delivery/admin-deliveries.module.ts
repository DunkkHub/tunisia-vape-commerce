import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminDeliveriesController } from './admin-deliveries.controller';
import { AdminDeliveriesService } from './admin-deliveries.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminDeliveriesController],
  providers: [AdminDeliveriesService],
  exports: [AdminDeliveriesService],
})
export class AdminDeliveriesModule {}
