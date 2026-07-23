import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import sharp from 'sharp';

const repositoryRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const apiRoot = path.join(repositoryRoot, 'apps', 'api');
const webRoot = path.join(repositoryRoot, 'apps', 'web');
const prismaCli = path.join(repositoryRoot, 'node_modules', 'prisma', 'build', 'index.js');
const typescriptCli = path.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const tsxCli = path.join(repositoryRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteCli = path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const playwrightCli = path.join(webRoot, 'node_modules', '@playwright', 'test', 'cli.js');
const fixtureScript = path.join(apiRoot, 'test', 'e2e', 'seed-operational-fixture.mjs');

const requiredUrl = (name, protocols) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for disposable operational E2E tests`);
  const parsed = new URL(value);
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(' or ')}`);
  }
  return parsed;
};

if (process.env.NODE_ENV !== 'test') {
  throw new Error('Operational E2E tests require NODE_ENV=test');
}

const adminUrl = requiredUrl('TEST_DATABASE_ADMIN_URL', ['mysql:']);
const migrationSourceUrl = requiredUrl('DATABASE_MIGRATION_URL', ['mysql:']);
const runtimeSourceUrl = requiredUrl('DATABASE_URL', ['mysql:']);
const redisUrl = requiredUrl('TEST_E2E_REDIS_URL', ['redis:', 'rediss:']);
if (
  adminUrl.hostname !== migrationSourceUrl.hostname ||
  adminUrl.port !== migrationSourceUrl.port ||
  adminUrl.hostname !== runtimeSourceUrl.hostname ||
  adminUrl.port !== runtimeSourceUrl.port
) {
  throw new Error('All MySQL identities must address the same disposable test server');
}
if (redisUrl.pathname !== '/14') {
  throw new Error('TEST_E2E_REDIS_URL must explicitly select disposable Redis database 14');
}

const configuredPort = (name, fallback) => {
  const raw = process.env[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 65_535) {
    throw new Error(`${name} must be a non-privileged TCP port`);
  }
  return value;
};

const apiPort = configuredPort('OPERATIONAL_E2E_API_PORT', 3101);
const webPort = configuredPort('OPERATIONAL_E2E_WEB_PORT', 4174);
if (apiPort === webPort) throw new Error('Operational E2E API and web ports must differ');
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const webBaseUrl = `http://127.0.0.1:${webPort}`;

const runId = `${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
const databaseName = `vape_e2e_${runId}`;
if (!/^vape_e2e_[a-z0-9_]+$/.test(databaseName)) throw new Error('Unsafe E2E database name');

const databaseUrl = (source) => {
  const target = new URL(source);
  target.pathname = `/${databaseName}`;
  return target.toString();
};
const migrationUrl = databaseUrl(migrationSourceUrl);
const runtimeUrl = databaseUrl(runtimeSourceUrl);
const secretSuffix = randomBytes(18).toString('base64url');
const adminEmail = `operational-admin-${runId}@example.test`;
const adminPassword = `E2e!Admin-${secretSuffix}`;
const reconcilerEmail = `operational-reconciler-${runId}@example.test`;
const reconcilerPassword = `E2e!Reconcile-${randomBytes(18).toString('base64url')}`;
const limitedAdminEmail = `operational-limited-${runId}@example.test`;
const limitedAdminPassword = `E2e!Limited-${randomBytes(18).toString('base64url')}`;
const customerEmail = `operational-customer-${runId}@example.test`;
const customerPassword = `E2e!Customer-${secretSuffix}`;
const customerPhone = `+2162${String(Date.now()).slice(-7)}`;
const cookieSecret = `operational-cookie-${randomBytes(32).toString('base64url')}`;
const fieldEncryptionKey = `operational-field-${randomBytes(32).toString('base64url')}`;

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

const startServer = (label, file, arguments_, options) => {
  const child = spawn(file, arguments_, { ...options, stdio: 'inherit' });
  child.once('error', (error) => {
    console.error(`${label} failed to start`, error);
  });
  return { label, child };
};

const waitForUrl = async (label, url, child, timeoutMilliseconds = 60_000) => {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited before becoming available (code ${child.exitCode})`);
    }
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

const stopServer = async ({ child }) => {
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

const cleanRedis = async () => {
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
const servers = [];
let databaseCreated = false;
let migrationGranted = false;
let runtimeGranted = false;
let cleanupError;
let mediaFixtureDirectory;
let mediaFixtureServer;
let mediaFixtureRequestCount = 0;

try {
  mediaFixtureDirectory = await mkdtemp(path.join(tmpdir(), 'vape-operational-media-'));
  await mkdir(path.join(mediaFixtureDirectory, 'input'), { recursive: true });
  const mediaFixturePaths = await Promise.all(
    [
      ['primary.png', { r: 89, g: 45, b: 184, alpha: 1 }],
      ['gallery.png', { r: 225, g: 45, b: 138, alpha: 1 }],
      ['variant.png', { r: 32, g: 164, b: 118, alpha: 1 }],
      ['replacement.png', { r: 245, g: 122, b: 41, alpha: 1 }],
    ].map(async ([filename, background]) => {
      const fixturePath = path.join(mediaFixtureDirectory, 'input', filename);
      await sharp({
        create: { width: 320, height: 320, channels: 4, background },
      })
        .png()
        .toFile(fixturePath);
      return fixturePath;
    }),
  );
  const importedMediaFixture = await sharp({
    create: {
      width: 320,
      height: 320,
      channels: 4,
      background: { r: 35, g: 205, b: 190, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  mediaFixtureServer = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (request.method !== 'GET' || pathname !== '/generic-import.png') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    mediaFixtureRequestCount += 1;
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'image/png',
      'Content-Length': String(importedMediaFixture.length),
    });
    response.end(importedMediaFixture);
  });
  await new Promise((resolve, reject) => {
    mediaFixtureServer.once('error', reject);
    mediaFixtureServer.listen(0, '127.0.0.1', resolve);
  });
  const mediaFixtureAddress = mediaFixtureServer.address();
  if (!mediaFixtureAddress || typeof mediaFixtureAddress === 'string') {
    throw new Error('The operational media fixture did not expose a TCP address');
  }
  const mediaFixtureOrigin = `http://127.0.0.1:${mediaFixtureAddress.port}`;
  const previewConfigPath = path.join(mediaFixtureDirectory, 'vite-operational.config.mjs');
  await writeFile(
    previewConfigPath,
    `export default { preview: { proxy: { '/api': { target: ${JSON.stringify(apiBaseUrl)}, changeOrigin: true } } } };\n`,
    'utf8',
  );
  const applicationEnvironment = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: runtimeUrl,
    DATABASE_MIGRATION_URL: migrationUrl,
    REDIS_URL: redisUrl.toString(),
    WEB_URL: webBaseUrl,
    COOKIE_SECRET: cookieSecret,
    FIELD_ENCRYPTION_KEY: fieldEncryptionKey,
    CHECKOUT_ENABLED: 'true',
    MAINTENANCE_MODE: 'false',
    PRELAUNCH_MODE: 'false',
    MINIMUM_PURCHASE_AGE: '18',
    MEDIA_STORAGE_DRIVER: 'local',
    MEDIA_LOCAL_ROOT: path.join(mediaFixtureDirectory, 'storage'),
    CATALOG_IMPORT_MEDIA_HOSTS: 'catalog-media-fixture.invalid',
    OPERATIONAL_E2E_MEDIA_FIXTURE_ORIGIN: mediaFixtureOrigin,
    LOG_LEVEL: 'warn',
  };
  const fixtureEnvironment = {
    ...applicationEnvironment,
    OPERATIONAL_E2E_FIXTURE_CONFIRM: 'CREATE_DISPOSABLE_OPERATIONAL_E2E_FIXTURE',
    OPERATIONAL_E2E_DATABASE_NAME: databaseName,
    OPERATIONAL_E2E_ADMIN_EMAIL: adminEmail,
    OPERATIONAL_E2E_ADMIN_PASSWORD: adminPassword,
    OPERATIONAL_E2E_RECONCILER_EMAIL: reconcilerEmail,
    OPERATIONAL_E2E_RECONCILER_PASSWORD: reconcilerPassword,
    OPERATIONAL_E2E_LIMITED_ADMIN_EMAIL: limitedAdminEmail,
    OPERATIONAL_E2E_LIMITED_ADMIN_PASSWORD: limitedAdminPassword,
  };
  const browserEnvironment = {
    ...applicationEnvironment,
    CI: process.env.CI,
    PLAYWRIGHT_OPERATIONAL: 'true',
    PLAYWRIGHT_BASE_URL: webBaseUrl,
    OPERATIONAL_E2E_API_URL: apiBaseUrl,
    OPERATIONAL_E2E_ADMIN_EMAIL: adminEmail,
    OPERATIONAL_E2E_ADMIN_PASSWORD: adminPassword,
    OPERATIONAL_E2E_RECONCILER_EMAIL: reconcilerEmail,
    OPERATIONAL_E2E_RECONCILER_PASSWORD: reconcilerPassword,
    OPERATIONAL_E2E_LIMITED_ADMIN_EMAIL: limitedAdminEmail,
    OPERATIONAL_E2E_LIMITED_ADMIN_PASSWORD: limitedAdminPassword,
    OPERATIONAL_E2E_CUSTOMER_EMAIL: customerEmail,
    OPERATIONAL_E2E_CUSTOMER_PASSWORD: customerPassword,
    OPERATIONAL_E2E_CUSTOMER_PHONE: customerPhone,
    OPERATIONAL_E2E_MEDIA_PATHS: JSON.stringify(mediaFixturePaths),
  };
  await cleanRedis();
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
    { cwd: repositoryRoot, env: applicationEnvironment },
  );
  await executeOrThrow('Operational fixture', process.execPath, [fixtureScript], {
    cwd: apiRoot,
    env: fixtureEnvironment,
  });

  await executeOrThrow(
    'API build',
    process.execPath,
    [typescriptCli, '-p', path.join(apiRoot, 'tsconfig.build.json')],
    { cwd: repositoryRoot, env: applicationEnvironment },
  );
  await executeOrThrow(
    'Web type build',
    process.execPath,
    [typescriptCli, '-b', path.join(webRoot, 'tsconfig.json'), '--pretty', 'false'],
    { cwd: repositoryRoot, env: applicationEnvironment },
  );
  await executeOrThrow('Web production bundle', process.execPath, [viteCli, 'build'], {
    cwd: webRoot,
    env: { ...applicationEnvironment, VITE_API_URL: apiBaseUrl },
  });

  const apiServer = startServer(
    'API',
    process.execPath,
    [path.join(apiRoot, 'test', 'e2e', 'start-operational-api.mjs')],
    {
      cwd: apiRoot,
      env: { ...applicationEnvironment, PORT: String(apiPort) },
    },
  );
  servers.push(apiServer);
  await waitForUrl('API', `${apiBaseUrl}/api/v1/health/live`, apiServer.child);

  const webServer = startServer(
    'Web preview',
    process.execPath,
    [
      viteCli,
      'preview',
      '--config',
      previewConfigPath,
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort),
      '--strictPort',
    ],
    { cwd: webRoot, env: applicationEnvironment },
  );
  servers.push(webServer);
  await waitForUrl('Web preview', webBaseUrl, webServer.child);

  await executeOrThrow('Operational Playwright suite', process.execPath, [playwrightCli, 'test'], {
    cwd: webRoot,
    env: browserEnvironment,
  });
  if (mediaFixtureRequestCount < 1) {
    throw new Error('Operational E2E did not fetch the local catalog media fixture');
  }

  const verification = prismaFor(runtimeUrl);
  try {
    const customer = await verification.user.findUnique({
      where: { emailNormalized: customerEmail },
      include: { customerProfile: true },
    });
    if (!customer?.customerProfile || customer.audience !== 'CUSTOMER') {
      throw new Error('Operational E2E did not persist the registered customer');
    }
    const order = await verification.order.findFirst({
      where: { customerId: customer.customerProfile.id },
      include: {
        items: true,
        reservations: true,
        delivery: true,
        cashCollections: true,
        consentSnapshots: true,
        cart: true,
        notifications: true,
      },
    });
    if (
      !order ||
      order.status !== 'DELIVERED' ||
      order.paymentStatus !== 'CASH_REMITTED' ||
      order.currency !== 'TND' ||
      order.deliveryMethodType !== 'COURIER' ||
      order.items.length !== 1 ||
      order.reservations.length !== 1 ||
      order.reservations[0]?.state !== 'CONSUMED' ||
      order.delivery?.status !== 'DELIVERED' ||
      order.cashCollections.length !== 1 ||
      order.cashCollections[0]?.status !== 'REMITTED' ||
      order.consentSnapshots.length !== 3 ||
      order.cart?.status !== 'CONVERTED' ||
      order.notifications.length < 4
    ) {
      throw new Error('Operational E2E order invariants were not persisted');
    }
    const inventory = await verification.inventoryItem.findUniqueOrThrow({
      where: { id: order.reservations[0].inventoryItemId },
    });
    if (inventory.onHandQuantity !== 3 || order.reservations[0].quantity !== 1) {
      throw new Error('Operational E2E stock reservation invariants were not preserved');
    }
    const receivedBatch = await verification.productBatch.findFirst({
      where: { batchNumber: 'E2E-BATCH-RECEIPT' },
      include: { inventoryItems: true },
    });
    if (
      !receivedBatch?.receivedAt ||
      receivedBatch.inventoryItems.length !== 1 ||
      receivedBatch.inventoryItems[0]?.onHandQuantity !== 2
    ) {
      throw new Error('Operational E2E batch receipt was not persisted exactly once');
    }
    const administrators = await verification.user.findMany({
      where: { emailNormalized: { in: [adminEmail, reconcilerEmail, limitedAdminEmail] } },
      include: { adminProfile: true, twoFactorSecret: true, roles: { include: { role: true } } },
    });
    const expectedRoles = new Map([
      [adminEmail, 'super-administrator'],
      [reconcilerEmail, 'accountant'],
      [limitedAdminEmail, 'read-only-analyst'],
    ]);
    if (
      administrators.length !== expectedRoles.size ||
      administrators.some(
        (administrator) =>
          !administrator.adminProfile ||
          administrator.adminProfile.mustEnrollTwoFactor ||
          !administrator.twoFactorSecret?.verifiedAt ||
          !administrator.roles.some(
            ({ role }) => role.key === expectedRoles.get(administrator.emailNormalized),
          ),
      )
    ) {
      throw new Error('Operational E2E administrator TOTP and role invariants were not persisted');
    }
    const remittance = await verification.cashRemittance.findFirst({
      where: { remittanceNumber: 'E2E-REMITTANCE-001' },
      include: { items: true },
    });
    if (
      remittance?.status !== 'VERIFIED' ||
      remittance.verifiedMillimes !== order.expectedCodMillimes ||
      remittance.items.length !== 1
    ) {
      throw new Error('Operational E2E COD remittance was not independently reconciled');
    }
    const managedProduct = await verification.product.findUnique({
      where: { slug: 'admin-created-e2e-product' },
    });
    if (!managedProduct || managedProduct.nameFr !== 'Produit E2E administré modifié') {
      throw new Error('Operational E2E product create/edit workflow was not persisted');
    }
    const mediaProduct = await verification.product.findUnique({
      where: { slug: 'puffjet-menthe-operationnelle' },
      include: { variants: { where: { deletedAt: null }, select: { id: true } } },
    });
    if (!mediaProduct || mediaProduct.variants.length !== 1) {
      throw new Error('Operational E2E media owner was not preserved');
    }
    const mediaImages = await verification.productImage.findMany({
      where: {
        OR: [
          { productId: mediaProduct.id },
          { variantId: { in: mediaProduct.variants.map(({ id }) => id) } },
        ],
      },
    });
    const activeMediaImages = mediaImages.filter(({ deletedAt }) => deletedAt === null);
    const deletedMediaImages = mediaImages.filter(({ deletedAt }) => deletedAt !== null);
    if (
      activeMediaImages.length !== 3 ||
      deletedMediaImages.length !== 2 ||
      !activeMediaImages.some(
        (image) =>
          image.productId === mediaProduct.id &&
          image.variantId === null &&
          image.altTextFr === 'Galerie produit E2E' &&
          !image.isPrimary &&
          image.originalFilename === 'gallery.png',
      ) ||
      !activeMediaImages.some(
        (image) =>
          image.productId === mediaProduct.id &&
          image.variantId === null &&
          image.altTextFr === 'PuffJet Media Operationnelle E2E' &&
          image.isPrimary &&
          image.moderationStatus === 'APPROVED' &&
          image.originalFilename === 'generic-import.png',
      ) ||
      !activeMediaImages.some(
        (image) =>
          image.productId === null &&
          image.variantId === mediaProduct.variants[0].id &&
          image.altTextFr === 'Variante menthe E2E' &&
          image.isPrimary &&
          image.originalFilename === 'variant.png',
      ) ||
      !deletedMediaImages.some(
        (image) =>
          image.altTextFr === 'Image secondaire modifiée E2E' &&
          image.originalFilename === 'primary.png',
      ) ||
      !deletedMediaImages.some(
        (image) =>
          image.altTextFr === 'Image secondaire modifiée E2E' &&
          image.originalFilename === 'replacement.png',
      )
    ) {
      throw new Error('Operational E2E product-media lifecycle invariants were not persisted');
    }
    const importedProduct = await verification.product.findUnique({
      where: { slug: 'operational-imported-e2e-product' },
      include: { variants: { where: { deletedAt: null } } },
    });
    const importBatches = await verification.catalogImportBatch.findMany({
      where: { importKey: 'operational-generic-import-v1' },
      include: { rows: true },
    });
    const appliedImport = importBatches.find(({ dryRun }) => !dryRun);
    const importedMediaSource = await verification.catalogSourceRecord.findUnique({
      where: {
        source_entityType_externalKey: {
          source: 'ADMIN_UPLOAD',
          entityType: 'IMAGE',
          externalKey: 'operational-published-product-media:primary',
        },
      },
      include: { image: true },
    });
    const importedMediaMetadata = importedMediaSource?.metadata;
    if (
      !importedProduct ||
      importedProduct.publicationStatus !== 'DRAFT' ||
      !importedProduct.requiresPricing ||
      !importedProduct.requiresStock ||
      importedProduct.variants.length !== 1 ||
      importedProduct.variants[0]?.sku !== 'E2E-GENERIC-IMPORT-CITRUS' ||
      importedProduct.variants[0]?.publicationStatus !== 'DRAFT' ||
      importBatches.length !== 2 ||
      appliedImport?.status !== 'APPLIED_WITH_WARNINGS' ||
      appliedImport.appliedCount !== 2 ||
      appliedImport.rows.length !== 2 ||
      importedMediaSource?.verifiedAt !== null ||
      importedMediaSource?.sourceUrl !==
        'https://catalog-media-fixture.invalid/generic-import.png' ||
      importedMediaSource.image?.moderationStatus !== 'APPROVED' ||
      importedMediaSource.image?.isPrimary !== true ||
      !importedMediaMetadata ||
      typeof importedMediaMetadata !== 'object' ||
      Array.isArray(importedMediaMetadata) ||
      importedMediaMetadata.provenance !== 'OPERATOR_SUPPLIED_UNVERIFIED'
    ) {
      throw new Error(
        'Operational E2E generic catalogue/media import was not applied and reviewed exactly once',
      );
    }
    console.info(
      JSON.stringify({
        suite: 'operational-e2e',
        customerRegistration: 'passed',
        customerLogin: 'passed',
        catalogCartCheckout: 'passed',
        adminTotpEnrollment: 'passed',
        productCreateEdit: 'passed',
        productMediaLifecycle: 'passed',
        genericCatalogImportReplay: 'passed',
        genericCatalogMediaReview: 'passed',
        localCatalogMediaFetches: mediaFixtureRequestCount,
        inventoryBatchReceipt: 'passed',
        orderDeliveryLifecycle: 'passed',
        codReconciliation: 'passed',
        deniedAdminPermission: 'passed',
        checkoutTechnicalGate: 'passed',
        maintenanceMode: 'passed',
        orderStatus: order.status,
        paymentStatus: order.paymentStatus,
        reservationState: order.reservations[0].state,
        onHandQuantity: inventory.onHandQuantity,
        receivedBatchQuantity: receivedBatch.inventoryItems[0].onHandQuantity,
        reservedQuantity: order.reservations[0].quantity,
      }),
    );
  } finally {
    await verification.$disconnect();
  }
} finally {
  const cleanupFailures = [];
  for (const server of [...servers].reverse()) {
    await stopServer(server).catch((error) => cleanupFailures.push(error));
  }
  if (mediaFixtureServer) {
    await new Promise((resolve, reject) => {
      mediaFixtureServer.close((error) => (error ? reject(error) : resolve()));
    }).catch((error) => cleanupFailures.push(error));
  }
  if (mediaFixtureDirectory) {
    await rm(mediaFixtureDirectory, { recursive: true, force: true }).catch((error) =>
      cleanupFailures.push(error),
    );
  }
  await cleanRedis().catch((error) => cleanupFailures.push(error));
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
      `Disposable operational E2E cleanup failed (${cleanupFailures.length} operation(s))`,
      { cause: cleanupFailures[0] },
    );
  }
}

if (cleanupError) throw cleanupError;
