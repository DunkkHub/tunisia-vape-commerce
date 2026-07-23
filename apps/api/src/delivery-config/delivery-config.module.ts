import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminDeliveryConfigController } from './delivery-config.controller';
import {
  DeliveryRatesConfigService,
  DeliveryWindowsConfigService,
  DeliveryZonesConfigService,
  PickupLocationsConfigService,
} from './delivery-config.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminDeliveryConfigController],
  providers: [
    DeliveryZonesConfigService,
    DeliveryRatesConfigService,
    PickupLocationsConfigService,
    DeliveryWindowsConfigService,
  ],
})
export class DeliveryConfigModule {}
