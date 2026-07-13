import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_AUDIENCES } from '../../common/auth/auth.constants';

export const SUPER_ADMINISTRATOR_ROLE_KEY = 'super-administrator';

@Injectable()
export class SuperAdministratorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      request.auth?.audience !== AUTH_AUDIENCES.ADMIN ||
      !request.auth.roleKeys.includes(SUPER_ADMINISTRATOR_ROLE_KEY)
    ) {
      throw new ForbiddenException({
        code: 'SUPER_ADMINISTRATOR_REQUIRED',
        message: 'A super-administrator session is required for this action.',
      });
    }
    return true;
  }
}
