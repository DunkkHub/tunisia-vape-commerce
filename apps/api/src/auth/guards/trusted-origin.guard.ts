import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { browserOriginForPath, type Environment } from '../../config/environment';

@Injectable()
export class TrustedOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const fetchSite = request.get('sec-fetch-site');
    const origin = request.get('origin');
    const expectedOrigin = this.expectedOrigin(request);

    if (fetchSite === 'cross-site' || (origin && this.originOf(origin) !== expectedOrigin)) {
      throw new ForbiddenException({
        code: 'UNTRUSTED_REQUEST_ORIGIN',
        message: 'The request origin is not permitted.',
      });
    }
    return true;
  }

  private expectedOrigin(request: Request): string {
    const path = (request.originalUrl || request.url || '').split('?', 1)[0] ?? '';
    const environment = {
      WEB_URL: this.config.get('WEB_URL', { infer: true }),
      ADMIN_WEB_URL: this.config.get('ADMIN_WEB_URL', { infer: true }),
    };
    return browserOriginForPath(environment, path);
  }

  private originOf(value: string): string | null {
    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  }
}
