import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { Environment } from '../../config/environment';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  const config = new ConfigService<Environment, true>({
    FIELD_ENCRYPTION_KEY: 'a'.repeat(48),
  } as Environment);
  const service = new CryptoService(config);

  it('hashes opaque tokens without storing the bearer value', () => {
    const token = service.randomToken();
    const hash = service.hashToken(token);
    expect(hash).not.toContain(token);
    expect(service.tokenMatches(token, hash)).toBe(true);
    expect(service.tokenMatches(`${token}x`, hash)).toBe(false);
  });

  it('encrypts and authenticates sensitive TOTP secrets', () => {
    const encrypted = service.encrypt('totp-secret');
    expect(encrypted).not.toContain('totp-secret');
    expect(service.decrypt(encrypted)).toBe('totp-secret');
  });
});
