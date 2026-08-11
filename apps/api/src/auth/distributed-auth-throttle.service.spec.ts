import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { RedisService } from '../cache/redis.service';
import type { CryptoService } from '../common/security/crypto.service';
import { DistributedAuthThrottleService } from './distributed-auth-throttle.service';

const request = {
  ip: '203.0.113.10',
  socket: {},
} as Request;

describe('DistributedAuthThrottleService', () => {
  it('uses independent hashed IP and account buckets in one atomic Redis operation', async () => {
    const evalCommand = vi.fn().mockResolvedValue([1, 1]);
    const redis = {
      client: { status: 'ready', eval: evalCommand },
      connect: vi.fn(),
    } as unknown as RedisService;
    const crypto = {
      hashToken: vi.fn((value: string) => `hash:${value}`),
    } as unknown as CryptoService;
    const service = new DistributedAuthThrottleService(redis, crypto);

    await service.consume('customer-password-reset', 'User@Example.test', request, 3, 900);

    expect(evalCommand).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'auth:rate:hash:customer-password-reset:ip:203.0.113.10',
      'auth:rate:hash:customer-password-reset:account:user@example.test',
      '900',
    );
  });

  it.each([
    [[4, 1], 'IP'],
    [[1, 4], 'account'],
  ])('rejects when the %s bucket exceeds the limit', async (counts) => {
    const redis = {
      client: { status: 'ready', eval: vi.fn().mockResolvedValue(counts) },
      connect: vi.fn(),
    } as unknown as RedisService;
    const crypto = {
      hashToken: vi.fn((value: string) => `hash:${value}`),
    } as unknown as CryptoService;

    await expect(
      new DistributedAuthThrottleService(redis, crypto).consume(
        'customer-password-reset',
        'user@example.test',
        request,
        3,
        900,
      ),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('fails closed when Redis is unavailable or returns an invalid shape', async () => {
    for (const result of [new Error('redis down'), [1]]) {
      const redis = {
        client: {
          status: 'ready',
          eval: vi
            .fn()
            .mockImplementation(() =>
              result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
            ),
        },
        connect: vi.fn(),
      } as unknown as RedisService;
      const crypto = {
        hashToken: vi.fn((value: string) => `hash:${value}`),
      } as unknown as CryptoService;
      await expect(
        new DistributedAuthThrottleService(redis, crypto).consume(
          'customer-login',
          'user@example.test',
          request,
          5,
          60,
        ),
      ).rejects.toMatchObject({ status: 503 });
    }
  });
});
