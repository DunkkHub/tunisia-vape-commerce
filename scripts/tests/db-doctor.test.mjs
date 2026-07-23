import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  evaluateServerVersion,
  parseDoctorArguments,
  redactDatabaseUrl,
  redactSensitiveText,
  runDatabaseDoctor,
} from '../db-doctor.mjs';

const secretUrl =
  'mysql://app_user:p%40ss%3Awith%2Fcharacters@127.0.0.1:13306/vape_store?sslaccept=strict';

function successfulPrisma(serverVersion = '8.4.10', versionComment = 'MySQL Community Server') {
  return {
    async $connect() {},
    async $disconnect() {},
    async $queryRawUnsafe(query) {
      if (query.includes('SELECT 1 AS value')) return [{ value: 1 }];
      if (query.includes('VERSION() AS serverVersion')) {
        return [
          {
            characterSet: 'utf8mb4',
            collation: 'utf8mb4_0900_ai_ci',
            currentUser: 'app_user@%',
            databaseName: 'vape_store',
            serverVersion,
            timeZone: '+00:00',
            versionComment,
          },
        ];
      }
      if (query.includes('information_schema.USER_PRIVILEGES')) {
        return ['DELETE', 'INSERT', 'SELECT', 'UPDATE'].map((privilegeType) => ({
          privilegeType,
          scope: 'SCHEMA',
        }));
      }
      if (query.includes('FROM _prisma_migrations')) {
        return [
          {
            finishedAt: new Date('2026-07-12T00:00:00.000Z'),
            migrationName: '20260712031500_initial',
            rolledBackAt: null,
          },
        ];
      }
      throw new Error(`Unexpected query: ${query}`);
    },
  };
}

const dependencies = (prisma = successfulPrisma()) => ({
  createPrisma: () => prisma,
  lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  migrationDirectories: async () => ['20260712031500_initial'],
  tcpProbe: async () => ({ latencyMilliseconds: 1 }),
});

test('database URL and errors redact encoded and decoded passwords', () => {
  const redacted = redactDatabaseUrl(secretUrl);
  assert.equal(
    redacted,
    'mysql://app_user:[REDACTED]@127.0.0.1:13306/vape_store?[parameters-redacted]',
  );
  const safeError = redactSensitiveText(
    `failed for ${secretUrl}; password=p@ss:with/characters`,
    secretUrl,
  );
  assert.doesNotMatch(safeError, /p%40ss|p@ss|characters/u);
  assert.match(safeError, /\[REDACTED\]/u);
});

test('argument parser accepts safe configuration flags and rejects unsafe shapes', () => {
  assert.deepEqual(
    parseDoctorArguments([
      '--url-env',
      'DATABASE_MIGRATION_URL',
      '--role',
      'migration',
      '--expect-user',
      'migration_user',
      '--timeout-ms',
      '7500',
      '--json',
    ]),
    {
      expectUser: 'migration_user',
      help: false,
      json: true,
      role: 'migration',
      schemaPath: 'prisma/schema.prisma',
      timeoutMilliseconds: 7500,
      urlEnvironmentName: 'DATABASE_MIGRATION_URL',
    },
  );
  assert.throws(() => parseDoctorArguments(['--url-env', 'BAD-NAME']), /environment-variable/u);
  assert.throws(() => parseDoctorArguments(['--role', 'root']), /runtime or migration/u);
  assert.throws(() => parseDoctorArguments(['mysql://user:secret@host/db']), /Unknown option/u);
});

test('version policy accepts MySQL 8.4 and rejects older MySQL and MariaDB', () => {
  assert.equal(evaluateServerVersion('8.4.10', 'MySQL Community Server').ok, true);
  assert.equal(evaluateServerVersion('8.0.44', 'MySQL Community Server').ok, false);
  const maria = evaluateServerVersion('10.4.32-MariaDB', 'mariadb.org binary distribution');
  assert.equal(maria.ok, false);
  assert.equal(maria.engine, 'MariaDB');
  assert.match(maria.message, /not a supported release target/u);
});

test('doctor completes every read-only check without returning a credential', async () => {
  const result = await runDatabaseDoctor(
    {
      databaseUrl: secretUrl,
      expectUser: 'app_user',
      role: 'runtime',
      schemaPath: 'prisma/schema.prisma',
      timeoutMilliseconds: 5_000,
    },
    dependencies(),
  );
  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.deepEqual(
    result.checks.map((entry) => entry.name),
    [
      'url',
      'dns',
      'tcp',
      'authentication',
      'prisma',
      'database',
      'version',
      'identity',
      'privileges',
      'migrations',
    ],
  );
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /p%40ss|p@ss|with%2Fcharacters/u);
  assert.match(serialized, /\[REDACTED\]/u);
});

test('MariaDB makes the doctor fail explicitly while remaining fully redacted', async () => {
  const result = await runDatabaseDoctor(
    {
      databaseUrl: secretUrl,
      role: 'runtime',
      schemaPath: 'prisma/schema.prisma',
      timeoutMilliseconds: 5_000,
    },
    dependencies(successfulPrisma('10.4.32-MariaDB', 'mariadb.org binary distribution')),
  );
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((entry) => entry.name === 'version')?.status, 'fail');
  assert.match(result.checks.find((entry) => entry.name === 'version')?.message ?? '', /MariaDB/u);
  assert.doesNotMatch(JSON.stringify(result), /p%40ss|p@ss/u);
});

test('doctor implementation contains no mutation query', async () => {
  const source = await readFile(new URL('../db-doctor.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(
    source,
    /\$executeRaw|\bCREATE\s+TABLE\b|\bDROP\s+TABLE\b|\bALTER\s+TABLE\b/iu,
  );
});
