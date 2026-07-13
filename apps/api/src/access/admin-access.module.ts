import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { CustomerAccountActionsController } from './customer-account-actions.controller';
import { CustomerAccountActionsService } from './customer-account-actions.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminAccountsController, CustomerAccountActionsController],
  providers: [AdminAccountsService, CustomerAccountActionsService],
})
export class AdminAccessModule {}
