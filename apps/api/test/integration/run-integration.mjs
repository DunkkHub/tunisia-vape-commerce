import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const repositoryRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const apiRoot = path.join(repositoryRoot, 'apps', 'api');
const prismaCli = path.join(repositoryRoot, 'node_modules', 'prisma', 'build', 'index.js');
const typescriptCli = path.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const tsxCli = path.join(repositoryRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const vitestCli = path.join(apiRoot, 'node_modules', 'vitest', 'vitest.mjs');

const requiredUrl = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for disposable integration tests`);
  const parsed = new URL(value);
  if (parsed.protocol !== 'mysql:' && name !== 'TEST_REDIS_URL') {
    throw new Error(`${name} must use mysql:`);
  }
  if (name === 'TEST_REDIS_URL' && !['redis:', 'rediss:'].includes(parsed.protocol)) {
    throw new Error('TEST_REDIS_URL must use redis: or rediss:');
  }
  return parsed;
};

const adminUrl = requiredUrl('TEST_DATABASE_ADMIN_URL');
const migrationSourceUrl = requiredUrl('DATABASE_MIGRATION_URL');
const runtimeSourceUrl = requiredUrl('DATABASE_URL');
const redisUrl = requiredUrl('TEST_REDIS_URL');
if (
  adminUrl.hostname !== migrationSourceUrl.hostname ||
  adminUrl.port !== migrationSourceUrl.port ||
  adminUrl.hostname !== runtimeSourceUrl.hostname ||
  adminUrl.port !== runtimeSourceUrl.port
) {
  throw new Error('Admin, migration, and runtime MySQL URLs must address the same test server');
}
if (redisUrl.pathname !== '/15') {
  throw new Error('TEST_REDIS_URL must explicitly select disposable Redis database 15');
}

const runId = `${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
const databaseName = `vape_it_${runId}`;
const redisPrefix = `vape-it:${runId}:`;
if (!/^vape_it_[a-z0-9_]+$/.test(databaseName)) throw new Error('Unsafe test database name');

const databaseUrl = (source) => {
  const target = new URL(source);
  target.pathname = `/${databaseName}`;
  return target.toString();
};
const migrationUrl = databaseUrl(migrationSourceUrl);
const runtimeUrl = databaseUrl(runtimeSourceUrl);

const prismaFor = (url) => new PrismaClient({ datasources: { db: { url: url.toString() } } });
const accountIdentity = async (url) => {
  const client = prismaFor(url);
  try {
    const rows = await client.$queryRawUnsafe('SELECT CURRENT_USER() AS identity');
    const identity = rows[0]?.identity;
    if (typeof identity !== 'string' || !/^[A-Za-z0-9._-]+@[A-Za-z0-9._%:-]+$/.test(identity)) {
      throw new Error('MySQL returned an unsafe account identity');
    }
    const separator = identity.lastIndexOf('@');
    return { user: identity.slice(0, separator), host: identity.slice(separator + 1) };
  } finally {
    await client.$disconnect();
  }
};
const quotedAccount = ({ user, host }) => `'${user}'@'${host}'`;

const execute = (file, arguments_, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, arguments_, { ...options, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${path.basename(file)} exited from signal ${signal}`));
      else resolve(code ?? 1);
    });
  });

const cleanupRedisPrefix = async () => {
  const redis = new Redis(redisUrl.toString(), {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${redisPrefix}*`, 'COUNT', 200);
      cursor = nextCursor;
      if (keys.length > 0) await redis.unlink(...keys);
    } while (cursor !== '0');
  } finally {
    redis.disconnect(false);
  }
};

const [migrationAccount, runtimeAccount] = await Promise.all([
  accountIdentity(migrationSourceUrl),
  accountIdentity(runtimeSourceUrl),
]);
if (
  migrationAccount.user === runtimeAccount.user &&
  migrationAccount.host === runtimeAccount.host
) {
  throw new Error('Migration and runtime database identities must be different');
}

const admin = prismaFor(adminUrl);
let databaseCreated = false;
let migrationGranted = false;
let runtimeGranted = false;
let testExitCode;
let cleanupError;
try {
  const workerBuildExitCode = await execute(
    process.execPath,
    [typescriptCli, '-p', path.join(repositoryRoot, 'apps', 'worker', 'tsconfig.build.json')],
    { cwd: repositoryRoot, env: { ...process.env, NODE_ENV: 'test' } },
  );
  if (workerBuildExitCode !== 0) throw new Error('Worker build for integration tests failed');

  await admin.$executeRawUnsafe(
    `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  databaseCreated = true;
  await admin.$executeRawUnsafe(
    `GRANT ALL PRIVILEGES ON \`${databaseName}\`.* TO ${quotedAccount(migrationAccount)}`,
  );
  migrationGranted = true;
  await admin.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${databaseName}\`.* TO ${quotedAccount(runtimeAccount)}`,
  );
  runtimeGranted = true;

  const migrationExitCode = await execute(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: repositoryRoot,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: migrationUrl },
  });
  if (migrationExitCode !== 0) throw new Error('Prisma migration deployment failed');

  const seedExitCode = await execute(
    process.execPath,
    [tsxCli, path.join(repositoryRoot, 'prisma', 'seed.ts')],
    {
      cwd: repositoryRoot,
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: runtimeUrl },
    },
  );
  if (seedExitCode !== 0) throw new Error('Structural seed failed');

  testExitCode = await execute(
    process.execPath,
    [vitestCli, 'run', 'test/integration', '--no-file-parallelism'],
    {
      cwd: apiRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: runtimeUrl,
        DATABASE_MIGRATION_URL: migrationUrl,
        REDIS_URL: redisUrl.toString(),
        TEST_REDIS_PREFIX: redisPrefix,
        INTEGRATION_DATABASE_NAME: databaseName,
      },
    },
  );
} finally {
  const cleanupFailures = [];
  await cleanupRedisPrefix().catch((error) => cleanupFailures.push(error));
  if (runtimeGranted) {
    await admin
      .$executeRawUnsafe(
        `REVOKE SELECT, INSERT, UPDATE, DELETE ON \`${databaseName}\`.* FROM ${quotedAccount(runtimeAccount)}`,
      )
      .catch((error) => cleanupFailures.push(error));
  }
  if (migrationGranted) {
    await admin
      .$executeRawUnsafe(
        `REVOKE ALL PRIVILEGES ON \`${databaseName}\`.* FROM ${quotedAccount(migrationAccount)}`,
      )
      .catch((error) => cleanupFailures.push(error));
  }
  if (databaseCreated) {
    await admin
      .$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${databaseName}\``)
      .catch((error) => cleanupFailures.push(error));
  }
  await admin.$disconnect();
  if (cleanupFailures.length > 0) {
    cleanupError = new Error(
      `Disposable integration cleanup failed (${cleanupFailures.length} operation(s))`,
      { cause: cleanupFailures[0] },
    );
  }
}

if (cleanupError) throw cleanupError;
process.exitCode = testExitCode;
