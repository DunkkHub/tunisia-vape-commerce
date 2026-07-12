import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AgeGateService } from './age-gate.service';

@Injectable()
export class AgeGateGuard implements CanActivate {
  constructor(private readonly ageGate: AgeGateService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    await this.ageGate.assertConfirmed(request);
    return true;
  }
}
