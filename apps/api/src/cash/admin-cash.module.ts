import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminCashController } from './admin-cash.controller';
import { AdminCashService } from './admin-cash.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminCashController],
  providers: [AdminCashService],
  exports: [AdminCashService],
})
export class AdminCashModule {}
