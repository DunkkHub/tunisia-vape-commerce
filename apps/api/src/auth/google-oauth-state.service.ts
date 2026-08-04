import { createHash } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { RedisService } from '../cache/redis.service';
import { cookieNames, oauthCookieOptions } from '../common/auth/auth.constants';
import { CryptoService } from '../common/security/crypto.service';
import type { Environment } from '../config/environment';

const RELEASE_LOCK_SCRIPT =
  "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";

const FINISH_ONBOARDING_SCRIPT = `
if redis.call('get', KEYS[2]) ~= ARGV[1] then return 0 end
if redis.call('exists', KEYS[1]) == 0 then
  redis.call('del', KEYS[2])
  return 0
end
redis.call('del', KEYS[1], KEYS[2])
return 1`;

const RECORD_FAILED_LINK_SCRIPT = `
if redis.call('get', KEYS[2]) ~= ARGV[1] then return 0 end
if redis.call('exists', KEYS[1]) == 0 then
  redis.call('del', KEYS[2])
  return 0
end
if ARGV[2] == 'DELETE' then
  redis.call('del', KEYS[1], KEYS[2])
  return 1
end
local updated = redis.call('set', KEYS[1], ARGV[3], 'XX', 'KEEPTTL')
if not updated then
  redis.call('del', KEYS[2])
  return 0
end
redis.call('del', KEYS[2])
return 1`;

const safeReturnPath = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => {
    if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false;
    const pathname = value.split(/[?#]/, 1)[0]?.toLocaleLowerCase('en-US') ?? '';
    return (
      pathname !== '/admin' &&
      !pathname.startsWith('/admin/') &&
      pathname !== '/api' &&
      !pathname.startsWith('/api/')
    );
  });

const authorizationStateSchema = z.object({
  bindingHash: z.string().length(64),
  nonce: z.string().min(32).max(256),
  codeVerifier: z.string().min(43).max(128),
  returnTo: safeReturnPath,
  intent: z.enum(['LOGIN', 'REGISTER']),
  locale: z.enum(['fr', 'ar']),
});

const onboardingRecordSchema = z.object({
  mode: z.enum(['CREATE', 'LINK']),
  subjectHash: z.string().length(64),
  email: z.string().email().max(320),
  emailNormalized: z.string().email().max(320),
  fullName: z.string().max(120),
  customerId: z.string().min(1).max(30).optional(),
  returnTo: safeReturnPath,
  locale: z.enum(['fr', 'ar']),
  attempts: z.number().int().min(0).max(5),
});

export type GoogleAuthorizationState = z.infer<typeof authorizationStateSchema>;
export type GoogleOnboardingRecord = z.infer<typeof onboardingRecordSchema>;

export interface GoogleOnboardingClaim {
  tokenHash: string;
  lockKey: string;
  lockValue: string;
  ttlSeconds: number;
  record: GoogleOnboardingRecord;
}

export class GoogleOAuthStateError extends Error {
  constructor() {
    super('The Google authentication state is invalid or expired.');
    this.name = 'GoogleOAuthStateError';
  }
}

@Injectable()
export class GoogleOAuthStateService {
  constructor(
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async createAuthorization(
    input: Pick<GoogleAuthorizationState, 'returnTo' | 'intent' | 'locale'>,
    response: Response,
  ): Promise<{ state: string; nonce: string; codeChallenge: string }> {
    const state = this.crypto.randomToken(32);
    const binding = this.crypto.randomToken(32);
    const nonce = this.crypto.randomToken(32);
    const codeVerifier = this.crypto.randomToken(64);
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const record: GoogleAuthorizationState = {
      ...input,
      bindingHash: this.crypto.hashToken(binding),
      nonce,
      codeVerifier,
    };
    const ttlSeconds = this.ttlSeconds();
    await this.setNew(this.authorizationKey(state), record, ttlSeconds);
    const production = this.production();
    response.cookie(
      cookieNames(production).customerGoogleState,
      binding,
      oauthCookieOptions(production, ttlSeconds * 1_000),
    );
    return { state, nonce, codeChallenge };
  }

  async consumeAuthorization(
    state: string,
    request: Request,
    response: Response,
  ): Promise<GoogleAuthorizationState> {
    const production = this.production();
    const cookieName = cookieNames(production).customerGoogleState;
    const binding = this.readCookie(request, cookieName);
    this.clearCookie(response, cookieName);
    if (!binding) throw new GoogleOAuthStateError();
    try {
      await this.redis.connect();
      const encrypted = await this.redis.client.getdel(this.authorizationKey(state));
      if (!encrypted) throw new GoogleOAuthStateError();
      const record = this.decodeRecord(encrypted, authorizationStateSchema);
      if (!this.crypto.tokenMatches(binding, record.bindingHash)) {
        throw new GoogleOAuthStateError();
      }
      return record;
    } catch (error) {
      if (error instanceof GoogleOAuthStateError) throw error;
      throw this.dependencyUnavailable();
    }
  }

  async createOnboarding(record: Omit<GoogleOnboardingRecord, 'attempts'>, response: Response) {
    const token = this.crypto.randomToken(32);
    const tokenHash = this.crypto.hashToken(token);
    const ttlSeconds = this.ttlSeconds();
    await this.setNew(this.onboardingKey(tokenHash), { ...record, attempts: 0 }, ttlSeconds);
    const production = this.production();
    response.cookie(
      cookieNames(production).customerGoogleOnboarding,
      token,
      oauthCookieOptions(production, ttlSeconds * 1_000),
    );
  }

  async readOnboarding(request: Request): Promise<GoogleOnboardingRecord> {
    const tokenHash = this.onboardingTokenHash(request);
    try {
      await this.redis.connect();
      const encrypted = await this.redis.client.get(this.onboardingKey(tokenHash));
      if (!encrypted) throw new GoogleOAuthStateError();
      return this.decodeRecord(encrypted, onboardingRecordSchema);
    } catch (error) {
      if (error instanceof GoogleOAuthStateError) throw error;
      throw this.dependencyUnavailable();
    }
  }

  onboardingDiscriminator(request: Request): string {
    const token = this.readCookie(request, cookieNames(this.production()).customerGoogleOnboarding);
    return token ? this.crypto.hashToken(token) : 'missing-onboarding-cookie';
  }

  async claimOnboarding(request: Request): Promise<GoogleOnboardingClaim> {
    const tokenHash = this.onboardingTokenHash(request);
    const lockKey = `${this.onboardingKey(tokenHash)}:lock`;
    const lockValue = this.crypto.randomToken(24);
    let lockAcquired = false;
    try {
      await this.redis.connect();
      const acquired = await this.redis.client.set(lockKey, lockValue, 'EX', 30, 'NX');
      if (acquired !== 'OK') throw new GoogleOAuthStateError();
      lockAcquired = true;
      const key = this.onboardingKey(tokenHash);
      const [encrypted, ttlSeconds] = await Promise.all([
        this.redis.client.get(key),
        this.redis.client.ttl(key),
      ]);
      if (!encrypted || ttlSeconds <= 0) {
        throw new GoogleOAuthStateError();
      }
      return {
        tokenHash,
        lockKey,
        lockValue,
        ttlSeconds,
        record: this.decodeRecord(encrypted, onboardingRecordSchema),
      };
    } catch (error) {
      if (lockAcquired) {
        try {
          await this.releaseLock(lockKey, lockValue);
        } catch {
          throw this.dependencyUnavailable();
        }
      }
      if (error instanceof GoogleOAuthStateError) throw error;
      throw this.dependencyUnavailable();
    }
  }

  async finishOnboarding(claim: GoogleOnboardingClaim, response: Response): Promise<void> {
    try {
      await this.redis.connect();
      const finished = await this.redis.client.eval(
        FINISH_ONBOARDING_SCRIPT,
        2,
        this.onboardingKey(claim.tokenHash),
        claim.lockKey,
        claim.lockValue,
      );
      if (finished !== 1) throw new GoogleOAuthStateError();
    } catch (error) {
      if (error instanceof GoogleOAuthStateError) throw error;
      throw this.dependencyUnavailable();
    } finally {
      this.clearCookie(response, cookieNames(this.production()).customerGoogleOnboarding);
    }
  }

  async releaseOnboarding(claim: GoogleOnboardingClaim): Promise<void> {
    try {
      await this.redis.connect();
      await this.releaseLock(claim.lockKey, claim.lockValue);
    } catch {
      throw this.dependencyUnavailable();
    }
  }

  async recordFailedLink(claim: GoogleOnboardingClaim, response: Response): Promise<void> {
    const attempts = claim.record.attempts + 1;
    try {
      await this.redis.connect();
      const exhausted = attempts >= 5;
      const encrypted = exhausted
        ? ''
        : this.crypto.encrypt(JSON.stringify({ ...claim.record, attempts }));
      const updated = await this.redis.client.eval(
        RECORD_FAILED_LINK_SCRIPT,
        2,
        this.onboardingKey(claim.tokenHash),
        claim.lockKey,
        claim.lockValue,
        exhausted ? 'DELETE' : 'UPDATE',
        encrypted,
      );
      if (updated !== 1) throw new GoogleOAuthStateError();
      if (exhausted) {
        this.clearCookie(response, cookieNames(this.production()).customerGoogleOnboarding);
      }
    } catch (error) {
      if (error instanceof GoogleOAuthStateError) throw error;
      throw this.dependencyUnavailable();
    }
  }

  clearOnboardingCookie(response: Response): void {
    this.clearCookie(response, cookieNames(this.production()).customerGoogleOnboarding);
  }

  private async setNew(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.connect();
      const result = await this.redis.client.set(
        key,
        this.crypto.encrypt(JSON.stringify(value)),
        'EX',
        ttlSeconds,
        'NX',
      );
      if (result !== 'OK') throw new Error('Redis key collision');
    } catch {
      throw this.dependencyUnavailable();
    }
  }

  private onboardingTokenHash(request: Request): string {
    const token = this.readCookie(request, cookieNames(this.production()).customerGoogleOnboarding);
    if (!token) throw new GoogleOAuthStateError();
    return this.crypto.hashToken(token);
  }

  private authorizationKey(state: string): string {
    return `auth:google:state:${this.crypto.hashToken(state)}`;
  }

  private onboardingKey(tokenHash: string): string {
    return `auth:google:onboarding:${tokenHash}`;
  }

  private async releaseLock(key: string, value: string): Promise<void> {
    await this.redis.client.eval(RELEASE_LOCK_SCRIPT, 1, key, value);
  }

  private decodeRecord<T>(encrypted: string, schema: z.ZodType<T>): T {
    try {
      return schema.parse(JSON.parse(this.crypto.decrypt(encrypted)) as unknown);
    } catch {
      throw new GoogleOAuthStateError();
    }
  }

  private readCookie(request: Request, name: string): string | undefined {
    const value = (request.cookies as Record<string, unknown> | undefined)?.[name];
    return typeof value === 'string' && value.length >= 32 && value.length <= 256
      ? value
      : undefined;
  }

  private clearCookie(response: Response, name: string): void {
    response.clearCookie(name, {
      path: '/',
      secure: this.production(),
      sameSite: 'lax',
    });
  }

  private production(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }

  private ttlSeconds(): number {
    return this.config.get('GOOGLE_OAUTH_STATE_TTL_SECONDS', { infer: true });
  }

  private dependencyUnavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'AUTHENTICATION_DEPENDENCY_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable.',
    });
  }
}
