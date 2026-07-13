import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminSettingsService } from './admin-settings.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminSettingsController],
  providers: [AdminSettingsService],
})
export class SettingsModule {}
