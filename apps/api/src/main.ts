import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/http/api-exception.filter';
import { requestIdMiddleware } from './common/http/request-id.middleware';
import type { Environment } from './config/environment';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = application.get(ConfigService<Environment, true>);
  const production = config.get('NODE_ENV', { infer: true }) === 'production';

  application.useLogger(application.get(Logger));
  application.use(requestIdMiddleware);
  application.use(cookieParser(config.get('COOKIE_SECRET', { infer: true })));
  application.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: production ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );
  application.enableCors({
    origin: [config.get('WEB_URL', { infer: true })],
    credentials: true,
    allowedHeaders: [
      'accept-language',
      'content-type',
      'idempotency-key',
      'x-client-context',
      'x-csrf-token',
      'x-idempotency-key',
      'x-request-id',
    ],
    exposedHeaders: ['x-request-id'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  });
  application.useBodyParser('json', { limit: '1mb' });
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      whitelist: true,
    }),
  );
  application.useGlobalFilters(new ApiExceptionFilter());
  application.enableShutdownHooks();

  const swaggerDocument = SwaggerModule.createDocument(
    application,
    new DocumentBuilder()
      .setTitle('Tunisia Vape Commerce API')
      .setDescription(
        'Versioned REST API. Customer and administrator authentication are separate security realms.',
      )
      .setVersion('1.0')
      .addCookieAuth('vape_customer_session', { type: 'apiKey', in: 'cookie' }, 'customer')
      .addCookieAuth('vape_admin_session', { type: 'apiKey', in: 'cookie' }, 'admin')
      .build(),
  );
  SwaggerModule.setup('api/docs', application, swaggerDocument, {
    swaggerOptions: { persistAuthorization: false },
  });

  const express = application.getHttpAdapter().getInstance();
  express.set('trust proxy', production ? 1 : false);
  express.disable('x-powered-by');

  await application.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

void bootstrap();
