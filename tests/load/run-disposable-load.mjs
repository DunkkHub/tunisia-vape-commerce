import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { seedDisposableCommerceFixture } from './lib/disposable-commerce-fixture.mjs';
import { runLoadSuite } from './lib/load-runner.mjs';

const CONFIRMATION = 'RUN_DISPOSABLE_FULL_TARGET_LOAD';
const repositoryRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const prismaCli = path.join(repositoryRoot, 'node_modules', 'prisma', 'build', 'index.js');
const typescriptCli = path.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const tsxCli = path.join(repositoryRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const apiRoot = path.join(repositoryRoot, 'apps', 'api');
const workerRoot = path.join(repositoryRoot, 'apps', 'worker');
const requireFromApi = createRequire(path.join(apiRoot, 'package.json'));
const Redis = requireFromApi('ioredis');

if (process.env.NODE_ENV !== 'test') {
  throw new Error('Disposable load validation requires NODE_ENV=test');
}
if (process.env.DISPOSABLE_LOAD_CONFIRM !== CONFIRMATION) {
  throw new Error(`Set DISPOSABLE_LOAD_CONFIRM=${CONFIRMATION} exactly`);
}

const requiredUrl = (name, protocols) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for disposable load validation`);
  const parsed = new URL(value);
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(' or ')}`);
  }
  return parsed;
};

const adminUrl = requiredUrl('TEST_DATABASE_ADMIN_URL', ['mysql:']);
const migrationSourceUrl = requiredUrl('DATABASE_MIGRATION_URL', ['mysql:']);
const runtimeSourceUrl = requiredUrl('DATABASE_URL', ['mysql:']);
const redisUrl = requiredUrl('TEST_LOAD_REDIS_URL', ['redis:', 'rediss:']);
if (
  adminUrl.hostname !== migrationSourceUrl.hostname ||
  adminUrl.port !== migrationSourceUrl.port ||
  adminUrl.hostname !== runtimeSourceUrl.hostname ||
  adminUrl.port !== runtimeSourceUrl.port
) {
  throw new Error('All MySQL identities must address the same disposable test server');
}
if (redisUrl.pathname !== '/13') {
  throw new Error('TEST_LOAD_REDIS_URL must explicitly select disposable Redis database 13');
}

const configuredPort = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 65_535) {
    throw new Error(`${name} must be a non-privileged TCP port`);
  }
  return value;
};
const apiPort = configuredPort('DISPOSABLE_LOAD_API_PORT', 3102);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

const runId = `${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
const databaseName = `vape_load_${runId}`;
if (!/^vape_load_[a-z0-9_]+$/.test(databaseName)) throw new Error('Unsafe load database name');

const databaseUrl = (source) => {
  const target = new URL(source);
  target.pathname = `/${databaseName}`;
  return target.toString();
};
const migrationUrl = databaseUrl(migrationSourceUrl);
const runtimeUrl = databaseUrl(runtimeSourceUrl);
const pooledRuntimeUrl = (connectionLimit) => {
  const target = new URL(runtimeUrl);
  target.searchParams.set('connection_limit', String(connectionLimit));
  target.searchParams.set('pool_timeout', '30');
  return target.toString();
};
const apiRuntimeUrl = pooledRuntimeUrl(60);
const workerRuntimeUrl = pooledRuntimeUrl(10);
const cookieSecret = `load-cookie-${randomBytes(32).toString('base64url')}`;
const fieldEncryptionKey = `load-field-${randomBytes(32).toString('base64url')}`;
const queueName = `durable-outbox-load-${createHash('sha256').update(runId).digest('hex').slice(0, 16)}`;

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

const executeOrThrow = async (label, file, arguments_, options) => {
  const code = await execute(file, arguments_, options);
  if (code !== 0) throw new Error(`${label} failed with exit code ${code}`);
};

const startProcess = (label, file, arguments_, options) => {
  const child = spawn(file, arguments_, { ...options, stdio: 'inherit' });
  child.once('error', (error) => console.error(`${label} failed to start`, error));
  return { label, child };
};

const stopProcess = async ({ child }) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!stopped && child.exitCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
};

const waitForUrl = async (label, url, child, timeoutMilliseconds = 60_000) => {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become available at ${url}`, { cause: lastError });
};

const flushRedis = async () => {
  const redis = new Redis(redisUrl.toString(), {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    redis.disconnect(false);
  }
};

const SOURCE_HEADER = 'x-disposable-load-source';
const SOURCE_POOLS = new Map([
  ['catalog', 20],
  ['checkout', 30],
  ['race', 40],
  ['repeated', 50],
  ['admin', 60],
  ['metrics', 70],
  ['backlog', 80],
]);

const createLoopbackFetch = () => {
  const counters = new Map();
  const agents = new Map();
  const usedAddresses = new Set();
  const sourceAddress = (marker) => {
    const match = /^pool:([a-z]+):(\d{1,3})$/.exec(marker);
    if (!match) throw new Error('A disposable load request has an invalid source pool marker');
    const [, pool, rawSize] = match;
    const octet = SOURCE_POOLS.get(pool);
    const size = Number(rawSize);
    if (!octet || !Number.isSafeInteger(size) || size < 1 || size > 200) {
      throw new Error('A disposable load request selected an unsafe source pool');
    }
    const index = counters.get(pool) ?? 0;
    counters.set(pool, index + 1);
    return `127.${octet}.0.${(index % size) + 1}`;
  };
  const fetchImplementation = (url, options = {}) =>
    new Promise((resolve, reject) => {
      const target = url instanceof URL ? url : new URL(url);
      if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') {
        reject(new Error('Disposable loopback fetch can only call the local HTTP API'));
        return;
      }
      const headers = new Headers(options.headers);
      const marker = headers.get(SOURCE_HEADER);
      if (!marker) {
        reject(new Error('Every disposable load request must select a source pool'));
        return;
      }
      headers.delete(SOURCE_HEADER);
      const localAddress = sourceAddress(marker);
      usedAddresses.add(localAddress);
      let agent = agents.get(localAddress);
      if (!agent) {
        agent = new HttpAgent({ keepAlive: true, maxSockets: 8, localAddress });
        agents.set(localAddress, agent);
      }
      const request = httpRequest(target, {
        method: options.method ?? 'GET',
        headers: Object.fromEntries(headers.entries()),
        agent,
        localAddress,
        signal: options.signal,
      });
      request.once('error', reject);
      request.once('response', (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.once('error', reject);
        response.once('end', () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
            else if (value !== undefined) responseHeaders.set(name, String(value));
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              statusText: response.statusMessage,
              headers: responseHeaders,
            }),
          );
        });
      });
      if (options.body !== undefined) request.write(options.body);
      request.end();
    });
  return {
    fetchImplementation,
    addressCount: () => usedAddresses.size,
    close: () => agents.forEach((agent) => agent.destroy()),
  };
};

const checkoutDescriptor = (actor, idempotencyKey, pool, size) => ({
  method: 'POST',
  path: '/api/v1/checkout/orders',
  headers: { ...actor.headers, [SOURCE_HEADER]: `pool:${pool}:${size}` },
  idempotencyKey,
  body: actor.body,
  responseIdentityPath: 'data.id',
});

const createLoadFixture = (fixture) => ({
  version: 1,
  baseUrl: apiBaseUrl,
  scale: 1,
  defaults: { timeoutMs: 30_000, maxErrorRate: 0 },
  scenarios: {
    catalogBrowsing: {
      enabled: true,
      concurrency: 100,
      requests: [
        '/api/v1/products?page=1&pageSize=20&sort=newest',
        '/api/v1/products?page=1&pageSize=20&sort=price_asc',
        '/api/v1/products?page=1&pageSize=20&sort=price_desc',
        '/api/v1/products?page=1&pageSize=20&sort=name_asc',
        '/api/v1/products?page=1&pageSize=20&brand=puffjet-load',
        '/api/v1/products?page=1&pageSize=20&productType=DISPOSABLE',
        '/api/v1/products?page=1&pageSize=20&flavor=Mint%20load',
        '/api/v1/products?page=1&pageSize=20&minPriceMillimes=5000',
        '/api/v1/products?page=1&pageSize=20&maxPriceMillimes=20000',
        '/api/v1/products?page=1&pageSize=20&featured=true',
      ].map((requestPath) => ({
        method: 'GET',
        path: requestPath,
        headers: { [SOURCE_HEADER]: 'pool:catalog:100', 'Accept-Language': 'fr' },
      })),
    },
    checkoutAttempts: {
      enabled: true,
      concurrency: 50,
      actors: fixture.checkoutActors.map((actor, index) =>
        checkoutDescriptor(actor, `load-checkout-${runId}-${index + 1}`, 'checkout', 50),
      ),
      expectedStatuses: [201],
      responseIdentityPath: 'data.id',
    },
    finalUnitRace: {
      enabled: true,
      actors: fixture.raceActors.map((actor, index) =>
        checkoutDescriptor(actor, `load-race-${runId}-${index + 1}`, 'race', 2),
      ),
      successStatuses: [201],
      loserStatuses: [409],
      loserErrorCodes: ['OUT_OF_STOCK'],
      expectedWinners: 1,
      verification: {
        method: 'GET',
        path: '/api/v1/admin/inventory?q=LOAD-FINAL-UNIT-V1&page=1&limit=1',
        headers: { ...fixture.adminHeaders, [SOURCE_HEADER]: 'pool:metrics:20' },
        responseValuePath: 'data.items.0.remainingQuantity',
        expectedValue: 0,
      },
    },
    repeatedIdempotency: {
      enabled: true,
      concurrency: 20,
      expectedStatuses: [201],
      responseIdentityPath: 'data.id',
      request: checkoutDescriptor(fixture.repeatedActor, `load-repeated-${runId}`, 'repeated', 20),
    },
    adminOrderList: {
      enabled: true,
      concurrency: 25,
      request: {
        method: 'GET',
        path: '/api/v1/admin/orders?page=1&limit=50',
        headers: { ...fixture.adminHeaders, [SOURCE_HEADER]: 'pool:admin:25' },
      },
    },
    workerBacklogRecovery: {
      enabled: true,
      timeoutMs: 30_000,
      recoveryTimeoutMs: 60_000,
      pollIntervalMs: 100,
      minimumProcessedIncrease: fixture.backlogActors.length,
      allowedDeadLetterIncrease: 0,
      maximumFinalBacklog: 0,
      metricsRequest: {
        method: 'GET',
        path: '/api/v1/admin/operations/metrics',
        headers: { ...fixture.adminHeaders, [SOURCE_HEADER]: 'pool:metrics:20' },
      },
      triggerExpectedStatuses: [201],
      triggerConcurrency: 10,
      triggerRequests: fixture.backlogActors.map((actor, index) =>
        checkoutDescriptor(actor, `load-backlog-${runId}-${index + 1}`, 'backlog', 10),
      ),
    },
  },
});

const reconcile = async (prisma, fixture) => {
  const now = new Date();
  const [
    orders,
    activeReservations,
    notifications,
    cancelledNotifications,
    cancelledAttempts,
    processedNotificationOutbox,
    processedOutboxTotal,
    deadLetters,
    inventories,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.stockReservation.count({ where: { state: 'ACTIVE', expiresAt: { gt: now } } }),
    prisma.notification.count(),
    prisma.notification.count({ where: { status: 'CANCELLED' } }),
    prisma.notificationDeliveryAttempt.count({ where: { status: 'CANCELLED' } }),
    prisma.outboxEvent.count({
      where: { status: 'PROCESSED', eventType: 'notification.dispatch.requested' },
    }),
    prisma.outboxEvent.count({ where: { status: 'PROCESSED' } }),
    prisma.outboxEvent.count({ where: { status: 'DEAD_LETTER' } }),
    prisma.inventoryItem.findMany({
      where: {
        id: {
          in: [
            ...fixture.checkout.variants.map((variant) => variant.inventoryItemId),
            fixture.race.inventoryItemId,
            fixture.repeated.inventoryItemId,
          ],
        },
      },
      include: {
        reservations: {
          where: { state: 'ACTIVE', expiresAt: { gt: now } },
          select: { quantity: true },
        },
      },
    }),
  ]);
  const remaining = (inventoryItemId) => {
    const inventory = inventories.find((item) => item.id === inventoryItemId);
    if (!inventory) throw new Error('A fixture inventory row disappeared');
    return (
      inventory.onHandQuantity -
      inventory.reservations.reduce((sum, item) => sum + item.quantity, 0)
    );
  };
  const result = {
    orders,
    activeReservations,
    notifications,
    cancelledNotifications,
    cancelledAttempts,
    processedNotificationOutbox,
    processedOutboxTotal,
    deadLetters,
    remaining: {
      checkout: fixture.checkout.variants.reduce(
        (total, variant) => total + remaining(variant.inventoryItemId),
        0,
      ),
      finalUnit: remaining(fixture.race.inventoryItemId),
      repeated: remaining(fixture.repeated.inventoryItemId),
    },
  };
  const expected = fixture.expected;
  if (
    result.orders !== expected.orders ||
    result.activeReservations !== expected.activeReservations ||
    result.notifications !== expected.notifications ||
    result.cancelledNotifications !== expected.notifications ||
    result.cancelledAttempts !== expected.notifications ||
    result.processedNotificationOutbox !== expected.notifications ||
    result.deadLetters !== 0 ||
    result.remaining.checkout !== expected.checkoutRemaining ||
    result.remaining.finalUnit !== expected.raceRemaining ||
    result.remaining.repeated !== expected.repeatedRemaining
  ) {
    throw new Error(`Disposable load reconciliation failed: ${JSON.stringify(result)}`);
  }
  return result;
};

const applicationEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: apiRuntimeUrl,
  DATABASE_MIGRATION_URL: migrationUrl,
  REDIS_URL: redisUrl.toString(),
  WEB_URL: 'http://127.0.0.1:4175',
  COOKIE_SECRET: cookieSecret,
  FIELD_ENCRYPTION_KEY: fieldEncryptionKey,
  CHECKOUT_ENABLED: 'true',
  MAINTENANCE_MODE: 'false',
  PRELAUNCH_MODE: 'false',
  MINIMUM_PURCHASE_AGE: '18',
  LOG_LEVEL: 'warn',
};
const workerEnvironment = {
  ...applicationEnvironment,
  DATABASE_URL: workerRuntimeUrl,
  OUTBOX_QUEUE_NAME: queueName,
  OUTBOX_POLL_INTERVAL_MS: '500',
  OUTBOX_BATCH_SIZE: '100',
  OUTBOX_CONCURRENCY: '20',
  WORKER_HEARTBEAT_INTERVAL_MS: '5000',
  RESERVATION_EXPIRY_INTERVAL_MS: '10000',
  NOTIFICATION_BRIDGE_ENABLED: 'false',
  NOTIFICATION_ADAPTER: 'disabled',
  SMS_ENABLED: 'false',
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
const processes = [];
let databaseCreated = false;
let migrationGranted = false;
let runtimeGranted = false;
let loopbackFetch;
let cleanupError;
let finalReport;

try {
  await flushRedis();
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

  await executeOrThrow(
    'Prisma migration deployment',
    process.execPath,
    [prismaCli, 'migrate', 'deploy'],
    {
      cwd: repositoryRoot,
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: migrationUrl },
    },
  );
  await executeOrThrow(
    'Structural seed',
    process.execPath,
    [tsxCli, path.join(repositoryRoot, 'prisma', 'seed.ts')],
    {
      cwd: repositoryRoot,
      env: applicationEnvironment,
    },
  );

  const runtimePrisma = prismaFor(runtimeUrl);
  try {
    const fixture = await seedDisposableCommerceFixture(runtimePrisma, { databaseName, runId });
    if (process.env.DISPOSABLE_LOAD_REUSE_BUILD !== 'true') {
      await Promise.all([
        executeOrThrow(
          'API build',
          process.execPath,
          [typescriptCli, '-p', path.join(apiRoot, 'tsconfig.build.json')],
          {
            cwd: repositoryRoot,
            env: applicationEnvironment,
          },
        ),
        executeOrThrow(
          'Worker build',
          process.execPath,
          [typescriptCli, '-p', path.join(workerRoot, 'tsconfig.build.json')],
          {
            cwd: repositoryRoot,
            env: workerEnvironment,
          },
        ),
      ]);
    }

    const api = startProcess(
      'Disposable load API',
      process.execPath,
      [path.join(apiRoot, 'dist', 'main.js')],
      {
        cwd: apiRoot,
        env: { ...applicationEnvironment, PORT: String(apiPort) },
      },
    );
    processes.push(api);
    await waitForUrl('Disposable load API', `${apiBaseUrl}/api/v1/health/live`, api.child);
    const worker = startProcess(
      'Disposable load worker',
      process.execPath,
      [path.join(workerRoot, 'dist', 'main.js')],
      {
        cwd: workerRoot,
        env: workerEnvironment,
      },
    );
    processes.push(worker);
    await waitForUrl('Disposable load readiness', `${apiBaseUrl}/api/v1/health/ready`, api.child);

    loopbackFetch = createLoopbackFetch();
    const loadReport = await runLoadSuite(createLoadFixture(fixture), {
      fetchImpl: loopbackFetch.fetchImplementation,
    });
    if (loadReport.status !== 'passed') {
      throw new Error(`Full-target load suite did not pass: ${JSON.stringify(loadReport)}`);
    }
    const reconciliation = await reconcile(runtimePrisma, fixture);
    finalReport = {
      ...loadReport,
      isolation: {
        databasePattern: 'vape_load_<generated>',
        redisDatabase: 13,
        loopbackClientAddressesUsed: loopbackFetch.addressCount(),
        apiProcesses: 1,
        workerProcesses: 1,
        apiDatabaseConnectionLimit: 60,
        workerDatabaseConnectionLimit: 10,
        notificationPath: 'GLOBALLY_DISABLED_CANCELLED_AND_OUTBOX_PROCESSED',
      },
      reconciliation,
    };
  } finally {
    await runtimePrisma.$disconnect();
  }
} finally {
  const cleanupFailures = [];
  loopbackFetch?.close();
  for (const processHandle of [...processes].reverse()) {
    await stopProcess(processHandle).catch((error) => cleanupFailures.push(error));
  }
  await flushRedis().catch((error) => cleanupFailures.push(error));
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
      `Disposable load cleanup failed (${cleanupFailures.length} operation(s))`,
      {
        cause: cleanupFailures[0],
      },
    );
  }
}

if (cleanupError) throw cleanupError;
process.stdout.write(`${JSON.stringify(finalReport, null, 2)}\n`);
