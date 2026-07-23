import { createDecipheriv, createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

export const BACKUP_MAGIC = Buffer.from('TVB1');
export const BACKUP_HEADER_BYTES = 16;
export const BACKUP_TAG_BYTES = 16;

const SAFE_UNENCRYPTED_ENVIRONMENT = /^(?:local|development|test|ci)(?:[-_.][A-Za-z0-9._-]+)?$/i;
const MANIFEST_AUTHENTICATION_INFO = Buffer.from('tunisia-vape-backup-manifest-v2');

const normalizedPath = (value) =>
  process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value;

const isInsideDirectory = (directory, candidate) => {
  const relative = path.relative(directory, candidate);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
};

export const prepareSafeDirectory = async (value, variableName) => {
  if (!value || value.includes('\0')) throw new Error(`${variableName} must be a non-empty path`);
  const resolved = path.resolve(value);
  if (normalizedPath(resolved) === normalizedPath(path.parse(resolved).root)) {
    throw new Error(`${variableName} must not be a filesystem root`);
  }
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  const metadata = await lstat(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${variableName} must be a real directory, not a link`);
  }
  const canonical = await realpath(resolved);
  if (normalizedPath(canonical) !== normalizedPath(resolved)) {
    throw new Error(`${variableName} must not traverse a symbolic link or junction`);
  }
  return canonical;
};

export const safeChildPath = (directory, fileName) => {
  if (!fileName || fileName !== path.basename(fileName) || fileName.includes('\0')) {
    throw new Error('Backup file name is unsafe');
  }
  const candidate = path.resolve(directory, fileName);
  if (!isInsideDirectory(directory, candidate))
    throw new Error('Backup path escaped its directory');
  return candidate;
};

export const assertRegularFile = async (filePath, label) => {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file, not a link`);
  }
  const canonical = await realpath(filePath);
  const resolved = path.resolve(filePath);
  if (normalizedPath(canonical) !== normalizedPath(resolved)) {
    throw new Error(`${label} must not traverse a symbolic link or junction`);
  }
  return metadata;
};

export const decodeEncryptionKey = (encoded) => {
  if (!encoded) throw new Error('BACKUP_ENCRYPTION_KEY_BASE64 is required');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('Backup encryption key must decode to 32 bytes');
  return key;
};

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const manifestAuthenticationValue = (manifest, key) => {
  const authenticatedManifest = { ...manifest };
  delete authenticatedManifest.manifestAuthentication;
  const authenticationKey = hkdfSync(
    'sha256',
    key,
    Buffer.alloc(0),
    MANIFEST_AUTHENTICATION_INFO,
    32,
  );
  return createHmac('sha256', authenticationKey)
    .update(canonicalJson(authenticatedManifest), 'utf8')
    .digest('hex');
};

export const createManifestAuthentication = (manifest, key) => ({
  algorithm: 'HMAC-SHA256',
  value: manifestAuthenticationValue(manifest, key),
});

export const verifyManifestAuthentication = (manifest, key) => {
  const supplied = manifest?.manifestAuthentication?.value;
  if (
    manifest?.manifestAuthentication?.algorithm !== 'HMAC-SHA256' ||
    typeof supplied !== 'string' ||
    !/^[a-f0-9]{64}$/.test(supplied)
  ) {
    throw new Error('Backup manifest authentication is missing or invalid');
  }
  const actual = Buffer.from(supplied, 'hex');
  const expected = Buffer.from(manifestAuthenticationValue(manifest, key), 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Backup manifest authentication failed');
  }
};

export const resolveBackupEncryption = ({ mode, environment, allowUnencrypted }) => {
  const normalizedMode = (mode ?? 'aes-256-gcm').trim().toLowerCase();
  if (normalizedMode === 'aes-256-gcm') return { enabled: true, algorithm: 'AES-256-GCM' };
  if (normalizedMode !== 'none') {
    throw new Error('BACKUP_ENCRYPTION_MODE must be aes-256-gcm or none');
  }
  if (allowUnencrypted !== 'true' || !SAFE_UNENCRYPTED_ENVIRONMENT.test(environment ?? '')) {
    throw new Error(
      'Unencrypted backups require ALLOW_UNENCRYPTED_BACKUP=true and a local/development/test/ci environment',
    );
  }
  return { enabled: false, algorithm: 'NONE' };
};

export const assertUnencryptedRestoreAllowed = ({ environment, allowUnencrypted }) => {
  if (allowUnencrypted !== 'true' || !SAFE_UNENCRYPTED_ENVIRONMENT.test(environment ?? '')) {
    throw new Error(
      'Restoring an unencrypted backup requires RESTORE_ALLOW_UNENCRYPTED_BACKUP=true and a local/development/test/ci manifest',
    );
  }
};

export const mysqlTlsArguments = ({ mode, caFile, runtimeEnvironment }) => {
  const localRuntime = SAFE_UNENCRYPTED_ENVIRONMENT.test(runtimeEnvironment ?? '');
  const normalizedMode = (mode ?? (localRuntime ? 'PREFERRED' : '')).trim().toUpperCase();
  const allowedModes = new Set([
    'DISABLED',
    'PREFERRED',
    'REQUIRED',
    'VERIFY_CA',
    'VERIFY_IDENTITY',
  ]);
  if (!allowedModes.has(normalizedMode)) {
    throw new Error('MYSQL_TLS_MODE is invalid');
  }
  if (!localRuntime && normalizedMode !== 'VERIFY_IDENTITY') {
    throw new Error('Non-local backup and restore require MYSQL_TLS_MODE=VERIFY_IDENTITY');
  }
  const arguments_ = [`--ssl-mode=${normalizedMode}`];
  if (caFile) {
    if (!path.isAbsolute(caFile) || caFile.includes('\0') || /[\r\n]/.test(caFile)) {
      throw new Error('MYSQL_TLS_CA_FILE must be an absolute safe path');
    }
    arguments_.push(`--ssl-ca=${caFile}`);
  }
  return arguments_;
};

const MYSQL_CHILD_ENVIRONMENT_KEYS = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'HOME',
  'LANG',
  'LC_ALL',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
];

export const mysqlClientEnvironment = (password, source = process.env) => {
  const environment = {};
  for (const key of MYSQL_CHILD_ENVIRONMENT_KEYS) {
    if (source[key] !== undefined) environment[key] = source[key];
  }
  if (password) environment.MYSQL_PWD = password;
  return environment;
};

export const parseMysqlUrl = (value, variableName) => {
  if (!value) throw new Error(`${variableName} is required`);
  if (!URL.canParse(value)) {
    throw new Error(`${variableName} must be a complete MySQL database URL`);
  }
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

export const decompressAuthenticatedBackup = async (
  inputPath,
  outputPath,
  expectedPlaintextBytes,
) => {
  if (!Number.isSafeInteger(expectedPlaintextBytes) || expectedPlaintextBytes <= 0) {
    throw new Error('Backup manifest plaintext size is invalid');
  }
  let plaintextBytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      plaintextBytes += chunk.length;
      if (plaintextBytes > expectedPlaintextBytes) {
        callback(new Error('Decompressed backup exceeded its declared size'));
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      createReadStream(inputPath),
      createGunzip(),
      counter,
      createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }),
    );
    if (plaintextBytes !== expectedPlaintextBytes) {
      throw new Error('Decompressed backup size did not match its manifest');
    }
  } catch (error) {
    await rm(outputPath, { force: true });
    if (error instanceof Error && error.message.includes('manifest')) throw error;
    throw new Error('Backup decompression failed', { cause: error });
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
  const versionOne = manifest?.formatVersion === 1;
  const versionTwo = manifest?.formatVersion === 2;
  const encryptionAlgorithm = manifest?.encryption?.algorithm;
  const encryptionValid =
    encryptionAlgorithm === 'AES-256-GCM' || (versionTwo && encryptionAlgorithm === 'NONE');
  const compressionValid =
    (versionOne && manifest?.compression === undefined) ||
    (versionTwo && manifest?.compression?.algorithm === 'gzip');
  const sizesValid =
    Number.isSafeInteger(manifest?.plaintextBytes) &&
    manifest.plaintextBytes > 0 &&
    Number.isSafeInteger(manifest?.ciphertextBytes) &&
    manifest.ciphertextBytes === actualBytes &&
    (!versionTwo ||
      (Number.isSafeInteger(manifest?.compressedBytes) &&
        manifest.compressedBytes > 0 &&
        manifest.compressedBytes ===
          (encryptionAlgorithm === 'AES-256-GCM'
            ? actualBytes - BACKUP_HEADER_BYTES - BACKUP_TAG_BYTES
            : actualBytes)));
  const keyValid =
    encryptionAlgorithm === 'NONE'
      ? manifest?.encryption?.keyId === null
      : typeof manifest?.encryption?.keyId === 'string' &&
        /^[A-Za-z0-9._-]{1,100}$/.test(manifest.encryption.keyId);
  const expectedExtension = versionOne
    ? '.sql.enc'
    : encryptionAlgorithm === 'AES-256-GCM'
      ? '.sql.gz.enc'
      : '.sql.gz';
  const rowCountsValid =
    manifest?.rowCounts &&
    typeof manifest.rowCounts === 'object' &&
    !Array.isArray(manifest.rowCounts) &&
    Object.entries(manifest.rowCounts).every(
      ([table, count]) =>
        /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(table) && Number.isSafeInteger(count) && count >= 0,
    );
  const migrationStateValid =
    versionOne ||
    (Array.isArray(manifest?.migrationState) &&
      manifest.migrationState.length > 0 &&
      manifest.migrationState.length <= 10_000 &&
      manifest.migrationState.every(
        (migration) =>
          migration &&
          typeof migration.name === 'string' &&
          /^[A-Za-z0-9_.-]{1,200}$/.test(migration.name) &&
          typeof migration.checksum === 'string' &&
          /^[a-f0-9]{64}$/.test(migration.checksum),
      ));
  const manifestAuthenticationValid =
    versionOne ||
    (encryptionAlgorithm === 'AES-256-GCM'
      ? manifest?.manifestAuthentication?.algorithm === 'HMAC-SHA256' &&
        typeof manifest?.manifestAuthentication?.value === 'string' &&
        /^[a-f0-9]{64}$/.test(manifest.manifestAuthentication.value)
      : manifest?.manifestAuthentication?.algorithm === 'NONE' &&
        manifest?.manifestAuthentication?.value === null);
  if (
    !manifest ||
    (!versionOne && !versionTwo) ||
    !encryptionValid ||
    !compressionValid ||
    !sizesValid ||
    !keyValid ||
    !rowCountsValid ||
    !migrationStateValid ||
    !manifestAuthenticationValid ||
    typeof manifest.ciphertextSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.ciphertextSha256) ||
    manifest.ciphertextSha256 !== actualChecksum ||
    typeof manifest.fileName !== 'string' ||
    manifest.fileName !== path.basename(encryptedPath) ||
    !manifest.fileName.endsWith(expectedExtension) ||
    typeof manifest.environment !== 'string' ||
    !/^[A-Za-z0-9._-]{1,80}$/.test(manifest.environment) ||
    typeof manifest.databaseName !== 'string' ||
    !/^[A-Za-z0-9_]+$/.test(manifest.databaseName) ||
    typeof manifest.latestMigration !== 'string' ||
    !/^[A-Za-z0-9_.-]{1,200}$/.test(manifest.latestMigration) ||
    typeof manifest.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(manifest.createdAt))
  ) {
    throw new Error('Backup manifest verification failed');
  }
};
