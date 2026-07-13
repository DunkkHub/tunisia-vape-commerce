import { createCipheriv, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { appendFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import {
  BACKUP_MAGIC,
  decodeEncryptionKey,
  parseMysqlUrl,
  sha256File,
} from './lib/backup-format.mjs';

const database = parseMysqlUrl(process.env.DATABASE_BACKUP_URL, 'DATABASE_BACKUP_URL');
const key = decodeEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY_BASE64);
const keyId = process.env.BACKUP_ENCRYPTION_KEY_ID;
const environmentName = process.env.BACKUP_ENVIRONMENT;
if (!keyId || !/^[A-Za-z0-9._-]{1,100}$/.test(keyId)) {
  throw new Error('BACKUP_ENCRYPTION_KEY_ID is required and must be a safe identifier');
}
if (!environmentName || !/^[A-Za-z0-9._-]{1,80}$/.test(environmentName)) {
  throw new Error('BACKUP_ENVIRONMENT is required and must be a safe identifier');
}

const mysqlBinary = process.env.MYSQL_BIN ?? 'mysql';
const dumpBinary = process.env.MYSQLDUMP_BIN ?? 'mysqldump';
const toolEnvironment = { ...process.env, MYSQL_PWD: database.password };

const capture = async (file, arguments_, environment = process.env) => {
  const child = spawn(file, arguments_, { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let bytes = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes <= 1_000_000) stdout += chunk;
  });
  child.stderr.resume();
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0 || bytes > 1_000_000)
    throw new Error(`${path.basename(file)} metadata query failed`);
  return stdout.trim();
};

const mysqlArguments = [
  `--host=${database.hostname}`,
  `--port=${database.port}`,
  `--user=${database.username}`,
  '--batch',
  '--skip-column-names',
  '--raw',
  database.database,
];
const databaseVersion = await capture(
  mysqlBinary,
  [...mysqlArguments, '--execute=SELECT VERSION()'],
  toolEnvironment,
);
const latestMigration = await capture(
  mysqlBinary,
  [
    ...mysqlArguments,
    "--execute=SELECT COALESCE(MAX(migration_name), 'NONE') FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
  ],
  toolEnvironment,
);
const countQuery = [
  "SELECT 'User', COUNT(*) FROM `User`",
  "UNION ALL SELECT 'Product', COUNT(*) FROM `Product`",
  "UNION ALL SELECT 'ProductVariant', COUNT(*) FROM `ProductVariant`",
  "UNION ALL SELECT 'InventoryItem', COUNT(*) FROM `InventoryItem`",
  "UNION ALL SELECT 'StockReservation', COUNT(*) FROM `StockReservation`",
  "UNION ALL SELECT 'StockMovement', COUNT(*) FROM `StockMovement`",
  "UNION ALL SELECT 'Order', COUNT(*) FROM `Order`",
  "UNION ALL SELECT 'OrderItem', COUNT(*) FROM `OrderItem`",
  "UNION ALL SELECT 'OrderAddressSnapshot', COUNT(*) FROM `OrderAddressSnapshot`",
  "UNION ALL SELECT 'OrderConsentSnapshot', COUNT(*) FROM `OrderConsentSnapshot`",
  "UNION ALL SELECT 'Delivery', COUNT(*) FROM `Delivery`",
  "UNION ALL SELECT 'DeliveryEvent', COUNT(*) FROM `DeliveryEvent`",
  "UNION ALL SELECT 'CashCollection', COUNT(*) FROM `CashCollection`",
  "UNION ALL SELECT 'CashRemittance', COUNT(*) FROM `CashRemittance`",
  "UNION ALL SELECT 'AuditLog', COUNT(*) FROM `AuditLog`",
  "UNION ALL SELECT 'OutboxEvent', COUNT(*) FROM `OutboxEvent`",
  "UNION ALL SELECT 'Notification', COUNT(*) FROM `Notification`",
].join(' ');
const rowCountOutput = await capture(
  mysqlBinary,
  [...mysqlArguments, `--execute=${countQuery}`],
  toolEnvironment,
);
const rowCounts = Object.fromEntries(
  rowCountOutput.split(/\r?\n/).map((line) => {
    const [table, count] = line.split('\t');
    if (!table || !count || !/^\d+$/.test(count))
      throw new Error('Database count query was invalid');
    return [table, Number(count)];
  }),
);
const dumpToolVersion = await capture(dumpBinary, ['--version']);
const mysqlSpecificDumpArguments = /MariaDB/i.test(dumpToolVersion)
  ? []
  : ['--set-gtid-purged=OFF'];

const backupDirectory = path.resolve(process.env.BACKUP_DIRECTORY ?? 'backups');
await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
const createdAt = new Date();
const timestamp = createdAt.toISOString().replaceAll(/[:.]/g, '-');
const nonce = randomBytes(4).toString('hex');
const fileName = `vape-store-${timestamp}-${nonce}.sql.enc`;
const outputPath = path.join(backupDirectory, fileName);
const partialPath = `${outputPath}.partial`;
const manifestPath = `${outputPath}.manifest.json`;
const partialManifestPath = `${manifestPath}.partial`;
const initializationVector = randomBytes(12);
let dump;

try {
  await writeFile(partialPath, Buffer.concat([BACKUP_MAGIC, initializationVector]), {
    flag: 'wx',
    mode: 0o600,
  });
  dump = spawn(
    dumpBinary,
    [
      '--single-transaction',
      '--quick',
      '--routines',
      '--events',
      '--triggers',
      '--hex-blob',
      '--default-character-set=utf8mb4',
      '--tz-utc',
      '--no-tablespaces',
      ...mysqlSpecificDumpArguments,
      `--host=${database.hostname}`,
      `--port=${database.port}`,
      `--user=${database.username}`,
      database.database,
    ],
    { env: toolEnvironment, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  dump.stderr.resume();
  const exited = new Promise((resolve, reject) => {
    dump.once('error', reject);
    dump.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`mysqldump exited with code ${String(code)}`)),
    );
  });
  let plaintextBytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      plaintextBytes += chunk.length;
      callback(null, chunk);
    },
  });
  const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
  await Promise.all([
    pipeline(
      dump.stdout,
      counter,
      cipher,
      createWriteStream(partialPath, { flags: 'a', mode: 0o600 }),
    ),
    exited,
  ]);
  await appendFile(partialPath, cipher.getAuthTag());
  const partialMetadata = await stat(partialPath);
  if (plaintextBytes <= 0 || partialMetadata.size <= 32) throw new Error('Backup output was empty');
  const ciphertextSha256 = await sha256File(partialPath);
  await rename(partialPath, outputPath);
  const manifest = {
    formatVersion: 1,
    fileName,
    createdAt: createdAt.toISOString(),
    environment: environmentName,
    databaseName: database.database,
    mysqlVersion: databaseVersion.slice(0, 120),
    dumpToolVersion: dumpToolVersion.slice(0, 240),
    latestMigration: latestMigration.slice(0, 200),
    rowCounts,
    plaintextBytes,
    ciphertextBytes: partialMetadata.size,
    ciphertextSha256,
    encryption: { algorithm: 'AES-256-GCM', keyId },
  };
  await writeFile(partialManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  await rename(partialManifestPath, manifestPath);
  process.stdout.write(`${JSON.stringify({ backup: outputPath, manifest: manifestPath })}\n`);
} catch (error) {
  dump?.kill('SIGTERM');
  await Promise.all([
    rm(partialPath, { force: true }),
    rm(partialManifestPath, { force: true }),
    rm(outputPath, { force: true }),
    rm(manifestPath, { force: true }),
  ]);
  throw error;
}
