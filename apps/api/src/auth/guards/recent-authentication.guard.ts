import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AUTH_AUDIENCES } from '../../common/auth/auth.constants';
import type { Environment } from '../../config/environment';

export const RECENT_AUTHENTICATION_WINDOW_MS = 10 * 60_000;

@Injectable()
export class RecentAuthenticationGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.auth;
    const recent =
      auth?.audience === AUTH_AUDIENCES.ADMIN &&
      auth.twoFactorVerified &&
      Date.now() - auth.authenticatedAt.getTime() <=
        this.config.get('ADMIN_RECENT_AUTH_MINUTES', { infer: true }) * 60_000;
    if (!recent) {
      throw new ForbiddenException({
        code: 'RECENT_AUTHENTICATION_REQUIRED',
        message: 'Please authenticate again before performing this sensitive action.',
      });
    }
    return true;
  }
}
