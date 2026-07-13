import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BACKUP_MAGIC,
  assertDisposableRestore,
  decryptAuthenticatedBackup,
  validateManifest,
} from '../lib/backup-format.mjs';

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
