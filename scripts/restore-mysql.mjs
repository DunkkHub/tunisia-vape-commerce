import { constants as fsConstants, createReadStream } from 'node:fs';
import { chmod, copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { PrismaClient } from '@prisma/client';
import {
  assertDisposableRestore,
  assertRegularFile,
  assertUnencryptedRestoreAllowed,
  decodeEncryptionKey,
  decompressAuthenticatedBackup,
  decryptAuthenticatedBackup,
  mysqlClientEnvironment,
  mysqlTlsArguments,
  parseMysqlUrl,
  sha256File,
  validateManifest,
  verifyManifestAuthentication,
} from './lib/backup-format.mjs';
import { verifyRestoredDatabase } from './lib/restore-verification.mjs';

const [inputArgument, confirmation] = process.argv.slice(2);
if (!inputArgument) {
  throw new Error('Usage: pnpm restore:mysql <backup.sql.enc> --confirm-empty-disposable-database');
}
if (!process.env.EXPECTED_MIGRATION_NAME) {
  throw new Error('EXPECTED_MIGRATION_NAME is required for restore verification');
}
const database = parseMysqlUrl(process.env.DATABASE_RESTORE_URL, 'DATABASE_RESTORE_URL');
assertDisposableRestore({
  database: database.database,
  confirmation,
  targetIsDisposable: process.env.RESTORE_TARGET_IS_DISPOSABLE,
  confirmedDatabase: process.env.RESTORE_CONFIRM_DATABASE,
});
const inputPath = path.resolve(inputArgument);
const manifestPath = `${inputPath}.manifest.json`;
const [encryptedMetadata, manifestMetadata, manifestText, actualChecksum] = await Promise.all([
  assertRegularFile(inputPath, 'Backup input'),
  assertRegularFile(manifestPath, 'Backup manifest'),
  readFile(manifestPath, 'utf8'),
  sha256File(inputPath),
]);
if (manifestMetadata.size > 1_000_000) throw new Error('Backup manifest is too large');
const manifest = JSON.parse(manifestText);
validateManifest(manifest, inputPath, actualChecksum, encryptedMetadata.size);
const maximumPlaintextBytes = Number(process.env.RESTORE_MAX_PLAINTEXT_BYTES ?? '1099511627776');
if (
  !Number.isSafeInteger(maximumPlaintextBytes) ||
  maximumPlaintextBytes <= 0 ||
  manifest.plaintextBytes > maximumPlaintextBytes
) {
  throw new Error('Backup plaintext size exceeds the configured restore limit');
}
const encrypted = manifest.encryption.algorithm === 'AES-256-GCM';
if (manifest.formatVersion === 1) {
  if (process.env.RESTORE_ALLOW_LEGACY_UNSIGNED_MANIFEST !== 'true') {
    throw new Error('Legacy format-1 restore requires RESTORE_ALLOW_LEGACY_UNSIGNED_MANIFEST=true');
  }
} else if (!encrypted) {
  assertUnencryptedRestoreAllowed({
    environment: manifest.environment,
    allowUnencrypted: process.env.RESTORE_ALLOW_UNENCRYPTED_BACKUP,
  });
}
const key = encrypted ? decodeEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY_BASE64) : null;
if (manifest.formatVersion === 2 && encrypted && key) {
  verifyManifestAuthentication(manifest, key);
}

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'vape-restore-'));
await chmod(temporaryDirectory, 0o700);
const authenticatedPath = path.join(
  temporaryDirectory,
  manifest.formatVersion === 2 ? 'authenticated-backup.sql.gz' : 'authenticated-backup.sql',
);
const decryptedPath = path.join(temporaryDirectory, 'authenticated-backup.sql');
const mysqlBinary = process.env.MYSQL_BIN ?? 'mysql';
const tlsArguments = mysqlTlsArguments({
  mode: process.env.MYSQL_TLS_MODE,
  caFile: process.env.MYSQL_TLS_CA_FILE,
  runtimeEnvironment: process.env.NODE_ENV,
});
const mysqlEnvironment = mysqlClientEnvironment(database.password);
const mysqlArguments = [
  ...tlsArguments,
  `--host=${database.hostname}`,
  `--port=${database.port}`,
  `--user=${database.username}`,
  '--batch',
  '--skip-column-names',
  '--raw',
  database.database,
];

const runMysqlCapture = async (query) => {
  const child = spawn(mysqlBinary, [...mysqlArguments, `--execute=${query}`], {
    env: mysqlEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    if (output.length < 10_000) output += chunk;
  });
  child.stderr.resume();
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0 || output.length >= 10_000) throw new Error('Restore preflight query failed');
  return output.trim();
};

try {
  // Authentication is intentionally completed to a restricted temporary file before any MySQL
  // mutation process is spawned. A bad key/tag/checksum therefore cannot partially alter MySQL.
  if (encrypted && key) {
    await decryptAuthenticatedBackup(inputPath, authenticatedPath, key);
  } else {
    await copyFile(inputPath, authenticatedPath, fsConstants.COPYFILE_EXCL);
    await chmod(authenticatedPath, 0o600);
  }
  if (manifest.formatVersion === 2) {
    await decompressAuthenticatedBackup(authenticatedPath, decryptedPath, manifest.plaintextBytes);
  } else if ((await stat(decryptedPath)).size !== manifest.plaintextBytes) {
    throw new Error('Authenticated backup size did not match its manifest');
  }
  const tableCount = await runMysqlCapture(
    `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${database.database}'`,
  );
  if (tableCount !== '0') throw new Error('Restore target database is not empty');

  const mysql = spawn(
    mysqlBinary,
    [
      ...tlsArguments,
      `--host=${database.hostname}`,
      `--port=${database.port}`,
      `--user=${database.username}`,
      '--binary-mode',
      database.database,
    ],
    { env: mysqlEnvironment, stdio: ['pipe', 'ignore', 'pipe'] },
  );
  mysql.stderr.resume();
  const exited = new Promise((resolve, reject) => {
    mysql.once('error', reject);
    mysql.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`mysql restore exited with code ${String(code)}`)),
    );
  });
  await Promise.all([pipeline(createReadStream(decryptedPath), mysql.stdin), exited]);

  process.env.DATABASE_URL = process.env.DATABASE_RESTORE_URL;
  const prisma = new PrismaClient();
  try {
    const verification = await verifyRestoredDatabase(prisma, manifest, {
      expectedMigration: process.env.EXPECTED_MIGRATION_NAME,
    });
    process.stdout.write(
      `${JSON.stringify({
        restoredFrom: inputPath,
        compression: manifest.formatVersion === 2 ? 'gzip' : 'none',
        encryption: manifest.encryption.algorithm,
        verification,
        warning: 'Count differences are advisory when writes occurred during logical backup.',
      })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
