import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { PrismaClient } from '@prisma/client';
import {
  assertDisposableRestore,
  decodeEncryptionKey,
  decryptAuthenticatedBackup,
  parseMysqlUrl,
  sha256File,
  validateManifest,
} from './lib/backup-format.mjs';
import { verifyRestoredDatabase } from './lib/restore-verification.mjs';

const [inputArgument, confirmation] = process.argv.slice(2);
if (!inputArgument) {
  throw new Error('Usage: pnpm restore:mysql <backup.sql.enc> --confirm-empty-disposable-database');
}
const database = parseMysqlUrl(process.env.DATABASE_RESTORE_URL, 'DATABASE_RESTORE_URL');
assertDisposableRestore({
  database: database.database,
  confirmation,
  targetIsDisposable: process.env.RESTORE_TARGET_IS_DISPOSABLE,
  confirmedDatabase: process.env.RESTORE_CONFIRM_DATABASE,
});
const key = decodeEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY_BASE64);
const inputPath = path.resolve(inputArgument);
const manifestPath = `${inputPath}.manifest.json`;
const [encryptedMetadata, manifestText, actualChecksum] = await Promise.all([
  stat(inputPath),
  readFile(manifestPath, 'utf8'),
  sha256File(inputPath),
]);
const manifest = JSON.parse(manifestText);
validateManifest(manifest, inputPath, actualChecksum, encryptedMetadata.size);

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'vape-restore-'));
const decryptedPath = path.join(temporaryDirectory, 'authenticated-backup.sql');
const mysqlBinary = process.env.MYSQL_BIN ?? 'mysql';
const mysqlEnvironment = { ...process.env, MYSQL_PWD: database.password };
const mysqlArguments = [
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
  await decryptAuthenticatedBackup(inputPath, decryptedPath, key);
  const tableCount = await runMysqlCapture(
    `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${database.database}'`,
  );
  if (tableCount !== '0') throw new Error('Restore target database is not empty');

  const mysql = spawn(
    mysqlBinary,
    [
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
    const verification = await verifyRestoredDatabase(prisma, manifest);
    process.stdout.write(
      `${JSON.stringify({ restoredFrom: inputPath, verification, warning: 'Count differences are advisory when writes occurred during logical backup.' })}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
