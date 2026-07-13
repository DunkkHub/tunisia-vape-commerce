import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminInventoryController } from './admin-inventory.controller';
import { AdminInventoryService } from './admin-inventory.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminInventoryController],
  providers: [AdminInventoryService],
  exports: [AdminInventoryService],
})
export class InventoryModule {}
