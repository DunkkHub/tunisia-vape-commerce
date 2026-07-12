import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { RedisService } from '../cache/redis.service';
import { CryptoService } from '../common/security/crypto.service';

@Injectable()
export class DistributedAuthThrottleService {
  constructor(
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
  ) {}

  async consume(
    scope:
      | 'customer-login'
      | 'customer-registration'
      | 'customer-password-reset'
      | 'customer-password-reset-confirm'
      | 'admin-login',
    identifier: string,
    request: Request,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const ipAddress = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const discriminator = this.crypto.hashToken(
      `${scope}:${ipAddress}:${identifier.trim().toLocaleLowerCase('en-US')}`,
    );
    try {
      if (this.redis.client.status === 'wait') await this.redis.connect();
      const count = await this.redis.client.eval(
        "local n=redis.call('incr',KEYS[1]); if n==1 then redis.call('expire',KEYS[1],ARGV[1]) end; return n",
        1,
        `auth:rate:${discriminator}`,
        String(windowSeconds),
      );
      if (typeof count !== 'number' || count > limit) {
        throw new HttpException(
          {
            code: 'AUTH_RATE_LIMITED',
            message: 'Too many authentication attempts. Please try again later.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429) {
        throw error;
      }
      throw new ServiceUnavailableException({
        code: 'AUTHENTICATION_DEPENDENCY_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      });
    }
  }
}
