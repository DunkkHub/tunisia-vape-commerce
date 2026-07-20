import { createDecipheriv, createHash } from 'node:crypto';
import { WorkerDomainError } from './outbox-contracts.js';

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_ENCRYPTED_FIELD_LENGTH = 16_384;

const decodePart = (value: string, expectedLength?: number): Buffer => {
  if (!value || !BASE64URL.test(value)) {
    throw new WorkerDomainError('NOTIFICATION_DECRYPTION_FAILED');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length === 0 || (expectedLength !== undefined && decoded.length !== expectedLength)) {
    throw new WorkerDomainError('NOTIFICATION_DECRYPTION_FAILED');
  }
  return decoded;
};

export const decryptNotificationField = (payload: string, encryptionKey: string): string => {
  if (
    payload.length === 0 ||
    payload.length > MAX_ENCRYPTED_FIELD_LENGTH ||
    encryptionKey.length < 16
  ) {
    throw new WorkerDomainError('NOTIFICATION_DECRYPTION_FAILED');
  }

  const parts = payload.split('.');
  if (parts.length !== 3) throw new WorkerDomainError('NOTIFICATION_DECRYPTION_FAILED');

  const key = createHash('sha256').update(encryptionKey, 'utf8').digest();
  let cleartext: Buffer | undefined;
  try {
    const initializationVector = decodePart(parts[0]!, 12);
    const authenticationTag = decodePart(parts[1]!, 16);
    const encrypted = decodePart(parts[2]!);
    const decipher = createDecipheriv('aes-256-gcm', key, initializationVector);
    decipher.setAuthTag(authenticationTag);
    cleartext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const value = cleartext.toString('utf8');
    if (!value || value.length > 8_192) {
      throw new WorkerDomainError('NOTIFICATION_DECRYPTION_FAILED');
    }
    return value;
  } catch (error) {
    if (error instanceof WorkerDomainError) throw error;
    throw new WorkerDomainError('NOTIFICATION_DECRYPTION_FAILED');
  } finally {
    key.fill(0);
    cleartext?.fill(0);
  }
};
