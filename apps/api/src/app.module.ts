import { Module, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AdminAccessModule } from './access/admin-access.module';
import { AuthModule } from './auth/auth.module';
import { TrustedOriginGuard } from './auth/guards/trusted-origin.guard';
import { CacheModule } from './cache/cache.module';
import { AdminCashModule } from './cash/admin-cash.module';
import { CommerceModule } from './commerce/commerce.module';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { AdminDeliveriesModule } from './delivery/admin-deliveries.module';
import { DeliveryConfigModule } from './delivery-config/delivery-config.module';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { AdminReadModule } from './operations/admin-read.module';
import { AdminOrdersModule } from './orders/admin-orders.module';
import { SettingsModule } from './settings/settings.module';

export const HTTP_LOG_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers.set-cookie',
  'password',
  '*.password',
  '*.token',
  '*.secret',
  '*.recoveryCodes',
] as const;

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    LoggerModule.forRoot({
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: {
          paths: [...HTTP_LOG_REDACTION_PATHS],
          censor: '[REDACTED]',
        },
      },
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    CacheModule,
    AuthModule,
    AdminAccessModule,
    CommerceModule,
    AdminReadModule,
    AdminOrdersModule,
    AdminDeliveriesModule,
    DeliveryConfigModule,
    AdminCashModule,
    InventoryModule,
    SettingsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: TrustedOriginGuard },
  ],
})
export class AppModule {}
