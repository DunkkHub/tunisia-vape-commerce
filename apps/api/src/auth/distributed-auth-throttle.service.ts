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
      | 'customer-google-start'
      | 'customer-google-complete'
      | 'admin-login',
    identifier: string,
    request: Request,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const ipAddress = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const ipDiscriminator = this.crypto.hashToken(`${scope}:ip:${ipAddress}`);
    const accountDiscriminator = this.crypto.hashToken(
      `${scope}:account:${identifier.trim().toLocaleLowerCase('en-US')}`,
    );
    try {
      if (this.redis.client.status === 'wait') await this.redis.connect();
      const counts = await this.redis.client.eval(
        "local a=redis.call('incr',KEYS[1]); if a==1 then redis.call('expire',KEYS[1],ARGV[1]) end; local b=redis.call('incr',KEYS[2]); if b==1 then redis.call('expire',KEYS[2],ARGV[1]) end; return {a,b}",
        2,
        `auth:rate:${ipDiscriminator}`,
        `auth:rate:${accountDiscriminator}`,
        String(windowSeconds),
      );
      if (
        !Array.isArray(counts) ||
        counts.length !== 2 ||
        counts.some((count) => !Number.isSafeInteger(Number(count)))
      ) {
        throw new Error('Invalid authentication throttle response');
      }
      if (counts.some((count) => Number(count) > limit)) {
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
