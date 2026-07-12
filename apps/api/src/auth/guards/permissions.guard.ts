import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_METADATA } from '../permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (
      !request.auth ||
      !required.every((permission) => request.auth?.permissions.includes(permission))
    ) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSION',
        message: 'You do not have permission to perform this action.',
      });
    }
    return true;
  }
}
