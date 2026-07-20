import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { CustomerAccountActionsController } from './customer-account-actions.controller';
import { CustomerAccountActionsService } from './customer-account-actions.service';
import { CustomerManagementController } from './customer-management.controller';
import { CustomerManagementService } from './customer-management.service';

@Module({
  imports: [AuthModule],
  controllers: [
    AdminAccountsController,
    CustomerAccountActionsController,
    CustomerManagementController,
  ],
  providers: [AdminAccountsService, CustomerAccountActionsService, CustomerManagementService],
})
export class AdminAccessModule {}
