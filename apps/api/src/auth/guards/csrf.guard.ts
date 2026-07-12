import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AUTH_AUDIENCES, cookieNames } from '../../common/auth/auth.constants';
import { CryptoService } from '../../common/security/crypto.service';
import type { Environment } from '../../config/environment';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes((request.method || 'POST').toUpperCase())) return true;
    if (!request.auth?.csrfTokenHash) throw this.forbidden();
    const production = this.config.get('NODE_ENV', { infer: true }) === 'production';
    const names = cookieNames(production);
    const csrfName =
      request.auth.audience === AUTH_AUDIENCES.ADMIN ? names.adminCsrf : names.customerCsrf;
    const cookie = (request.cookies as Record<string, unknown> | undefined)?.[csrfName];
    const header = request.get('x-csrf-token');
    if (
      typeof cookie !== 'string' ||
      !header ||
      !this.crypto.tokenMatches(cookie, request.auth.csrfTokenHash) ||
      !this.crypto.tokenMatches(header, request.auth.csrfTokenHash)
    ) {
      throw this.forbidden();
    }
    return true;
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'CSRF_VALIDATION_FAILED',
      message: 'The request could not be verified.',
    });
  }
}
