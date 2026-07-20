import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  assertRegularFile,
  assertUnencryptedRestoreAllowed,
  decodeEncryptionKey,
  mysqlClientEnvironment,
  mysqlTlsArguments,
  parseMysqlUrl,
  prepareSafeDirectory,
  safeChildPath,
  sha256File,
  validateManifest,
  verifyManifestAuthentication,
} from './lib/backup-format.mjs';
import {
  assertGeneratedDrillDatabaseName,
  assertGeneratedDrillUserName,
  assertIsolatedDrillTarget,
  createDrillDatabaseName,
  createDrillUserName,
  databaseUrlForName,
  parseRestoreDrillArguments,
  restoreDrillUsage,
} from './lib/restore-drill.mjs';

const parsedArguments = parseRestoreDrillArguments(process.argv.slice(2));
if (parsedArguments.help) {
  process.stdout.write(`${restoreDrillUsage}\n`);
  process.exit(0);
}

if (!process.env.EXPECTED_MIGRATION_NAME) {
  throw new Error('EXPECTED_MIGRATION_NAME is required for a restore drill');
}
const keepDatabase =
  parsedArguments.keepDatabase && process.env.RESTORE_DRILL_KEEP_DATABASE === 'true';
if (parsedArguments.keepDatabase && !keepDatabase) {
  throw new Error('Keeping the isolated database also requires RESTORE_DRILL_KEEP_DATABASE=true');
}

const backupPath = path.resolve(parsedArguments.backupPath);
const manifestPath = `${backupPath}.manifest.json`;
const [backupMetadata, manifestMetadata, manifestText, checksum] = await Promise.all([
  assertRegularFile(backupPath, 'Restore drill backup'),
  assertRegularFile(manifestPath, 'Restore drill manifest'),
  readFile(manifestPath, 'utf8'),
  sha256File(backupPath),
]);
if (manifestMetadata.size > 1_000_000) throw new Error('Backup manifest is too large');
const manifest = JSON.parse(manifestText);
validateManifest(manifest, backupPath, checksum, backupMetadata.size);
if (manifest.formatVersion === 1) {
  if (process.env.RESTORE_ALLOW_LEGACY_UNSIGNED_MANIFEST !== 'true') {
    throw new Error('Legacy format-1 drill requires RESTORE_ALLOW_LEGACY_UNSIGNED_MANIFEST=true');
  }
} else if (manifest.encryption.algorithm === 'AES-256-GCM') {
  verifyManifestAuthentication(
    manifest,
    decodeEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY_BASE64),
  );
} else {
  assertUnencryptedRestoreAllowed({
    environment: manifest.environment,
    allowUnencrypted: process.env.RESTORE_ALLOW_UNENCRYPTED_BACKUP,
  });
}

const admin = parseMysqlUrl(process.env.RESTORE_DRILL_ADMIN_URL, 'RESTORE_DRILL_ADMIN_URL');
assertIsolatedDrillTarget({
  isolated: process.env.RESTORE_DRILL_TARGET_IS_ISOLATED,
  confirmedHost: process.env.RESTORE_DRILL_CONFIRM_HOST,
  actualHost: admin.hostname,
});
const databaseName = createDrillDatabaseName(process.env.RESTORE_DRILL_DATABASE_PREFIX);
assertGeneratedDrillDatabaseName(databaseName);
const drillUserName = createDrillUserName();
const drillUserPassword = randomBytes(32).toString('base64url');
const restoreUrlObject = new URL(
  databaseUrlForName(process.env.RESTORE_DRILL_ADMIN_URL, databaseName),
);
restoreUrlObject.username = drillUserName;
restoreUrlObject.password = drillUserPassword;
const restoreUrl = restoreUrlObject.toString();
const mysqlBinary = process.env.MYSQL_BIN ?? 'mysql';
const tlsArguments = mysqlTlsArguments({
  mode: process.env.MYSQL_TLS_MODE,
  caFile: process.env.MYSQL_TLS_CA_FILE,
  runtimeEnvironment: process.env.NODE_ENV,
});
const mysqlEnvironment = mysqlClientEnvironment(admin.password);
const mysqlArguments = [
  ...tlsArguments,
  `--host=${admin.hostname}`,
  `--port=${admin.port}`,
  `--user=${admin.username}`,
  '--batch',
  '--skip-column-names',
  '--raw',
  admin.database,
];
const reportDirectory = await prepareSafeDirectory(
  process.env.RESTORE_DRILL_REPORT_DIRECTORY ??
    path.join(process.env.BACKUP_DIRECTORY ?? 'backups', 'restore-drill-reports'),
  'RESTORE_DRILL_REPORT_DIRECTORY',
);

const run = (file, arguments_, environment, stdio = ['ignore', 'ignore', 'ignore'], input = null) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, arguments_, { env: environment, stdio });
    if (input !== null) child.stdin.end(input);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error('Restore drill subprocess was terminated'));
      else if (code === 0) resolve();
      else reject(new Error('Restore drill subprocess failed'));
    });
  });

const executeMysql = (query) =>
  run(mysqlBinary, mysqlArguments, mysqlEnvironment, ['pipe', 'ignore', 'ignore'], `${query};\n`);

const startedAt = new Date();
let phase = 'create-isolated-database';
let databaseCreated = false;
let databaseRemoved = false;
let drillUserCreated = false;
let drillUserRemoved = false;
let failure = null;
let restoreStartedAt = null;
let restoreFinishedAt = null;

try {
  await executeMysql(
    `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  );
  databaseCreated = true;
  phase = 'create-scoped-restore-identity';
  assertGeneratedDrillUserName(drillUserName);
  await executeMysql(`CREATE USER '${drillUserName}'@'%' IDENTIFIED BY '${drillUserPassword}'`);
  drillUserCreated = true;
  await executeMysql(`GRANT ALL PRIVILEGES ON \`${databaseName}\`.* TO '${drillUserName}'@'%'`);
  phase = 'restore-and-verify';
  restoreStartedAt = new Date();
  try {
    await run(
      process.execPath,
      [
        fileURLToPath(new URL('./restore-mysql.mjs', import.meta.url)),
        backupPath,
        '--confirm-empty-disposable-database',
      ],
      {
        ...process.env,
        DATABASE_RESTORE_URL: restoreUrl,
        RESTORE_TARGET_IS_DISPOSABLE: 'true',
        RESTORE_CONFIRM_DATABASE: databaseName,
      },
      'inherit',
    );
  } finally {
    restoreFinishedAt = new Date();
  }
} catch {
  failure = phase;
} finally {
  if (databaseCreated) {
    phase = 'drop-scoped-restore-identity';
    try {
      assertGeneratedDrillUserName(drillUserName);
      await executeMysql(`DROP USER IF EXISTS '${drillUserName}'@'%'`);
      drillUserRemoved = true;
    } catch {
      failure ??= phase;
    }
  }
  if (databaseCreated && (!keepDatabase || failure)) {
    phase = 'drop-isolated-database';
    try {
      assertGeneratedDrillDatabaseName(databaseName);
      await executeMysql(`DROP DATABASE \`${databaseName}\``);
      databaseRemoved = true;
    } catch {
      failure ??= phase;
    }
  }
}

const finishedAt = new Date();
const totalDrillDurationSeconds = Number(
  ((finishedAt.getTime() - startedAt.getTime()) / 1_000).toFixed(3),
);
const restoreVerificationDurationSeconds =
  restoreStartedAt && restoreFinishedAt
    ? Number(((restoreFinishedAt.getTime() - restoreStartedAt.getTime()) / 1_000).toFixed(3))
    : null;
const backupAgeAtStartSeconds = Math.max(
  0,
  Number(((startedAt.getTime() - Date.parse(manifest.createdAt)) / 1_000).toFixed(3)),
);
const report = {
  formatVersion: 1,
  drillId: randomBytes(8).toString('hex'),
  status: failure ? 'failed' : 'verified',
  failurePhase: failure,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  totalDrillDurationSeconds,
  restoreVerificationDurationSeconds,
  backupAgeAtDrillStartSeconds: backupAgeAtStartSeconds,
  source: {
    fileName: manifest.fileName,
    createdAt: manifest.createdAt,
    environment: manifest.environment,
    checksumSha256: manifest.ciphertextSha256,
    latestMigration: manifest.latestMigration,
  },
  target: {
    databaseName,
    isolatedDatabaseCreated: databaseCreated,
    databaseRemoved,
    databaseRetained: databaseCreated && !databaseRemoved,
    retentionRequested: keepDatabase,
    scopedRestoreIdentityCreated: drillUserCreated,
    scopedRestoreIdentityRemoved: drillUserRemoved,
  },
  expectedMigration: process.env.EXPECTED_MIGRATION_NAME,
  notes: [
    'Restore duration measures logical import plus database verification, not full service RTO.',
    'Backup age is an evidence input, not a measured transaction-level RPO.',
  ],
};
const reportTimestamp = finishedAt.toISOString().replaceAll(/[:.]/g, '-');
const reportFileName = `restore-drill-${reportTimestamp}-${report.drillId}.json`;
const reportPath = safeChildPath(reportDirectory, reportFileName);
const partialReportPath = `${reportPath}.partial`;
await writeFile(partialReportPath, `${JSON.stringify(report, null, 2)}\n`, {
  flag: 'wx',
  mode: 0o600,
});
await rename(partialReportPath, reportPath);
const reportSize = (await stat(reportPath)).size;

if (failure) {
  throw new Error(
    `Restore drill failed during ${failure}; report written (${String(reportSize)} bytes)`,
  );
}
process.stdout.write(
  `${JSON.stringify({ status: 'verified', report: reportPath, databaseRemoved, databaseName })}\n`,
);
