import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Environment } from '../config/environment';

@Injectable()
export class ReadinessRedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private connecting: Promise<void> | null = null;

  constructor(config: ConfigService<Environment, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: config.get('HEALTHCHECK_TIMEOUT_MS', { infer: true }),
      retryStrategy: () => null,
    });
    this.client.on('error', () => undefined);
  }

  async ping(): Promise<void> {
    if (this.client.status !== 'ready') {
      this.connecting ??= this.client.connect().finally(() => {
        this.connecting = null;
      });
      await this.connecting;
    }
    const response = await this.client.ping();
    if (response !== 'PONG') throw new Error('Redis readiness failed');
  }

  onModuleDestroy(): void {
    this.client.disconnect(false);
  }
}
