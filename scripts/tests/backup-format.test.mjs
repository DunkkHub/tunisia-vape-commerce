import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  BACKUP_MAGIC,
  assertDisposableRestore,
  assertUnencryptedRestoreAllowed,
  createManifestAuthentication,
  decompressAuthenticatedBackup,
  decryptAuthenticatedBackup,
  mysqlClientEnvironment,
  mysqlTlsArguments,
  prepareSafeDirectory,
  parseMysqlUrl,
  resolveBackupEncryption,
  validateManifest,
  verifyManifestAuthentication,
} from '../lib/backup-format.mjs';
import {
  backupArtifactCreatedAt,
  parseRetentionDays,
  pruneExpiredBackups,
} from '../lib/backup-retention.mjs';
import {
  assertGeneratedDrillDatabaseName,
  assertGeneratedDrillUserName,
  assertIsolatedDrillTarget,
  createDrillDatabaseName,
  createDrillUserName,
  databaseUrlForName,
  parseRestoreDrillArguments,
} from '../lib/restore-drill.mjs';

const createFixture = async (directory, key, plaintext) => {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const file = path.join(directory, 'fixture.sql.enc');
  await writeFile(
    file,
    Buffer.concat([BACKUP_MAGIC, initializationVector, encrypted, cipher.getAuthTag()]),
  );
  return file;
};

test('restore authenticates the entire encrypted backup before exposing plaintext', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'backup-format-test-'));
  try {
    const key = randomBytes(32);
    const plaintext = Buffer.from('-- authenticated SQL\nSELECT 1;\n');
    const encrypted = await createFixture(directory, key, plaintext);
    const output = path.join(directory, 'output.sql');
    await decryptAuthenticatedBackup(encrypted, output, key);
    assert.deepEqual(await readFile(output), plaintext);

    const tampered = Buffer.from(await readFile(encrypted));
    tampered[20] ^= 1;
    const tamperedPath = path.join(directory, 'tampered.sql.enc');
    await writeFile(tamperedPath, tampered);
    const rejectedOutput = path.join(directory, 'rejected.sql');
    await assert.rejects(decryptAuthenticatedBackup(tamperedPath, rejectedOutput, key));
    await assert.rejects(stat(rejectedOutput));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('manifest checksum and explicit disposable target confirmation are mandatory', async () => {
  assert.throws(() =>
    assertDisposableRestore({
      database: 'restore_db',
      confirmation: '--confirm-empty-disposable-database',
      targetIsDisposable: 'false',
      confirmedDatabase: 'restore_db',
    }),
  );
  assert.doesNotThrow(() =>
    assertDisposableRestore({
      database: 'restore_db',
      confirmation: '--confirm-empty-disposable-database',
      targetIsDisposable: 'true',
      confirmedDatabase: 'restore_db',
    }),
  );
  assert.throws(() =>
    validateManifest(
      {
        formatVersion: 1,
        fileName: 'backup.sql.enc',
        ciphertextBytes: 100,
        ciphertextSha256: 'wrong',
        encryption: { algorithm: 'AES-256-GCM' },
      },
      'backup.sql.enc',
      'actual',
      100,
    ),
  );
});

test('version two backup manifests require gzip metadata, safe encryption metadata and exact size', () => {
  const checksum = 'a'.repeat(64);
  const key = randomBytes(32);
  const manifest = {
    formatVersion: 2,
    fileName: 'vape-store-2026-07-20T12-00-00-000Z-aabbccdd.sql.gz.enc',
    createdAt: '2026-07-20T12:00:00.000Z',
    environment: 'staging',
    databaseName: 'vape_store',
    latestMigration: '20260720160000_cash_collection_idempotency',
    migrationState: [
      {
        name: '20260720160000_cash_collection_idempotency',
        checksum: 'b'.repeat(64),
      },
    ],
    rowCounts: { User: 1 },
    plaintextBytes: 100,
    compressedBytes: 80,
    ciphertextBytes: 112,
    ciphertextSha256: checksum,
    compression: { algorithm: 'gzip' },
    encryption: { algorithm: 'AES-256-GCM', keyId: 'backup-key-v1' },
  };
  manifest.manifestAuthentication = createManifestAuthentication(manifest, key);
  assert.doesNotThrow(() =>
    validateManifest(manifest, manifest.fileName, checksum, manifest.ciphertextBytes),
  );
  assert.doesNotThrow(() => verifyManifestAuthentication(manifest, key));
  assert.throws(() =>
    verifyManifestAuthentication({ ...manifest, createdAt: '2020-01-01T00:00:00.000Z' }, key),
  );
  assert.throws(() =>
    validateManifest(
      { ...manifest, compression: { algorithm: 'zip' } },
      manifest.fileName,
      checksum,
      manifest.ciphertextBytes,
    ),
  );
});

test('gzip materialization enforces the authenticated manifest plaintext size', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'backup-compression-test-'));
  try {
    const plaintext = Buffer.from('-- compressed SQL\nSELECT 1;\n');
    const compressed = path.join(directory, 'fixture.sql.gz');
    await writeFile(compressed, gzipSync(plaintext));
    const output = path.join(directory, 'output.sql');
    await decompressAuthenticatedBackup(compressed, output, plaintext.length);
    assert.deepEqual(await readFile(output), plaintext);
    await assert.rejects(
      decompressAuthenticatedBackup(
        compressed,
        path.join(directory, 'wrong-size.sql'),
        plaintext.length - 1,
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unencrypted backup mode is an explicit local-only exception', () => {
  assert.deepEqual(resolveBackupEncryption({ mode: undefined, environment: 'production' }), {
    enabled: true,
    algorithm: 'AES-256-GCM',
  });
  assert.throws(() =>
    resolveBackupEncryption({
      mode: 'none',
      environment: 'production',
      allowUnencrypted: 'true',
    }),
  );
  assert.deepEqual(
    resolveBackupEncryption({
      mode: 'none',
      environment: 'test',
      allowUnencrypted: 'true',
    }),
    { enabled: false, algorithm: 'NONE' },
  );
  assert.throws(() =>
    assertUnencryptedRestoreAllowed({ environment: 'production', allowUnencrypted: 'true' }),
  );
  assert.doesNotThrow(() =>
    assertUnencryptedRestoreAllowed({ environment: 'local', allowUnencrypted: 'true' }),
  );
});

test('non-local MySQL clients require identity-verified TLS and receive no application secrets', () => {
  assert.throws(() => mysqlTlsArguments({ mode: 'PREFERRED', runtimeEnvironment: 'production' }));
  assert.deepEqual(
    mysqlTlsArguments({ mode: 'VERIFY_IDENTITY', runtimeEnvironment: 'production' }),
    ['--ssl-mode=VERIFY_IDENTITY'],
  );
  assert.deepEqual(mysqlTlsArguments({ runtimeEnvironment: 'test' }), ['--ssl-mode=PREFERRED']);
  const environment = mysqlClientEnvironment('database-password', {
    PATH: 'safe-path',
    BACKUP_ENCRYPTION_KEY_BASE64: 'must-not-be-inherited',
    SMTP_PASSWORD: 'must-not-be-inherited',
  });
  assert.deepEqual(environment, { PATH: 'safe-path', MYSQL_PWD: 'database-password' });
});

test('retention removes only recognized expired backup artifacts from a safe directory', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'backup-retention-test-'));
  try {
    const safeDirectory = await prepareSafeDirectory(directory, 'TEST_BACKUP_DIRECTORY');
    const oldBackup = 'vape-store-2026-01-01T00-00-00-000Z-aabbccdd.sql.gz.enc';
    const oldManifest = `${oldBackup}.manifest.json`;
    const currentBackup = 'vape-store-2026-07-20T00-00-00-000Z-aabbccdd.sql.gz.enc';
    await Promise.all([
      writeFile(path.join(safeDirectory, oldBackup), 'old'),
      writeFile(path.join(safeDirectory, oldManifest), 'old manifest'),
      writeFile(path.join(safeDirectory, currentBackup), 'current'),
      writeFile(path.join(safeDirectory, 'do-not-delete.txt'), 'unrelated'),
    ]);
    const removed = await pruneExpiredBackups({
      directory: safeDirectory,
      retentionDays: 35,
      now: new Date('2026-07-20T12:00:00.000Z'),
    });
    assert.deepEqual(removed, [oldBackup, oldManifest]);
    await assert.rejects(stat(path.join(safeDirectory, oldBackup)));
    assert.equal((await stat(path.join(safeDirectory, currentBackup))).isFile(), true);
    assert.equal((await stat(path.join(safeDirectory, 'do-not-delete.txt'))).isFile(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('retention and restore-drill identifiers reject unsafe input', () => {
  assert.equal(parseRetentionDays(undefined), 35);
  assert.equal(parseRetentionDays('0'), 0);
  assert.throws(() => parseRetentionDays('-1'));
  assert.equal(
    backupArtifactCreatedAt(
      'vape-store-2026-07-20T12-00-00-000Z-aabbccdd.sql.gz.enc.manifest.json',
    )?.toISOString(),
    '2026-07-20T12:00:00.000Z',
  );
  assert.equal(backupArtifactCreatedAt('../outside.sql.gz'), null);

  const databaseName = createDrillDatabaseName(
    'vape_restore_drill',
    new Date('2026-07-20T12:00:00.000Z'),
    'aabbccdd',
  );
  assert.equal(databaseName, 'vape_restore_drill_20260720120000_aabbccdd');
  assert.doesNotThrow(() => assertGeneratedDrillDatabaseName(databaseName));
  assert.throws(() => assertGeneratedDrillDatabaseName('production'));
  assert.equal(createDrillUserName('aabbccdd'), 'vape_drill_aabbccdd');
  assert.doesNotThrow(() => assertGeneratedDrillUserName('vape_drill_aabbccdd'));
  assert.throws(() => assertGeneratedDrillUserName('root'));
  assert.doesNotThrow(() =>
    assertIsolatedDrillTarget({
      isolated: 'true',
      confirmedHost: 'isolated-mysql',
      actualHost: 'isolated-mysql',
    }),
  );
  assert.throws(() =>
    assertIsolatedDrillTarget({
      isolated: 'true',
      confirmedHost: 'production-mysql',
      actualHost: 'isolated-mysql',
    }),
  );
  assert.equal(
    new URL(databaseUrlForName('mysql://root:secret@127.0.0.1:3306/mysql', databaseName)).pathname,
    `/${databaseName}`,
  );
  assert.deepEqual(parseRestoreDrillArguments(['backup.sql.gz.enc']), {
    help: false,
    backupPath: 'backup.sql.gz.enc',
    keepDatabase: false,
  });
  assert.throws(() => parseRestoreDrillArguments(['backup', '--unknown']));
  assert.throws(
    () => parseMysqlUrl('not-a-url-with-secret-password', 'DATABASE_BACKUP_URL'),
    (error) => !error.message.includes('secret-password'),
  );
});

test('backup command validation never echoes a database password', () => {
  const passwordMarker = 'DO_NOT_PRINT_PASSWORD';
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../backup-mysql.mjs', import.meta.url))],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_BACKUP_URL: `mysql://backup_user:${passwordMarker}@127.0.0.1:3306/invalid-name`,
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(passwordMarker));
});
