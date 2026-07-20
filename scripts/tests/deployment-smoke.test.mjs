import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { runDeploymentSmoke } from '../lib/deployment-smoke.mjs';

const listen = async (handler) => {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    origin: `http://127.0.0.1:${String(address.port)}`,
  };
};

const close = (server) => new Promise((resolve) => server.close(resolve));

test('deployment smoke verifies health, age gate, catalog and separate login routes', async () => {
  let ageCookieSeen = false;
  let ageRequestOrigin = null;
  let ageRequestContext = null;
  const { server, origin } = await listen((request, response) => {
    if (request.url === '/api/v1/health/live') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (request.url === '/api/v1/health/ready') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          status: 'ready',
          checks: { mysql: 'up', redis: 'up', worker: 'up', migrations: 'up' },
        }),
      );
      return;
    }
    if (request.url === '/api/v1/storefront/status') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          data: {
            checkoutEnabled: true,
            maintenanceMode: false,
            prelaunchMode: false,
            ageGateRequired: true,
            minimumAge: 18,
          },
        }),
      );
      return;
    }
    if (request.url === '/api/v1/checkout/policy') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: { allowed: true, blockers: [] } }));
      return;
    }
    if (request.url === '/api/v1/compliance/age-gate' && request.method === 'POST') {
      ageRequestOrigin = request.headers.origin ?? null;
      ageRequestContext = request.headers['x-client-context'] ?? null;
      response.statusCode = 204;
      response.setHeader('Set-Cookie', 'vape_age_gate=test-value; HttpOnly; Path=/');
      response.end();
      return;
    }
    if (request.url === '/api/v1/products?pageSize=1') {
      ageCookieSeen = request.headers.cookie === 'vape_age_gate=test-value';
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: { items: [] } }));
      return;
    }
    if (['/', '/login', '/admin/login'].includes(request.url)) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><body>application</body></html>');
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  try {
    const result = await runDeploymentSmoke({
      webUrl: origin,
      apiUrl: `${origin}/api/v1`,
      expectedCheckoutEnabled: true,
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.storefront.ageGateExercised, true);
    assert.equal(ageCookieSeen, true);
    assert.equal(ageRequestOrigin, origin);
    assert.equal(ageRequestContext, 'storefront');
    assert.deepEqual(
      result.checks.map((check) => check.name),
      [
        'api-liveness',
        'api-readiness',
        'storefront-status',
        'checkout-policy',
        'age-gate-cookie',
        'public-catalog',
        'storefront-page',
        'customer-login-page',
        'admin-login-page',
      ],
    );
  } finally {
    await close(server);
  }
});

test('deployment smoke fails closed when readiness is unavailable', async () => {
  const { server, origin } = await listen((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/v1/health/live') {
      response.end(JSON.stringify({ status: 'ok' }));
    } else {
      response.statusCode = 503;
      response.end(JSON.stringify({ code: 'DEPENDENCY_UNAVAILABLE' }));
    }
  });
  try {
    await assert.rejects(
      runDeploymentSmoke({ webUrl: origin, apiUrl: `${origin}/api/v1` }),
      /api-readiness returned HTTP 503/,
    );
  } finally {
    await close(server);
  }
});
