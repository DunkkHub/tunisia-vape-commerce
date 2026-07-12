import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment';

@Injectable()
export class CryptoService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  tokenMatches(token: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hashToken(token), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  encrypt(value: string): string {
    const key = createHash('sha256')
      .update(this.config.get('FIELD_ENCRYPTION_KEY', { infer: true }), 'utf8')
      .digest();
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [
      initializationVector.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string): string {
    const [initializationVector, authenticationTag, encrypted] = payload.split('.');
    if (!initializationVector || !authenticationTag || !encrypted) {
      throw new Error('Invalid encrypted payload');
    }
    const key = createHash('sha256')
      .update(this.config.get('FIELD_ENCRYPTION_KEY', { infer: true }), 'utf8')
      .digest();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(initializationVector, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authenticationTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
