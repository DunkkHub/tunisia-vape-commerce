import { randomUUID } from 'node:crypto';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const MAX_RESPONSE_BYTES = 1_000_000;

const normalizeBaseUrl = (value, name, allowInsecureHttp) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) URL without embedded credentials`);
  }
  if (url.search || url.hash) throw new Error(`${name} must not include a query or fragment`);
  if (
    url.protocol === 'http:' &&
    !LOOPBACK_HOSTS.has(url.hostname) &&
    allowInsecureHttp !== 'true'
  ) {
    throw new Error(`${name} requires HTTPS outside loopback`);
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
};

const responseText = async (response, name) => {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(`${name} response exceeded the smoke-test size limit`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    totalBytes += chunk.length;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`${name} response exceeded the smoke-test size limit`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8');
};

const jsonResponse = async (response, name) => {
  const text = await responseText(response, name);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} did not return valid JSON`);
  }
};

const firstCookie = (headers) => {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const raw = values[0] ?? headers.get('set-cookie');
  return raw?.split(';', 1)[0] ?? null;
};

export const runDeploymentSmoke = async ({
  webUrl,
  adminWebUrl = webUrl,
  apiUrl,
  allowInsecureHttp = 'false',
  timeoutMilliseconds = 10_000,
  expectedCheckoutEnabled,
  requireCheckoutReady = true,
  fetchImplementation = globalThis.fetch,
}) => {
  if (typeof fetchImplementation !== 'function') throw new Error('Fetch is unavailable');
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 500 ||
    timeoutMilliseconds > 60_000
  ) {
    throw new Error('SMOKE_TIMEOUT_MS must be an integer from 500 through 60000');
  }
  const web = normalizeBaseUrl(webUrl, 'SMOKE_WEB_URL', allowInsecureHttp);
  const adminWeb = normalizeBaseUrl(adminWebUrl, 'SMOKE_ADMIN_WEB_URL', allowInsecureHttp);
  const api = normalizeBaseUrl(apiUrl, 'SMOKE_API_URL', allowInsecureHttp);
  const correlationId = `deployment-smoke-${randomUUID()}`;
  const checks = [];
  const request = async (name, url, options = {}) => {
    let response;
    try {
      response = await fetchImplementation(url, {
        ...options,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMilliseconds),
        headers: {
          Accept: options.accept ?? 'application/json',
          'Accept-Language': 'fr',
          'X-Request-ID': correlationId,
          ...options.headers,
        },
      });
    } catch (error) {
      throw new Error(`${name} request failed`, { cause: error });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${name} returned HTTP ${String(response.status)}`);
    }
    checks.push({ name, status: response.status });
    return response;
  };

  const live = await jsonResponse(
    await request('api-liveness', new URL(`${api.pathname}/health/live`, api)),
    'api-liveness',
  );
  if (live?.status !== 'ok') throw new Error('api-liveness returned an unexpected contract');

  const ready = await jsonResponse(
    await request('api-readiness', new URL(`${api.pathname}/health/ready`, api)),
    'api-readiness',
  );
  const requiredReadinessChecks = ['mysql', 'redis', 'worker', 'migrations'];
  if (
    ready?.status !== 'ready' ||
    !ready.checks ||
    requiredReadinessChecks.some((name) => ready.checks[name] !== 'up')
  ) {
    throw new Error('api-readiness returned an unexpected contract');
  }

  const storefrontStatus = await jsonResponse(
    await request('storefront-status', new URL(`${api.pathname}/storefront/status`, api)),
    'storefront-status',
  );
  const statusData = storefrontStatus?.data;
  if (!statusData || typeof statusData.checkoutEnabled !== 'boolean') {
    throw new Error('storefront-status returned an unexpected contract');
  }
  if (
    expectedCheckoutEnabled !== undefined &&
    statusData.checkoutEnabled !== expectedCheckoutEnabled
  ) {
    throw new Error('storefront checkout state did not match SMOKE_EXPECT_CHECKOUT_ENABLED');
  }

  const checkoutPolicy = await jsonResponse(
    await request('checkout-policy', new URL(`${api.pathname}/checkout/policy`, api)),
    'checkout-policy',
  );
  const policyData = checkoutPolicy?.data;
  if (
    !policyData ||
    typeof policyData.allowed !== 'boolean' ||
    !Array.isArray(policyData.blockers) ||
    policyData.allowed !== (policyData.blockers.length === 0)
  ) {
    throw new Error('checkout-policy returned an unexpected contract');
  }
  if (
    requireCheckoutReady &&
    (!statusData.checkoutEnabled ||
      statusData.maintenanceMode ||
      statusData.prelaunchMode ||
      !policyData.allowed ||
      policyData.blockers.length > 0)
  ) {
    throw new Error('checkout is not operationally ready');
  }

  let cookie = null;
  if (statusData.ageGateRequired) {
    if (!Number.isSafeInteger(statusData.minimumAge) || statusData.minimumAge < 1) {
      throw new Error('storefront-status returned an invalid minimum age');
    }
    const response = await request(
      'age-gate-cookie',
      new URL(`${api.pathname}/compliance/age-gate`, api),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: web.origin,
          'X-Client-Context': 'storefront',
        },
        body: JSON.stringify({ confirmed: true, minimumAge: statusData.minimumAge }),
      },
    );
    cookie = firstCookie(response.headers);
    if (!cookie) throw new Error('age-gate-cookie did not issue a cookie');
  }

  const catalog = await jsonResponse(
    await request(
      'public-catalog',
      new URL(`${api.pathname}/products?pageSize=1`, api),
      cookie ? { headers: { Cookie: cookie } } : {},
    ),
    'public-catalog',
  );
  if (!Array.isArray(catalog?.data?.items)) {
    throw new Error('public-catalog returned an unexpected contract');
  }

  for (const [name, route, base] of [
    ['storefront-page', '/', web],
    ['customer-login-page', '/login', web],
    ['admin-login-page', '/admin/login', adminWeb],
  ]) {
    const response = await request(name, new URL(route, base), { accept: 'text/html' });
    const contentType = response.headers.get('content-type') ?? '';
    const body = await responseText(response, name);
    if (!contentType.toLowerCase().includes('text/html') || !/<html[\s>]/i.test(body)) {
      throw new Error(`${name} did not return HTML`);
    }
  }

  return {
    status: 'passed',
    checkedAt: new Date().toISOString(),
    checks,
    storefront: {
      checkoutEnabled: statusData.checkoutEnabled,
      maintenanceMode: Boolean(statusData.maintenanceMode),
      prelaunchMode: Boolean(statusData.prelaunchMode),
      ageGateExercised: Boolean(statusData.ageGateRequired),
      catalogItemsSampled: catalog.data.items.length,
      checkoutPolicyAllowed: policyData.allowed,
      checkoutBlockers: policyData.blockers,
    },
    limitations: [
      'This read-only smoke does not authenticate an administrator or create an order.',
      'Run controlled TOTP, cart, checkout, notification, delivery and COD scenarios separately.',
    ],
  };
};

export const parseSmokeBoolean = (value, name) => {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
};
