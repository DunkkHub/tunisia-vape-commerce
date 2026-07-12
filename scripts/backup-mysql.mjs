import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdir, appendFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const databaseUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
const encodedKey = process.env.BACKUP_ENCRYPTION_KEY_BASE64;
if (!databaseUrl || !encodedKey) {
  throw new Error(
    'DATABASE_MIGRATION_URL (or DATABASE_URL) and BACKUP_ENCRYPTION_KEY_BASE64 are required',
  );
}

const key = Buffer.from(encodedKey, 'base64');
if (key.length !== 32)
  throw new Error('BACKUP_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes');

const parsed = new URL(databaseUrl);
const database = decodeURIComponent(parsed.pathname.slice(1));
const backupDirectory = path.resolve('backups');
await mkdir(backupDirectory, { recursive: true });
const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const outputPath = path.join(backupDirectory, `vape-store-${timestamp}.sql.enc`);
const initializationVector = randomBytes(12);
const output = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
output.write(Buffer.concat([Buffer.from('TVB1'), initializationVector]));

const dump = spawn(
  process.env.MYSQLDUMP_BIN ?? 'mysqldump',
  [
    '--single-transaction',
    '--quick',
    '--routines',
    '--triggers',
    '--set-gtid-purged=OFF',
    '--no-tablespaces',
    `--host=${parsed.hostname}`,
    `--port=${parsed.port || '3306'}`,
    `--user=${decodeURIComponent(parsed.username)}`,
    database,
  ],
  {
    env: { ...process.env, MYSQL_PWD: decodeURIComponent(parsed.password) },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let stderr = '';
dump.stderr.setEncoding('utf8');
dump.stderr.on('data', (chunk) => {
  stderr += chunk;
});
const exited = new Promise((resolve, reject) => {
  dump.once('error', reject);
  dump.once('exit', (code) =>
    code === 0 ? resolve() : reject(new Error(`mysqldump exited ${code}: ${stderr.trim()}`)),
  );
});

const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
await Promise.all([pipeline(dump.stdout, cipher, output), exited]);
await appendFile(outputPath, cipher.getAuthTag());
console.log(outputPath);
