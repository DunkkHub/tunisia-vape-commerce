import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_AUDIENCES } from '../../common/auth/auth.constants';
import { SessionService } from '../session.service';

@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    request.auth = await this.sessions.resolve(request, AUTH_AUDIENCES.ADMIN);
    return true;
  }
}
