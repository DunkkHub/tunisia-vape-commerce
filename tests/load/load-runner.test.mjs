import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, test } from 'node:test';
import { runLoadSuite } from './lib/load-runner.mjs';

const servers = new Set();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  servers.clear();
});

const json = (response, status, body) => {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(serialized),
  });
  response.end(serialized);
};

const startCommerceFixtureServer = async ({ oversell = false, catalogFailures = 0 } = {}) => {
  const orders = new Map();
  let orderSequence = 0;
  let finalStock = 1;
  let backlog = 0;
  let processed = 0;
  let postTriggerMetricReads = 0;
  let catalogRequests = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.local');
    if (request.method === 'GET' && url.pathname === '/api/v1/products') {
      catalogRequests += 1;
      if (catalogRequests <= catalogFailures) {
        json(response, 503, { code: 'TEMPORARY_CATALOG_FAILURE' });
        return;
      }
      json(response, 200, { data: { items: [], page: 1, pageSize: 20, total: 0 } });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/admin/orders') {
      json(response, 200, { data: { items: [], page: 1, pageSize: 50, total: 0 } });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/checkout/orders') {
      const cookie = request.headers.cookie ?? '';
      if (cookie.includes('race-actor')) {
        if (finalStock > 0 || oversell) {
          finalStock = Math.max(0, finalStock - 1);
          orderSequence += 1;
          json(response, 201, { data: { id: `race-order-${orderSequence}` } });
        } else {
          json(response, 409, { code: 'OUT_OF_STOCK', message: 'No stock remains.' });
        }
        return;
      }
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string') {
        json(response, 400, { code: 'IDEMPOTENCY_KEY_INVALID' });
        return;
      }
      let orderId = orders.get(key);
      if (!orderId) {
        orderSequence += 1;
        orderId = `order-${orderSequence}`;
        orders.set(key, orderId);
      }
      json(response, 201, { data: { id: orderId } });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/admin/inventory/final-unit') {
      json(response, 200, { data: { remainingQuantity: finalStock } });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/test/create-outbox') {
      backlog += 1;
      json(response, 201, { data: { queued: true } });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/admin/operations/metrics') {
      if (backlog > 0) {
        postTriggerMetricReads += 1;
        if (postTriggerMetricReads >= 2) {
          processed += backlog;
          backlog = 0;
        }
      }
      json(response, 200, {
        data: {
          outbox: { actionableBacklog: backlog, PROCESSED: processed, DEAD_LETTER: 0 },
          worker: { state: 'HEALTHY' },
        },
      });
      return;
    }
    json(response, 404, { code: 'NOT_FOUND' });
  });
  servers.add(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  return `http://127.0.0.1:${address.port}`;
};

const checkoutRequest = (cookie, idempotencyKey) => ({
  method: 'POST',
  path: '/api/v1/checkout/orders',
  headers: { Cookie: cookie, 'X-CSRF-Token': 'private-csrf-value' },
  idempotencyKey,
  body: { fixture: true },
});

const completeFixture = (baseUrl) => ({
  version: 1,
  baseUrl,
  scale: 0.1,
  defaults: { timeoutMs: 2_000, maxErrorRate: 0.01 },
  scenarios: {
    catalogBrowsing: {
      enabled: true,
      concurrency: 10,
      requests: [
        {
          method: 'GET',
          path: '/api/v1/products?page=1&pageSize=20',
          diagnosticLabel: 'catalog-read',
          headers: { Cookie: 'private-age-cookie' },
        },
      ],
    },
    checkoutAttempts: {
      enabled: true,
      concurrency: 5,
      actors: Array.from({ length: 5 }, (_, index) =>
        checkoutRequest(`private-customer-${index}`, `checkout-key-000000-${index}`),
      ),
    },
    finalUnitRace: {
      enabled: true,
      actors: [
        checkoutRequest('race-actor-a', 'race-key-00000001'),
        checkoutRequest('race-actor-b', 'race-key-00000002'),
      ],
      verification: {
        method: 'GET',
        path: '/api/v1/admin/inventory/final-unit',
        headers: { Cookie: 'private-admin-cookie' },
        responseValuePath: 'data.remainingQuantity',
        expectedValue: 0,
      },
    },
    repeatedIdempotency: {
      enabled: true,
      concurrency: 2,
      request: checkoutRequest('private-repeat-customer', 'repeat-key-00000001'),
    },
    adminOrderList: {
      enabled: true,
      concurrency: 5,
      request: {
        method: 'GET',
        path: '/api/v1/admin/orders?page=1&limit=50',
        headers: { Cookie: 'private-admin-cookie' },
      },
    },
    workerBacklogRecovery: {
      enabled: true,
      recoveryTimeoutMs: 2_000,
      pollIntervalMs: 10,
      minimumProcessedIncrease: 3,
      metricsRequest: {
        method: 'GET',
        path: '/api/v1/admin/operations/metrics',
        headers: { Cookie: 'private-admin-cookie' },
      },
      triggerRequests: Array.from({ length: 3 }, () => ({
        method: 'POST',
        path: '/api/v1/test/create-outbox',
        headers: { Cookie: 'private-trigger-cookie' },
      })),
    },
  },
});

test('runs every commerce, concurrency, administration, and backlog scenario at an honestly reported reduced scale', async () => {
  const baseUrl = await startCommerceFixtureServer();
  const report = await runLoadSuite(completeFixture(baseUrl));

  assert.equal(report.status, 'partial');
  assert.deepEqual(report.summary, {
    scenarios: 6,
    failed: 0,
    skipped: 0,
    reduced: 4,
    passedAtTarget: 2,
  });
  assert.equal(report.scenarios.find(({ name }) => name === 'catalogBrowsing').executed, 50);
  assert.equal(report.scenarios.find(({ name }) => name === 'checkoutAttempts').executed, 5);
  assert.equal(report.scenarios.find(({ name }) => name === 'finalUnitRace').winners, 1);
  assert.equal(
    report.scenarios.find(({ name }) => name === 'repeatedIdempotency').uniqueOrderIdentities,
    1,
  );
  assert.equal(
    report.scenarios.find(({ name }) => name === 'workerBacklogRecovery').final.actionableBacklog,
    0,
  );
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /private-(age|customer|admin|trigger|csrf)/);
});

test('reports disabled scenarios as skipped without claiming that load targets passed', async () => {
  const baseUrl = await startCommerceFixtureServer();
  const fixture = completeFixture(baseUrl);
  fixture.scenarios = Object.fromEntries(
    Object.keys(fixture.scenarios).map((name) => [
      name,
      { enabled: false, reason: 'Fixture absent.' },
    ]),
  );

  const report = await runLoadSuite(fixture);

  assert.equal(report.status, 'skipped');
  assert.equal(report.summary.skipped, 6);
  assert.ok(report.scenarios.every((scenario) => scenario.status === 'skipped'));
});

test('fails the final-unit scenario when more than one checkout wins the same unit', async () => {
  const baseUrl = await startCommerceFixtureServer({ oversell: true });
  const fixture = completeFixture(baseUrl);
  fixture.scenarios = {
    catalogBrowsing: { enabled: false },
    checkoutAttempts: { enabled: false },
    finalUnitRace: fixture.scenarios.finalUnitRace,
    repeatedIdempotency: { enabled: false },
    adminOrderList: { enabled: false },
    workerBacklogRecovery: { enabled: false },
  };

  const report = await runLoadSuite(fixture);
  const race = report.scenarios.find(({ name }) => name === 'finalUnitRace');

  assert.equal(report.status, 'failed');
  assert.equal(race.status, 'failed');
  assert.match(race.reason, /created 2 winners instead of 1/);
});

test('requires the unexpected-response rate to remain strictly below one percent', async () => {
  const baseUrl = await startCommerceFixtureServer({ catalogFailures: 1 });
  const fixture = completeFixture(baseUrl);
  fixture.scale = 0.2;
  fixture.scenarios = {
    catalogBrowsing: fixture.scenarios.catalogBrowsing,
    checkoutAttempts: { enabled: false },
    finalUnitRace: { enabled: false },
    repeatedIdempotency: { enabled: false },
    adminOrderList: { enabled: false },
    workerBacklogRecovery: { enabled: false },
  };

  const report = await runLoadSuite(fixture);
  const catalog = report.scenarios.find(({ name }) => name === 'catalogBrowsing');

  assert.equal(catalog.status, 'failed');
  assert.match(catalog.reason, /error rate 0\.0100 did not remain below 0\.0100/);
});

test('reports a bounded network exception signature without exposing its message', async () => {
  const fixture = completeFixture('http://127.0.0.1:3000');
  fixture.scale = 0.01;
  fixture.scenarios = {
    catalogBrowsing: fixture.scenarios.catalogBrowsing,
    checkoutAttempts: { enabled: false },
    finalUnitRace: { enabled: false },
    repeatedIdempotency: { enabled: false },
    adminOrderList: { enabled: false },
    workerBacklogRecovery: { enabled: false },
  };
  const fetchImpl = async () => {
    const error = new Error('private request detail must not be reported');
    error.code = 'ECONNRESET';
    error.syscall = 'read';
    throw error;
  };

  const report = await runLoadSuite(fixture, { fetchImpl });
  const catalog = report.scenarios.find(({ name }) => name === 'catalogBrowsing');

  assert.equal(catalog.status, 'failed');
  assert.match(catalog.reason, /"Error:ECONNRESET:read@catalog-read":5/);
  assert.doesNotMatch(catalog.reason, /private request detail/);
});
