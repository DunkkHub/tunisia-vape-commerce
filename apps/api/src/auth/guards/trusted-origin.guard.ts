import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Environment } from '../../config/environment';

@Injectable()
export class TrustedOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const fetchSite = request.get('sec-fetch-site');
    const origin = request.get('origin');
    const expectedOrigin = new URL(this.config.get('WEB_URL', { infer: true })).origin;

    if (fetchSite === 'cross-site' || (origin && this.originOf(origin) !== expectedOrigin)) {
      throw new ForbiddenException({
        code: 'UNTRUSTED_REQUEST_ORIGIN',
        message: 'The request origin is not permitted.',
      });
    }
    return true;
  }

  private originOf(value: string): string | null {
    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  }
}
