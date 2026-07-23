import { lookup } from 'node:dns/promises';
import { readdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

const DEFAULT_SCHEMA = 'prisma/schema.prisma';
const DEFAULT_TIMEOUT_MS = 5_000;
const REQUIRED_RUNTIME_PRIVILEGES = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'];
const REQUIRED_MIGRATION_PRIVILEGES = ['ALTER', 'CREATE', 'DROP', 'INDEX', 'REFERENCES'];
const DDL_PRIVILEGES = new Set([
  'ALTER',
  'ALTER ROUTINE',
  'CREATE',
  'CREATE ROUTINE',
  'CREATE TEMPORARY TABLES',
  'CREATE VIEW',
  'DROP',
  'EVENT',
  'INDEX',
  'REFERENCES',
  'TRIGGER',
]);

const HELP = `Usage: pnpm db:doctor -- [options]

Runs read-only DNS, TCP, authentication, database, MySQL-version, Prisma,
least-privilege, and migration checks. Credentials are never printed.

Options:
  --url-env <name>       Environment variable containing the MySQL URL
                         (default: DATABASE_URL)
  --schema <path>        Prisma schema path (default: prisma/schema.prisma)
  --role <role>          Expected identity role: runtime or migration
                         (default: runtime)
  --expect-user <name>   Require the authenticated MySQL username to match
  --timeout-ms <number>  DNS/TCP timeout in milliseconds (default: 5000)
  --json                 Emit a machine-readable JSON result
  --help                 Show this help

Examples:
  pnpm db:doctor
  pnpm db:doctor -- --url-env DATABASE_MIGRATION_URL --role migration
  pnpm db:doctor -- --expect-user app_user --json

Do not pass a database URL on the command line. Put it in an environment
variable so its password is not retained in shell history or process listings.
`;

export function parseDoctorArguments(argv) {
  const options = {
    expectUser: undefined,
    help: false,
    json: false,
    role: 'runtime',
    schemaPath: DEFAULT_SCHEMA,
    timeoutMilliseconds: DEFAULT_TIMEOUT_MS,
    urlEnvironmentName: 'DATABASE_URL',
  };

  const valueAfter = (index, option) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--url-env') {
      options.urlEnvironmentName = valueAfter(index, argument);
      index += 1;
    } else if (argument === '--schema') {
      options.schemaPath = valueAfter(index, argument);
      index += 1;
    } else if (argument === '--role') {
      options.role = valueAfter(index, argument);
      index += 1;
    } else if (argument === '--expect-user') {
      options.expectUser = valueAfter(index, argument);
      index += 1;
    } else if (argument === '--timeout-ms') {
      options.timeoutMilliseconds = Number(valueAfter(index, argument));
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.urlEnvironmentName)) {
    throw new Error('--url-env must be an environment-variable name');
  }
  if (!['runtime', 'migration'].includes(options.role)) {
    throw new Error('--role must be runtime or migration');
  }
  if (
    !Number.isInteger(options.timeoutMilliseconds) ||
    options.timeoutMilliseconds < 100 ||
    options.timeoutMilliseconds > 60_000
  ) {
    throw new Error('--timeout-ms must be an integer between 100 and 60000');
  }
  if (options.expectUser !== undefined && !options.expectUser.trim()) {
    throw new Error('--expect-user must not be empty');
  }
  return options;
}

export function redactDatabaseUrl(value) {
  try {
    const parsed = new URL(value);
    const username = parsed.username || '[user]';
    const queryMarker = parsed.search ? '?[parameters-redacted]' : '';
    return `${parsed.protocol}//${username}:[REDACTED]@${parsed.host}${parsed.pathname}${queryMarker}`;
  } catch {
    return '[INVALID_DATABASE_URL_REDACTED]';
  }
}

export function redactSensitiveText(value, databaseUrl) {
  let safe = String(value ?? '');
  if (databaseUrl) {
    const redactedUrl = redactDatabaseUrl(databaseUrl);
    safe = safe.split(databaseUrl).join(redactedUrl);
    try {
      const parsed = new URL(databaseUrl);
      const passwordCandidates = new Set([
        parsed.password,
        decodeURIComponent(parsed.password),
        encodeURIComponent(decodeURIComponent(parsed.password)),
      ]);
      for (const candidate of passwordCandidates) {
        if (candidate) safe = safe.split(candidate).join('[REDACTED]');
      }
    } catch {
      // The invalid URL itself was already replaced above. Generic URL redaction below is a fallback.
    }
  }
  return safe.replace(/mysql:\/\/([^\s:/@]+):([^\s@]+)@/giu, 'mysql://$1:[REDACTED]@');
}

export function evaluateServerVersion(serverVersion, versionComment = '') {
  const version = String(serverVersion ?? '');
  const comment = String(versionComment ?? '');
  if (/mariadb/iu.test(`${version} ${comment}`)) {
    return {
      engine: 'MariaDB',
      ok: false,
      version,
      message: `MariaDB ${version || '(unknown version)'} is not a supported release target; MySQL 8.4 or newer is required.`,
    };
  }

  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/u.exec(version);
  if (!match) {
    return {
      engine: 'Unknown',
      ok: false,
      version,
      message: `Could not parse MySQL server version ${version || '(empty)'}.`,
    };
  }
  const [, majorText, minorText, patchText = '0'] = match;
  const parts = [Number(majorText), Number(minorText), Number(patchText)];
  const ok = parts[0] > 8 || (parts[0] === 8 && parts[1] >= 4);
  return {
    engine: 'MySQL',
    ok,
    version,
    message: ok
      ? `MySQL ${version} meets the minimum supported version (8.4).`
      : `MySQL ${version} is too old; MySQL 8.4 or newer is required.`,
  };
}

function parseDatabaseTarget(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch (error) {
    throw new Error('The selected database URL is not a valid URL.', { cause: error });
  }
  if (parsed.protocol !== 'mysql:') throw new Error('The database URL must use mysql://.');
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!parsed.hostname) throw new Error('The database URL must include a host.');
  if (!username) throw new Error('The database URL must include a dedicated username.');
  if (username.toLocaleLowerCase('en-US') === 'root') {
    throw new Error('The application database URL must not use the MySQL root account.');
  }
  if (!password) throw new Error('The dedicated database account must have a non-empty password.');
  if (!databaseName || databaseName.includes('/')) {
    throw new Error('The database URL must identify exactly one database.');
  }
  return {
    databaseName,
    databaseUrl,
    host: parsed.hostname.replace(/^\[|\]$/gu, ''),
    password,
    port: parsed.port ? Number(parsed.port) : 3306,
    redactedUrl: redactDatabaseUrl(databaseUrl),
    username,
  };
}

function errorDetails(error, databaseUrl) {
  const source = error instanceof Error ? error : new Error(String(error));
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
  return {
    ...(code ? { code } : {}),
    message: redactSensitiveText(source.message, databaseUrl),
    name: source.name,
  };
}

function tcpProbe(host, port, timeoutMilliseconds) {
  return new Promise((resolvePromise, reject) => {
    const startedAt = Date.now();
    const socket = createConnection({ host, port });
    const finish = (error) => {
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else resolvePromise({ latencyMilliseconds: Date.now() - startedAt });
    };
    socket.setTimeout(timeoutMilliseconds, () => finish(new Error('TCP connection timed out.')));
    socket.once('connect', () => finish());
    socket.once('error', finish);
  });
}

function withTimeout(promise, timeoutMilliseconds, message) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMilliseconds);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timeout));
}

async function migrationDirectories(schemaPath) {
  const migrationsPath = resolve(dirname(resolve(schemaPath)), 'migrations');
  const entries = await readdir(migrationsPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^\d+_/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function createDefaultPrisma(databaseUrl) {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

function check(result, name, status, message, details) {
  result.checks.push({ name, status, message, ...(details === undefined ? {} : { details }) });
}

function privilegesByScope(rows) {
  const grouped = { global: new Set(), schema: new Set(), table: new Set() };
  for (const row of rows) {
    const scope = String(row.scope ?? '').toLocaleLowerCase('en-US');
    if (!(scope in grouped)) continue;
    grouped[scope].add(String(row.privilegeType ?? '').toLocaleUpperCase('en-US'));
  }
  return Object.fromEntries(
    Object.entries(grouped).map(([scope, privileges]) => [scope, [...privileges].sort()]),
  );
}

function effectivePrivileges(grouped) {
  return new Set([...grouped.global, ...grouped.schema, ...grouped.table]);
}

function migrationState(expectedNames, rows) {
  const applied = new Set();
  const failed = new Set();
  for (const row of rows) {
    const name = String(row.migrationName);
    if (row.finishedAt && !row.rolledBackAt) applied.add(name);
    if (!row.finishedAt && !row.rolledBackAt) failed.add(name);
  }
  return {
    applied: [...applied].sort(),
    failed: [...failed].sort(),
    pending: expectedNames.filter((name) => !applied.has(name)),
    unknown: [...applied].filter((name) => !expectedNames.includes(name)).sort(),
  };
}

export async function runDatabaseDoctor(options, dependencies = {}) {
  const result = {
    checks: [],
    ok: false,
    readOnly: true,
    role: options.role,
    target: '[UNAVAILABLE]',
  };
  const databaseUrl = options.databaseUrl;
  let target;
  try {
    target = parseDatabaseTarget(databaseUrl);
    result.target = target.redactedUrl;
    check(result, 'url', 'pass', 'The MySQL URL is structurally valid and redacted.');
  } catch (error) {
    result.target = redactDatabaseUrl(databaseUrl);
    check(result, 'url', 'fail', errorDetails(error, databaseUrl).message);
    return result;
  }

  const dnsLookup = dependencies.lookup ?? lookup;
  try {
    const addresses = await withTimeout(
      dnsLookup(target.host, { all: true }),
      options.timeoutMilliseconds,
      'DNS resolution timed out.',
    );
    const families = [...new Set(addresses.map((address) => `IPv${address.family}`))];
    check(result, 'dns', 'pass', `Resolved ${target.host}.`, {
      addressCount: addresses.length,
      families,
    });
  } catch (error) {
    check(result, 'dns', 'fail', 'Host resolution failed.', errorDetails(error, databaseUrl));
  }

  const probe = dependencies.tcpProbe ?? tcpProbe;
  try {
    const details = await probe(target.host, target.port, options.timeoutMilliseconds);
    check(result, 'tcp', 'pass', `Connected to ${target.host}:${target.port}.`, details);
  } catch (error) {
    check(
      result,
      'tcp',
      'fail',
      `Could not connect to ${target.host}:${target.port}.`,
      errorDetails(error, databaseUrl),
    );
  }

  const prisma = (dependencies.createPrisma ?? createDefaultPrisma)(databaseUrl);
  let authenticated = false;
  try {
    await prisma.$connect();
    authenticated = true;
    check(result, 'authentication', 'pass', 'The dedicated database account authenticated.');
  } catch (error) {
    check(
      result,
      'authentication',
      'fail',
      'Database authentication failed.',
      errorDetails(error, databaseUrl),
    );
  }

  if (authenticated) {
    try {
      const rows = await prisma.$queryRawUnsafe('SELECT 1 AS value');
      const value = Number(rows[0]?.value);
      if (value !== 1) throw new Error('The Prisma read probe returned an unexpected value.');
      check(result, 'prisma', 'pass', 'Prisma completed a read-only query.');
    } catch (error) {
      check(
        result,
        'prisma',
        'fail',
        'Prisma read probe failed.',
        errorDetails(error, databaseUrl),
      );
    }

    let server;
    try {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT
          VERSION() AS serverVersion,
          @@version_comment AS versionComment,
          CURRENT_USER() AS currentUser,
          DATABASE() AS databaseName,
          @@character_set_database AS characterSet,
          @@collation_database AS collation,
          @@time_zone AS timeZone
      `);
      server = rows[0];
      if (!server) throw new Error('The server identity query returned no row.');
      const selectedDatabase = String(server.databaseName ?? '');
      check(
        result,
        'database',
        selectedDatabase === target.databaseName ? 'pass' : 'fail',
        selectedDatabase === target.databaseName
          ? `Selected database ${selectedDatabase}.`
          : `Expected database ${target.databaseName}, but the server selected ${selectedDatabase || '(none)'}.`,
        {
          characterSet: String(server.characterSet ?? ''),
          collation: String(server.collation ?? ''),
          timeZone: String(server.timeZone ?? ''),
        },
      );

      const version = evaluateServerVersion(server.serverVersion, server.versionComment);
      check(result, 'version', version.ok ? 'pass' : 'fail', version.message, {
        engine: version.engine,
        version: version.version,
      });

      const currentUser = String(server.currentUser ?? '');
      const authenticatedUsername = currentUser.split('@', 1)[0];
      const expectedUsername = options.expectUser?.trim();
      const identityMatchesUrl = authenticatedUsername === target.username;
      const identityMatchesExpectation =
        expectedUsername === undefined || authenticatedUsername === expectedUsername;
      const identitySafe =
        identityMatchesUrl &&
        identityMatchesExpectation &&
        authenticatedUsername.toLocaleLowerCase('en-US') !== 'root';
      check(
        result,
        'identity',
        identitySafe ? 'pass' : 'fail',
        identitySafe
          ? `Authenticated as ${currentUser}.`
          : 'The authenticated database identity does not match the required dedicated account.',
        {
          actual: currentUser,
          expected: expectedUsername ?? target.username,
        },
      );
    } catch (error) {
      check(
        result,
        'server',
        'fail',
        'Server identity/version query failed.',
        errorDetails(error, databaseUrl),
      );
    }

    try {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT 'GLOBAL' AS scope, PRIVILEGE_TYPE AS privilegeType
        FROM information_schema.USER_PRIVILEGES
        WHERE GRANTEE = CONCAT(
          QUOTE(SUBSTRING_INDEX(CURRENT_USER(), '@', 1)),
          '@',
          QUOTE(SUBSTRING_INDEX(CURRENT_USER(), '@', -1))
        )
        UNION ALL
        SELECT 'SCHEMA' AS scope, PRIVILEGE_TYPE AS privilegeType
        FROM information_schema.SCHEMA_PRIVILEGES
        WHERE GRANTEE = CONCAT(
          QUOTE(SUBSTRING_INDEX(CURRENT_USER(), '@', 1)),
          '@',
          QUOTE(SUBSTRING_INDEX(CURRENT_USER(), '@', -1))
        ) AND TABLE_SCHEMA = DATABASE()
        UNION ALL
        SELECT 'TABLE' AS scope, PRIVILEGE_TYPE AS privilegeType
        FROM information_schema.TABLE_PRIVILEGES
        WHERE GRANTEE = CONCAT(
          QUOTE(SUBSTRING_INDEX(CURRENT_USER(), '@', 1)),
          '@',
          QUOTE(SUBSTRING_INDEX(CURRENT_USER(), '@', -1))
        ) AND TABLE_SCHEMA = DATABASE()
      `);
      const grouped = privilegesByScope(rows);
      const effective = effectivePrivileges(grouped);
      const required =
        options.role === 'migration' ? REQUIRED_MIGRATION_PRIVILEGES : REQUIRED_RUNTIME_PRIVILEGES;
      const missing = required.filter((privilege) => !effective.has(privilege));
      const forbidden =
        options.role === 'runtime'
          ? [...effective].filter((privilege) => DDL_PRIVILEGES.has(privilege)).sort()
          : [];
      const safe = missing.length === 0 && forbidden.length === 0;
      check(
        result,
        'privileges',
        safe ? 'pass' : 'fail',
        safe
          ? `${options.role} database privileges match the expected boundary.`
          : 'Database privileges do not match the expected role.',
        { byScope: grouped, forbidden, missing },
      );
    } catch (error) {
      check(
        result,
        'privileges',
        'fail',
        'Could not inspect database privileges.',
        errorDetails(error, databaseUrl),
      );
    }

    try {
      const expectedNames = await (dependencies.migrationDirectories ?? migrationDirectories)(
        options.schemaPath,
      );
      const rows = await prisma.$queryRawUnsafe(`
        SELECT
          migration_name AS migrationName,
          finished_at AS finishedAt,
          rolled_back_at AS rolledBackAt
        FROM _prisma_migrations
        ORDER BY started_at
      `);
      const state = migrationState(expectedNames, rows);
      const current =
        state.pending.length === 0 && state.failed.length === 0 && state.unknown.length === 0;
      check(
        result,
        'migrations',
        current ? 'pass' : 'fail',
        current
          ? `Database schema is current (${state.applied.length}/${expectedNames.length} migrations).`
          : 'Database migration state does not match the repository.',
        {
          appliedCount: state.applied.length,
          expectedCount: expectedNames.length,
          failed: state.failed,
          pending: state.pending,
          unknown: state.unknown,
        },
      );
    } catch (error) {
      check(
        result,
        'migrations',
        'fail',
        'Could not verify the Prisma migration table.',
        errorDetails(error, databaseUrl),
      );
    }
  }

  try {
    await prisma.$disconnect();
  } catch (error) {
    check(
      result,
      'disconnect',
      'fail',
      'Prisma did not disconnect cleanly.',
      errorDetails(error, databaseUrl),
    );
  }
  result.ok = !result.checks.some((entry) => entry.status === 'fail');
  return result;
}

function printHumanResult(result) {
  process.stdout.write('Database doctor (read-only)\n');
  process.stdout.write(`Target: ${result.target}\n`);
  process.stdout.write(`Expected role: ${result.role}\n`);
  for (const entry of result.checks) {
    const marker = entry.status === 'pass' ? 'PASS' : entry.status === 'warn' ? 'WARN' : 'FAIL';
    process.stdout.write(`${marker} ${entry.name}: ${entry.message}\n`);
    if (entry.details !== undefined) {
      process.stdout.write(`     ${JSON.stringify(entry.details)}\n`);
    }
  }
  process.stdout.write(`Result: ${result.ok ? 'healthy' : 'failed'}\n`);
}

async function main() {
  let options;
  try {
    options = parseDoctorArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${redactSensitiveText(error.message)}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  try {
    process.loadEnvFile?.(resolve('.env'));
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      process.stderr.write(`Could not load .env: ${redactSensitiveText(error.message)}\n`);
      process.exitCode = 2;
      return;
    }
  }

  const databaseUrl = process.env[options.urlEnvironmentName];
  if (!databaseUrl) {
    process.stderr.write(
      `${options.urlEnvironmentName} is required. Set it in the environment or an untracked .env file.\n`,
    );
    process.exitCode = 2;
    return;
  }
  let result;
  try {
    result = await runDatabaseDoctor({ ...options, databaseUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `Database doctor could not complete: ${redactSensitiveText(message, databaseUrl)}\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else printHumanResult(result);
  if (!result.ok) process.exitCode = 1;
}

const directExecutionUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === directExecutionUrl) {
  await main();
}
