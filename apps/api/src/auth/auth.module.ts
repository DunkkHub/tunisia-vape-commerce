import { Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AuthEventService } from './auth-event.service';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { DistributedAuthThrottleService } from './distributed-auth-throttle.service';
import { AdminSessionGuard } from './guards/admin-session.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { CustomerSessionGuard } from './guards/customer-session.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { RecentAuthenticationGuard } from './guards/recent-authentication.guard';
import { TrustedOriginGuard } from './guards/trusted-origin.guard';
import { SuperAdministratorGuard } from './guards/super-administrator.guard';
import { SessionService } from './session.service';
import { CryptoService } from '../common/security/crypto.service';

@Module({
  controllers: [CustomerAuthController, AdminAuthController],
  providers: [
    CryptoService,
    AuthEventService,
    SessionService,
    CustomerAuthService,
    DistributedAuthThrottleService,
    AdminAuthService,
    CustomerSessionGuard,
    AdminSessionGuard,
    CsrfGuard,
    PermissionsGuard,
    RecentAuthenticationGuard,
    TrustedOriginGuard,
    SuperAdministratorGuard,
  ],
  exports: [
    CryptoService,
    SessionService,
    CustomerSessionGuard,
    AdminSessionGuard,
    CsrfGuard,
    PermissionsGuard,
    RecentAuthenticationGuard,
    TrustedOriginGuard,
    SuperAdministratorGuard,
  ],
})
export class AuthModule {}
