import { createDecipheriv, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

export const BACKUP_MAGIC = Buffer.from('TVB1');
export const BACKUP_HEADER_BYTES = 16;
export const BACKUP_TAG_BYTES = 16;

export const decodeEncryptionKey = (encoded) => {
  if (!encoded) throw new Error('BACKUP_ENCRYPTION_KEY_BASE64 is required');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('Backup encryption key must decode to 32 bytes');
  return key;
};

export const parseMysqlUrl = (value, variableName) => {
  if (!value) throw new Error(`${variableName} is required`);
  const parsed = new URL(value);
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (
    parsed.protocol !== 'mysql:' ||
    !parsed.hostname ||
    !parsed.username ||
    !database ||
    !/^[A-Za-z0-9_]+$/.test(database)
  ) {
    throw new Error(`${variableName} must be a complete MySQL database URL`);
  }
  return {
    hostname: parsed.hostname,
    port: parsed.port || '3306',
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
};

export const sha256File = async (filePath) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
};

export const decryptAuthenticatedBackup = async (inputPath, outputPath, key) => {
  const metadata = await stat(inputPath);
  if (metadata.size <= BACKUP_HEADER_BYTES + BACKUP_TAG_BYTES) {
    throw new Error('Encrypted backup is too small');
  }
  const file = await open(inputPath, 'r');
  const header = Buffer.alloc(BACKUP_HEADER_BYTES);
  const authenticationTag = Buffer.alloc(BACKUP_TAG_BYTES);
  try {
    await file.read(header, 0, header.length, 0);
    await file.read(
      authenticationTag,
      0,
      authenticationTag.length,
      metadata.size - BACKUP_TAG_BYTES,
    );
  } finally {
    await file.close();
  }
  if (!header.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new Error('Unsupported backup format');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(BACKUP_MAGIC.length));
  decipher.setAuthTag(authenticationTag);
  try {
    await pipeline(
      createReadStream(inputPath, {
        start: BACKUP_HEADER_BYTES,
        end: metadata.size - BACKUP_TAG_BYTES - 1,
      }),
      decipher,
      createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }),
    );
  } catch {
    await rm(outputPath, { force: true });
    throw new Error('Backup authentication or decryption failed');
  }
};

export const assertDisposableRestore = ({
  database,
  confirmation,
  targetIsDisposable,
  confirmedDatabase,
}) => {
  if (confirmation !== '--confirm-empty-disposable-database') {
    throw new Error('Explicit disposable restore confirmation is required');
  }
  if (targetIsDisposable !== 'true' || confirmedDatabase !== database) {
    throw new Error('Restore target disposable-environment confirmation does not match');
  }
};

export const validateManifest = (manifest, encryptedPath, actualChecksum, actualBytes) => {
  if (
    !manifest ||
    manifest.formatVersion !== 1 ||
    manifest.encryption?.algorithm !== 'AES-256-GCM' ||
    typeof manifest.ciphertextSha256 !== 'string' ||
    manifest.ciphertextSha256 !== actualChecksum ||
    manifest.ciphertextBytes !== actualBytes ||
    typeof manifest.fileName !== 'string' ||
    manifest.fileName !== encryptedPath.split(/[\\/]/).at(-1)
  ) {
    throw new Error('Backup manifest verification failed');
  }
};
