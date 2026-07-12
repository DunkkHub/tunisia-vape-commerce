import { createDecipheriv } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const [inputArgument, confirmation] = process.argv.slice(2);
if (!inputArgument || confirmation !== '--confirm-destructive-restore') {
  throw new Error('Usage: pnpm restore:mysql <backup.sql.enc> --confirm-destructive-restore');
}

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

const inputPath = path.resolve(inputArgument);
const metadata = await stat(inputPath);
if (metadata.size <= 32) throw new Error('Encrypted backup is too small');
const file = await open(inputPath, 'r');
const header = Buffer.alloc(16);
const authenticationTag = Buffer.alloc(16);
await file.read(header, 0, header.length, 0);
await file.read(authenticationTag, 0, authenticationTag.length, metadata.size - 16);
await file.close();
if (header.subarray(0, 4).toString('ascii') !== 'TVB1')
  throw new Error('Unsupported backup format');

const parsed = new URL(databaseUrl);
const database = decodeURIComponent(parsed.pathname.slice(1));
const mysql = spawn(
  process.env.MYSQL_BIN ?? 'mysql',
  [
    `--host=${parsed.hostname}`,
    `--port=${parsed.port || '3306'}`,
    `--user=${decodeURIComponent(parsed.username)}`,
    '--binary-mode',
    database,
  ],
  {
    env: { ...process.env, MYSQL_PWD: decodeURIComponent(parsed.password) },
    stdio: ['pipe', 'inherit', 'pipe'],
  },
);

let stderr = '';
mysql.stderr.setEncoding('utf8');
mysql.stderr.on('data', (chunk) => {
  stderr += chunk;
});
const exited = new Promise((resolve, reject) => {
  mysql.once('error', reject);
  mysql.once('exit', (code) =>
    code === 0 ? resolve() : reject(new Error(`mysql exited ${code}: ${stderr.trim()}`)),
  );
});

const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(4));
decipher.setAuthTag(authenticationTag);
await Promise.all([
  pipeline(
    createReadStream(inputPath, { start: 16, end: metadata.size - 17 }),
    decipher,
    mysql.stdin,
  ),
  exited,
]);
console.log(`Restore completed from ${inputPath}`);
