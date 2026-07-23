import { createCipheriv, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { appendFile, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { constants as zlibConstants, createGzip } from 'node:zlib';
import {
  BACKUP_MAGIC,
  createManifestAuthentication,
  decodeEncryptionKey,
  mysqlClientEnvironment,
  mysqlTlsArguments,
  parseMysqlUrl,
  prepareSafeDirectory,
  resolveBackupEncryption,
  safeChildPath,
  sha256File,
} from './lib/backup-format.mjs';
import { parseRetentionDays, pruneExpiredBackups } from './lib/backup-retention.mjs';

const database = parseMysqlUrl(process.env.DATABASE_BACKUP_URL, 'DATABASE_BACKUP_URL');
const environmentName = process.env.BACKUP_ENVIRONMENT;
if (!environmentName || !/^[A-Za-z0-9._-]{1,80}$/.test(environmentName)) {
  throw new Error('BACKUP_ENVIRONMENT is required and must be a safe identifier');
}
const encryption = resolveBackupEncryption({
  mode: process.env.BACKUP_ENCRYPTION_MODE,
  environment: environmentName,
  allowUnencrypted: process.env.ALLOW_UNENCRYPTED_BACKUP,
});
const key = encryption.enabled
  ? decodeEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY_BASE64)
  : null;
const keyId = encryption.enabled ? process.env.BACKUP_ENCRYPTION_KEY_ID : null;
if (encryption.enabled && (!keyId || !/^[A-Za-z0-9._-]{1,100}$/.test(keyId))) {
  throw new Error('BACKUP_ENCRYPTION_KEY_ID is required and must be a safe identifier');
}
const retentionDays = parseRetentionDays(process.env.BACKUP_RETENTION_DAYS);
const backupDirectory = await prepareSafeDirectory(
  process.env.BACKUP_DIRECTORY ?? 'backups',
  'BACKUP_DIRECTORY',
);

const mysqlBinary = process.env.MYSQL_BIN ?? 'mysql';
const dumpBinary = process.env.MYSQLDUMP_BIN ?? 'mysqldump';
const tlsArguments = mysqlTlsArguments({
  mode: process.env.MYSQL_TLS_MODE,
  caFile: process.env.MYSQL_TLS_CA_FILE,
  runtimeEnvironment: process.env.NODE_ENV,
});
const toolEnvironment = mysqlClientEnvironment(database.password);
const metadataEnvironment = mysqlClientEnvironment(null);

const syncFile = async (filePath) => {
  // Windows FlushFileBuffers requires a handle with write access. The file is already closed by
  // the pipeline, so r+ is safe here and preserves the same bytes while making the durability
  // barrier work on both Windows and POSIX hosts.
  const handle = await open(filePath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

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
  ...tlsArguments,
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
const migrationStateOutput = await capture(
  mysqlBinary,
  [
    ...mysqlArguments,
    '--execute=SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
  ],
  toolEnvironment,
);
const migrationState = migrationStateOutput.split(/\r?\n/).map((line) => {
  const [name, checksum] = line.split('\t');
  if (
    !name ||
    !/^[A-Za-z0-9_.-]{1,200}$/.test(name) ||
    !checksum ||
    !/^[a-f0-9]{64}$/.test(checksum)
  ) {
    throw new Error('Database migration metadata query was invalid');
  }
  return { name, checksum };
});
if (migrationState.length === 0) throw new Error('Database has no completed migrations');
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
const dumpToolVersion = await capture(dumpBinary, ['--version'], metadataEnvironment);
const mysqlSpecificDumpArguments = /MariaDB/i.test(dumpToolVersion)
  ? []
  : ['--set-gtid-purged=OFF'];

const createdAt = new Date();
const timestamp = createdAt.toISOString().replaceAll(/[:.]/g, '-');
const nonce = randomBytes(4).toString('hex');
const fileName = `vape-store-${timestamp}-${nonce}.sql.gz${encryption.enabled ? '.enc' : ''}`;
const outputPath = safeChildPath(backupDirectory, fileName);
const partialPath = `${outputPath}.partial`;
const manifestPath = `${outputPath}.manifest.json`;
const partialManifestPath = `${manifestPath}.partial`;
const initializationVector = encryption.enabled ? randomBytes(12) : null;
let dump;
let published = false;

try {
  if (encryption.enabled && initializationVector) {
    await writeFile(partialPath, Buffer.concat([BACKUP_MAGIC, initializationVector]), {
      flag: 'wx',
      mode: 0o600,
    });
  }
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
      ...tlsArguments,
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
  let compressedBytes = 0;
  const plaintextCounter = new Transform({
    transform(chunk, _encoding, callback) {
      plaintextBytes += chunk.length;
      callback(null, chunk);
    },
  });
  const compressedCounter = new Transform({
    transform(chunk, _encoding, callback) {
      compressedBytes += chunk.length;
      callback(null, chunk);
    },
  });
  const gzip = createGzip({ level: zlibConstants.Z_BEST_COMPRESSION });
  const output = createWriteStream(partialPath, {
    flags: encryption.enabled ? 'a' : 'wx',
    mode: 0o600,
  });
  const cipher =
    encryption.enabled && key && initializationVector
      ? createCipheriv('aes-256-gcm', key, initializationVector)
      : null;
  const transforms = [dump.stdout, plaintextCounter, gzip, compressedCounter];
  if (cipher) transforms.push(cipher);
  transforms.push(output);
  await Promise.all([pipeline(transforms), exited]);
  if (cipher) await appendFile(partialPath, cipher.getAuthTag());
  await syncFile(partialPath);
  const partialMetadata = await stat(partialPath);
  if (plaintextBytes <= 0 || compressedBytes <= 0 || partialMetadata.size <= 0) {
    throw new Error('Backup output was empty');
  }
  const ciphertextSha256 = await sha256File(partialPath);
  await rename(partialPath, outputPath);
  const manifest = {
    formatVersion: 2,
    fileName,
    createdAt: createdAt.toISOString(),
    environment: environmentName,
    databaseName: database.database,
    mysqlVersion: databaseVersion.slice(0, 120),
    dumpToolVersion: dumpToolVersion.slice(0, 240),
    latestMigration: latestMigration.slice(0, 200),
    migrationState,
    rowCounts,
    plaintextBytes,
    compressedBytes,
    ciphertextBytes: partialMetadata.size,
    ciphertextSha256,
    compression: { algorithm: 'gzip' },
    encryption: { algorithm: encryption.algorithm, keyId },
  };
  manifest.manifestAuthentication =
    encryption.enabled && key
      ? createManifestAuthentication(manifest, key)
      : { algorithm: 'NONE', value: null };
  await writeFile(partialManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  await syncFile(partialManifestPath);
  await rename(partialManifestPath, manifestPath);
  published = true;
  const pruned = await pruneExpiredBackups({
    directory: backupDirectory,
    retentionDays,
    preserveFileNames: [fileName, path.basename(manifestPath)],
  });
  process.stdout.write(
    `${JSON.stringify({
      backup: outputPath,
      manifest: manifestPath,
      compression: 'gzip',
      encryption: encryption.algorithm,
      retentionDays,
      prunedArtifacts: pruned,
    })}\n`,
  );
} catch (error) {
  dump?.kill('SIGTERM');
  const incompleteOutputs = [
    rm(partialPath, { force: true }),
    rm(partialManifestPath, { force: true }),
  ];
  if (!published) {
    incompleteOutputs.push(rm(outputPath, { force: true }), rm(manifestPath, { force: true }));
  }
  await Promise.all(incompleteOutputs);
  throw error;
}
