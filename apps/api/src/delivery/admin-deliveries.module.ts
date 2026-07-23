import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminDeliveryOperationsService } from './admin-delivery-operations.service';
import { AdminDeliveriesController } from './admin-deliveries.controller';
import { AdminDeliveriesService } from './admin-deliveries.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminDeliveriesController],
  providers: [AdminDeliveriesService, AdminDeliveryOperationsService],
  exports: [AdminDeliveriesService, AdminDeliveryOperationsService],
})
export class AdminDeliveriesModule {}
