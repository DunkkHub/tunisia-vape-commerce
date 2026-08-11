import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const LOAD_TARGETS = Object.freeze({
  catalogBrowsing: 500,
  checkoutAttempts: 50,
  finalUnitRace: 2,
  repeatedIdempotency: 20,
  adminOrderList: 25,
  workerBacklogRecovery: 1,
});

const SCENARIO_ORDER = Object.freeze(Object.keys(LOAD_TARGETS));
const METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
const PLACEHOLDER = /^\$\{([A-Z][A-Z0-9_]*)\}$/;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ERROR_RATE = 0.01;
const MAX_RESPONSE_CHARACTERS = 1_000_000;

class LoadScenarioError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LoadScenarioError';
  }
}

const assertScenario = (condition, message) => {
  if (!condition) throw new LoadScenarioError(message);
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteInteger = (value, name, { minimum = 1, maximum = 100_000 } = {}) => {
  assertScenario(Number.isSafeInteger(value), `${name} must be a safe integer.`);
  assertScenario(value >= minimum && value <= maximum, `${name} is outside its safe range.`);
  return value;
};

const finiteNumber = (value, name, { minimum = 0, maximum = 1 } = {}) => {
  assertScenario(Number.isFinite(value), `${name} must be finite.`);
  assertScenario(value >= minimum && value <= maximum, `${name} is outside its safe range.`);
  return value;
};

const getPath = (value, dottedPath) => {
  if (!dottedPath) return value;
  return dottedPath.split('.').reduce((current, segment) => {
    if (Array.isArray(current) && /^\d+$/.test(segment)) return current[Number(segment)];
    if (!isRecord(current)) return undefined;
    return current[segment];
  }, value);
};

const replaceEnvironmentPlaceholders = (value, environment) => {
  if (typeof value === 'string') {
    const variable = value.match(PLACEHOLDER)?.[1];
    return variable && environment[variable] !== undefined ? environment[variable] : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceEnvironmentPlaceholders(item, environment));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      replaceEnvironmentPlaceholders(item, environment),
    ]),
  );
};

const unresolvedPlaceholders = (value, names = new Set()) => {
  if (typeof value === 'string') {
    const variable = value.match(PLACEHOLDER)?.[1];
    if (variable) names.add(variable);
  } else if (Array.isArray(value)) {
    for (const item of value) unresolvedPlaceholders(item, names);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) unresolvedPlaceholders(item, names);
  }
  return names;
};

export const loadFixture = async (fixturePath, environment = process.env) => {
  const absolutePath = path.resolve(fixturePath);
  const parsed = JSON.parse(await readFile(absolutePath, 'utf8'));
  const fixture = replaceEnvironmentPlaceholders(parsed, environment);
  if (environment.LOAD_BASE_URL) fixture.baseUrl = environment.LOAD_BASE_URL;
  if (environment.LOAD_SCALE) fixture.scale = Number(environment.LOAD_SCALE);
  return { fixture, fixturePath: absolutePath };
};

export const validateFixture = (fixture) => {
  assertScenario(isRecord(fixture), 'The load fixture must be a JSON object.');
  assertScenario(fixture.version === 1, 'The load fixture version must be 1.');
  assertScenario(typeof fixture.baseUrl === 'string', 'baseUrl is required.');
  let baseUrl;
  try {
    baseUrl = new URL(fixture.baseUrl);
  } catch {
    throw new LoadScenarioError('baseUrl must be an absolute HTTP(S) URL.');
  }
  assertScenario(['http:', 'https:'].includes(baseUrl.protocol), 'baseUrl must use HTTP or HTTPS.');
  assertScenario(!baseUrl.username && !baseUrl.password, 'baseUrl must not contain credentials.');
  const scale = finiteNumber(fixture.scale ?? 1, 'scale', { minimum: 0.01, maximum: 1 });
  const defaults = isRecord(fixture.defaults) ? fixture.defaults : {};
  const timeoutMs = finiteInteger(defaults.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'defaults.timeoutMs', {
    minimum: 100,
    maximum: 120_000,
  });
  const maxErrorRate = finiteNumber(
    defaults.maxErrorRate ?? DEFAULT_MAX_ERROR_RATE,
    'defaults.maxErrorRate',
  );
  assertScenario(isRecord(fixture.scenarios), 'scenarios must be a JSON object.');
  return {
    ...fixture,
    baseUrl: baseUrl.toString().replace(/\/$/, ''),
    scale,
    defaults: { timeoutMs, maxErrorRate },
    scenarios: fixture.scenarios,
  };
};

const requestDescriptor = (descriptor, scenarioName) => {
  assertScenario(isRecord(descriptor), `${scenarioName} contains an invalid request descriptor.`);
  const unresolved = [...unresolvedPlaceholders(descriptor)];
  assertScenario(
    unresolved.length === 0,
    `${scenarioName} requires environment variables: ${unresolved.join(', ')}.`,
  );
  const method = String(descriptor.method ?? 'GET').toUpperCase();
  assertScenario(METHODS.has(method), `${scenarioName} uses an unsupported HTTP method.`);
  assertScenario(
    typeof descriptor.path === 'string' &&
      descriptor.path.startsWith('/api/v1/') &&
      !descriptor.path.startsWith('//'),
    `${scenarioName} request paths must stay under the same-origin /api/v1 namespace.`,
  );
  const headers = descriptor.headers ?? {};
  assertScenario(isRecord(headers), `${scenarioName} request headers must be an object.`);
  for (const [name, value] of Object.entries(headers)) {
    assertScenario(typeof value === 'string', `${scenarioName} header ${name} must be a string.`);
  }
  const diagnosticLabel = descriptor.diagnosticLabel;
  assertScenario(
    diagnosticLabel === undefined || safeExceptionValue(diagnosticLabel) !== null,
    `${scenarioName} diagnosticLabel must be a bounded safe token.`,
  );
  return { ...descriptor, method, headers, diagnosticLabel };
};

const responseErrorCode = (body) => {
  if (!isRecord(body)) return null;
  if (typeof body.code === 'string') return body.code;
  return isRecord(body.error) && typeof body.error.code === 'string' ? body.error.code : null;
};

const safeExceptionValue = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : null;

const requestException = (error) => {
  const signatures = [];
  let current = error;
  for (let depth = 0; depth < 3 && isRecord(current); depth += 1) {
    const signature = [
      safeExceptionValue(current.name),
      safeExceptionValue(current.code),
      safeExceptionValue(current.syscall),
    ].filter(Boolean);
    if (signature.length > 0) signatures.push(signature.join(':'));
    current = current.cause;
  }
  const timeout = signatures.some((signature) => signature.includes('TimeoutError'));
  return {
    failure: timeout ? 'timeout' : 'network-error',
    failureDetail: signatures.join('<-') || 'Error:UNCLASSIFIED',
  };
};

const joinTarget = (baseUrl, requestPath) => {
  const base = new URL(baseUrl);
  const target = new URL(requestPath, base);
  assertScenario(
    target.origin === base.origin,
    'A load request attempted to leave the configured origin.',
  );
  return target;
};

const performRequest = async (
  baseUrl,
  unsafeDescriptor,
  { fetchImpl, timeoutMs, scenarioName, expectedStatuses, expectedErrorCodes = [] },
) => {
  const descriptor = requestDescriptor(unsafeDescriptor, scenarioName);
  const headers = new Headers(descriptor.headers);
  if (descriptor.idempotencyKey) headers.set('Idempotency-Key', descriptor.idempotencyKey);
  let body;
  if (descriptor.body !== undefined) {
    body = typeof descriptor.body === 'string' ? descriptor.body : JSON.stringify(descriptor.body);
    if (!headers.has('content-type')) headers.set('Content-Type', 'application/json');
  }
  const started = performance.now();
  try {
    const response = await fetchImpl(joinTarget(baseUrl, descriptor.path), {
      method: descriptor.method,
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_CHARACTERS) {
      return {
        matched: false,
        status: response.status,
        errorCode: null,
        identity: undefined,
        body: undefined,
        durationMs: performance.now() - started,
        failure: 'response-too-large',
      };
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARACTERS) {
      return {
        matched: false,
        status: response.status,
        errorCode: null,
        identity: undefined,
        body: undefined,
        durationMs: performance.now() - started,
        failure: 'response-too-large',
      };
    }
    let parsed;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    const errorCode = responseErrorCode(parsed);
    return {
      matched: expectedStatuses.includes(response.status) || expectedErrorCodes.includes(errorCode),
      status: response.status,
      errorCode,
      identity: descriptor.responseIdentityPath
        ? getPath(parsed, descriptor.responseIdentityPath)
        : undefined,
      body: parsed,
      durationMs: performance.now() - started,
      failure: null,
    };
  } catch (error) {
    const exception = requestException(error);
    if (descriptor.diagnosticLabel) {
      exception.failureDetail = `${exception.failureDetail}@${descriptor.diagnosticLabel}`;
    }
    return {
      matched: false,
      status: null,
      errorCode: null,
      identity: undefined,
      body: undefined,
      durationMs: performance.now() - started,
      ...exception,
    };
  }
};

const boundedMap = async (items, concurrency, operation) => {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()),
  );
  return results;
};

const percentile = (durations, quantile) => {
  if (durations.length === 0) return 0;
  const sorted = [...durations].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
};

const requestStatistics = (results) => {
  const failures = results.filter((result) => !result.matched);
  return {
    requests: results.length,
    failures: failures.length,
    errorRate: results.length === 0 ? 0 : failures.length / results.length,
    latencyMs: {
      p50: percentile(
        results.map((result) => result.durationMs),
        0.5,
      ),
      p95: percentile(
        results.map((result) => result.durationMs),
        0.95,
      ),
      p99: percentile(
        results.map((result) => result.durationMs),
        0.99,
      ),
      max: Math.max(0, ...results.map((result) => result.durationMs)),
    },
    failuresByKind: Object.fromEntries(
      [
        ...new Set(
          failures.map((result) => result.failure ?? result.errorCode ?? `http-${result.status}`),
        ),
      ]
        .sort()
        .map((kind) => [
          kind,
          failures.filter(
            (result) => (result.failure ?? result.errorCode ?? `http-${result.status}`) === kind,
          ).length,
        ]),
    ),
    failureDetailsByKind: Object.fromEntries(
      [...new Set(failures.map((result) => result.failureDetail).filter(Boolean))]
        .sort()
        .map((detail) => [
          detail,
          failures.filter((result) => result.failureDetail === detail).length,
        ]),
    ),
  };
};

const scaledTarget = (target, scale) => Math.max(1, Math.ceil(target * scale));

const commonScenarioOptions = (configuration, fixture, name) => ({
  fetchImpl: configuration.fetchImpl,
  timeoutMs: finiteInteger(
    configuration.timeoutMs ?? fixture.defaults.timeoutMs,
    `${name}.timeoutMs`,
    { minimum: 100, maximum: 120_000 },
  ),
  scenarioName: name,
  expectedStatuses: Array.isArray(configuration.expectedStatuses)
    ? configuration.expectedStatuses
    : [200],
});

const standardLoad = async ({
  fixture,
  configuration,
  name,
  descriptors,
  concurrency,
  target,
  fetchImpl,
}) => {
  const started = performance.now();
  const options = commonScenarioOptions({ ...configuration, fetchImpl }, fixture, name);
  const results = await boundedMap(descriptors, concurrency, (descriptor) =>
    performRequest(fixture.baseUrl, descriptor, options),
  );
  const statistics = requestStatistics(results);
  const maximumErrorRate = finiteNumber(
    configuration.maxErrorRate ?? fixture.defaults.maxErrorRate,
    `${name}.maxErrorRate`,
  );
  assertScenario(
    statistics.errorRate < maximumErrorRate ||
      (maximumErrorRate === 0 && statistics.errorRate === 0),
    `${name} error rate ${statistics.errorRate.toFixed(4)} did not remain below ${maximumErrorRate.toFixed(4)} (failures: ${JSON.stringify(statistics.failuresByKind)}; details: ${JSON.stringify(statistics.failureDetailsByKind)}).`,
  );
  return {
    target,
    executed: descriptors.length,
    concurrency,
    targetMet: descriptors.length >= target,
    durationMs: performance.now() - started,
    ...statistics,
    results,
  };
};

const runCatalogBrowsing = async (fixture, configuration, fetchImpl) => {
  assertScenario(
    Array.isArray(configuration.requests) && configuration.requests.length > 0,
    'catalogBrowsing.requests is required.',
  );
  const count = scaledTarget(LOAD_TARGETS.catalogBrowsing, fixture.scale);
  const descriptors = Array.from(
    { length: count },
    (_, index) => configuration.requests[index % configuration.requests.length],
  );
  return standardLoad({
    fixture,
    configuration,
    name: 'catalogBrowsing',
    descriptors,
    concurrency: finiteInteger(configuration.concurrency ?? 100, 'catalogBrowsing.concurrency', {
      maximum: 500,
    }),
    target: LOAD_TARGETS.catalogBrowsing,
    fetchImpl,
  });
};

const runCheckoutAttempts = async (fixture, configuration, fetchImpl) => {
  assertScenario(
    Array.isArray(configuration.actors) && configuration.actors.length > 0,
    'checkoutAttempts.actors is required.',
  );
  const desired = scaledTarget(LOAD_TARGETS.checkoutAttempts, fixture.scale);
  const descriptors = configuration.actors.slice(0, desired).map((actor) => ({
    ...actor,
    method: actor.method ?? 'POST',
    responseIdentityPath:
      actor.responseIdentityPath ?? configuration.responseIdentityPath ?? 'data.id',
  }));
  const idempotencyKeys = descriptors.map((descriptor) => descriptor.idempotencyKey);
  assertScenario(
    idempotencyKeys.every((key) => typeof key === 'string' && key.length > 0),
    'Every checkout actor requires an idempotencyKey.',
  );
  assertScenario(
    new Set(idempotencyKeys).size === idempotencyKeys.length,
    'Checkout actors must use distinct idempotency keys.',
  );
  const result = await standardLoad({
    fixture,
    configuration: { ...configuration, expectedStatuses: configuration.expectedStatuses ?? [201] },
    name: 'checkoutAttempts',
    descriptors,
    concurrency: finiteInteger(configuration.concurrency ?? 50, 'checkoutAttempts.concurrency', {
      maximum: 100,
    }),
    target: LOAD_TARGETS.checkoutAttempts,
    fetchImpl,
  });
  const identities = result.results.map((item) => item.identity);
  assertScenario(
    identities.every((identity) => typeof identity === 'string' && identity.length > 0),
    'Every successful checkout response must expose its order identity.',
  );
  assertScenario(
    new Set(identities).size === identities.length,
    'Distinct checkout idempotency keys produced duplicate order identities.',
  );
  return result;
};

const runFinalUnitRace = async (fixture, configuration, fetchImpl) => {
  assertScenario(
    Array.isArray(configuration.actors) && configuration.actors.length >= 2,
    'finalUnitRace requires at least two prepared customer actors.',
  );
  assertScenario(
    isRecord(configuration.verification),
    'finalUnitRace.verification is required to prove the final stock state.',
  );
  const successStatuses = configuration.successStatuses ?? [201];
  const loserStatuses = configuration.loserStatuses ?? [409];
  const loserErrorCodes = configuration.loserErrorCodes ?? ['OUT_OF_STOCK'];
  const started = performance.now();
  const options = commonScenarioOptions(
    { ...configuration, fetchImpl, expectedStatuses: [...successStatuses, ...loserStatuses] },
    fixture,
    'finalUnitRace',
  );
  const results = await boundedMap(configuration.actors, configuration.actors.length, (actor) =>
    performRequest(fixture.baseUrl, { ...actor, method: actor.method ?? 'POST' }, options),
  );
  const winners = results.filter((result) => successStatuses.includes(result.status));
  const expectedWinners = finiteInteger(
    configuration.expectedWinners ?? 1,
    'finalUnitRace.expectedWinners',
    { maximum: configuration.actors.length },
  );
  const invalidLosers = results.filter(
    (result) =>
      !successStatuses.includes(result.status) &&
      !(loserStatuses.includes(result.status) && loserErrorCodes.includes(result.errorCode)),
  );
  assertScenario(
    invalidLosers.length === 0,
    'The final-unit race returned an unexpected loser response.',
  );
  assertScenario(
    winners.length === expectedWinners,
    `The final-unit race created ${winners.length} winners instead of ${expectedWinners}.`,
  );

  const verification = configuration.verification;
  const verificationResult = await performRequest(fixture.baseUrl, verification, {
    fetchImpl,
    timeoutMs: options.timeoutMs,
    scenarioName: 'finalUnitRace.verification',
    expectedStatuses: verification.expectedStatuses ?? [200],
  });
  assertScenario(verificationResult.matched, 'The final-unit stock verification request failed.');
  const actualValue = getPath(verificationResult.body, verification.responseValuePath);
  assertScenario(
    Object.is(actualValue, verification.expectedValue),
    'The authoritative final-unit stock verification did not match the expected value.',
  );
  return {
    target: LOAD_TARGETS.finalUnitRace,
    executed: results.length,
    targetMet: results.length >= LOAD_TARGETS.finalUnitRace,
    durationMs: performance.now() - started,
    winners: winners.length,
    expectedWinners,
    loserErrorCodes: Object.fromEntries(
      [...new Set(results.map((result) => result.errorCode).filter(Boolean))]
        .sort()
        .map((code) => [code, results.filter((result) => result.errorCode === code).length]),
    ),
    authoritativeRemainingValue: actualValue,
  };
};

const runRepeatedIdempotency = async (fixture, configuration, fetchImpl) => {
  assertScenario(isRecord(configuration.request), 'repeatedIdempotency.request is required.');
  assertScenario(
    typeof configuration.request.idempotencyKey === 'string' &&
      configuration.request.idempotencyKey.length > 0,
    'repeatedIdempotency requires one fixed idempotency key.',
  );
  const repetitions = scaledTarget(LOAD_TARGETS.repeatedIdempotency, fixture.scale);
  const descriptor = {
    ...configuration.request,
    method: configuration.request.method ?? 'POST',
    responseIdentityPath:
      configuration.request.responseIdentityPath ?? configuration.responseIdentityPath ?? 'data.id',
  };
  const result = await standardLoad({
    fixture,
    configuration: { ...configuration, expectedStatuses: configuration.expectedStatuses ?? [201] },
    name: 'repeatedIdempotency',
    descriptors: Array.from({ length: repetitions }, () => descriptor),
    concurrency: finiteInteger(
      configuration.concurrency ?? repetitions,
      'repeatedIdempotency.concurrency',
      { maximum: 100 },
    ),
    target: LOAD_TARGETS.repeatedIdempotency,
    fetchImpl,
  });
  const identities = result.results.map((item) => item.identity);
  assertScenario(
    identities.every((identity) => typeof identity === 'string' && identity.length > 0),
    'Every idempotent replay must return an order identity.',
  );
  assertScenario(
    new Set(identities).size === 1,
    'Repeated use of one idempotency key produced multiple order identities.',
  );
  return { ...result, uniqueOrderIdentities: 1 };
};

const runAdminOrderList = async (fixture, configuration, fetchImpl) => {
  assertScenario(isRecord(configuration.request), 'adminOrderList.request is required.');
  const count = scaledTarget(LOAD_TARGETS.adminOrderList, fixture.scale);
  return standardLoad({
    fixture,
    configuration,
    name: 'adminOrderList',
    descriptors: Array.from({ length: count }, () => configuration.request),
    concurrency: finiteInteger(configuration.concurrency ?? 25, 'adminOrderList.concurrency', {
      maximum: 100,
    }),
    target: LOAD_TARGETS.adminOrderList,
    fetchImpl,
  });
};

const metricValue = (response, pathName, label) => {
  const value = getPath(response.body, pathName);
  assertScenario(
    Number.isSafeInteger(value) && value >= 0,
    `Worker metrics did not contain a safe ${label}.`,
  );
  return value;
};

const readWorkerMetrics = async (fixture, configuration, fetchImpl, timeoutMs) => {
  const response = await performRequest(fixture.baseUrl, configuration.metricsRequest, {
    fetchImpl,
    timeoutMs,
    scenarioName: 'workerBacklogRecovery.metricsRequest',
    expectedStatuses: configuration.metricsRequest.expectedStatuses ?? [200],
  });
  assertScenario(response.matched, 'The operational metrics request failed.');
  return {
    response,
    backlog: metricValue(
      response,
      configuration.backlogPath ?? 'data.outbox.actionableBacklog',
      'actionable backlog count',
    ),
    processed: metricValue(
      response,
      configuration.processedPath ?? 'data.outbox.PROCESSED',
      'processed count',
    ),
    deadLetter: metricValue(
      response,
      configuration.deadLetterPath ?? 'data.outbox.DEAD_LETTER',
      'dead-letter count',
    ),
    workerState: getPath(response.body, configuration.workerStatePath ?? 'data.worker.state'),
  };
};

const runWorkerBacklogRecovery = async (fixture, configuration, fetchImpl, sleep) => {
  assertScenario(
    isRecord(configuration.metricsRequest),
    'workerBacklogRecovery.metricsRequest is required.',
  );
  const timeoutMs = finiteInteger(
    configuration.timeoutMs ?? fixture.defaults.timeoutMs,
    'workerBacklogRecovery.timeoutMs',
    { minimum: 100, maximum: 120_000 },
  );
  const recoveryTimeoutMs = finiteInteger(
    configuration.recoveryTimeoutMs ?? 60_000,
    'workerBacklogRecovery.recoveryTimeoutMs',
    { minimum: 100, maximum: 600_000 },
  );
  const pollIntervalMs = finiteInteger(
    configuration.pollIntervalMs ?? 2_500,
    'workerBacklogRecovery.pollIntervalMs',
    { minimum: 10, maximum: 30_000 },
  );
  const baseline = await readWorkerMetrics(fixture, configuration, fetchImpl, timeoutMs);
  const triggers = Array.isArray(configuration.triggerRequests)
    ? configuration.triggerRequests
    : [];
  if (triggers.length === 0 && baseline.backlog === 0) {
    return {
      skipped: true,
      reason:
        'No trigger requests were configured and no existing actionable backlog was available.',
    };
  }
  let triggerStatistics = null;
  if (triggers.length > 0) {
    const triggerResult = await standardLoad({
      fixture,
      configuration: {
        ...configuration,
        expectedStatuses: configuration.triggerExpectedStatuses ?? [200, 201, 202],
        maxErrorRate: 0,
      },
      name: 'workerBacklogRecovery.triggers',
      descriptors: triggers,
      concurrency: finiteInteger(
        configuration.triggerConcurrency ?? Math.min(20, triggers.length),
        'workerBacklogRecovery.triggerConcurrency',
        { maximum: 100 },
      ),
      target: triggers.length,
      fetchImpl,
    });
    triggerStatistics = {
      requests: triggerResult.requests,
      failures: triggerResult.failures,
      latencyMs: triggerResult.latencyMs,
    };
  }
  const minimumProcessedIncrease = finiteInteger(
    configuration.minimumProcessedIncrease ?? Math.max(1, triggers.length),
    'workerBacklogRecovery.minimumProcessedIncrease',
    { maximum: 100_000 },
  );
  const allowedDeadLetterIncrease = finiteInteger(
    configuration.allowedDeadLetterIncrease ?? 0,
    'workerBacklogRecovery.allowedDeadLetterIncrease',
    { minimum: 0, maximum: 100_000 },
  );
  const requiredProcessed = baseline.processed + minimumProcessedIncrease;
  const maximumFinalBacklog = finiteInteger(
    configuration.maximumFinalBacklog ?? baseline.backlog,
    'workerBacklogRecovery.maximumFinalBacklog',
    { minimum: 0, maximum: 100_000 },
  );
  const started = performance.now();
  let maximumObservedBacklog = baseline.backlog;
  let current = baseline;
  while (performance.now() - started <= recoveryTimeoutMs) {
    current = await readWorkerMetrics(fixture, configuration, fetchImpl, timeoutMs);
    maximumObservedBacklog = Math.max(maximumObservedBacklog, current.backlog);
    const processedEnough = current.processed >= requiredProcessed;
    const drained = current.backlog <= maximumFinalBacklog;
    const deadLettersSafe = current.deadLetter - baseline.deadLetter <= allowedDeadLetterIncrease;
    if (processedEnough && drained && deadLettersSafe && current.workerState === 'HEALTHY') {
      return {
        target: LOAD_TARGETS.workerBacklogRecovery,
        executed: triggers.length,
        targetMet: true,
        durationMs: performance.now() - started,
        baseline: {
          actionableBacklog: baseline.backlog,
          processed: baseline.processed,
          deadLetter: baseline.deadLetter,
        },
        final: {
          actionableBacklog: current.backlog,
          processed: current.processed,
          deadLetter: current.deadLetter,
          workerState: current.workerState,
        },
        maximumObservedBacklog,
        triggerStatistics,
      };
    }
    await sleep(pollIntervalMs);
  }
  throw new LoadScenarioError(
    `Worker backlog did not recover within ${recoveryTimeoutMs}ms (backlog=${current.backlog}, processedDelta=${current.processed - baseline.processed}, deadLetterDelta=${current.deadLetter - baseline.deadLetter}, workerState=${String(current.workerState)}).`,
  );
};

const scenarioRunner = {
  catalogBrowsing: runCatalogBrowsing,
  checkoutAttempts: runCheckoutAttempts,
  finalUnitRace: runFinalUnitRace,
  repeatedIdempotency: runRepeatedIdempotency,
  adminOrderList: runAdminOrderList,
  workerBacklogRecovery: runWorkerBacklogRecovery,
};

const publicResult = (result) => {
  if (!isRecord(result)) return result;
  const safe = { ...result };
  delete safe.results;
  delete safe.response;
  return safe;
};

export const runLoadSuite = async (
  unsafeFixture,
  {
    fetchImpl = globalThis.fetch,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {},
) => {
  assertScenario(typeof fetchImpl === 'function', 'A Fetch-compatible implementation is required.');
  const fixture = validateFixture(unsafeFixture);
  const results = [];
  for (const name of SCENARIO_ORDER) {
    const configuration = fixture.scenarios[name];
    if (!isRecord(configuration) || configuration.enabled !== true) {
      results.push({
        name,
        status: 'skipped',
        target: LOAD_TARGETS[name],
        reason:
          isRecord(configuration) && typeof configuration.reason === 'string'
            ? configuration.reason
            : 'Disabled in the selected fixture.',
      });
      continue;
    }
    try {
      const result = await scenarioRunner[name](fixture, configuration, fetchImpl, sleep);
      if (result?.skipped) {
        results.push({
          name,
          status: 'skipped',
          target: LOAD_TARGETS[name],
          reason: result.reason,
        });
      } else {
        results.push({
          name,
          status: result.targetMet ? 'passed_at_target' : 'passed_reduced_scale',
          ...publicResult(result),
        });
      }
    } catch (error) {
      results.push({
        name,
        status: 'failed',
        target: LOAD_TARGETS[name],
        reason:
          error instanceof LoadScenarioError ? error.message : 'Unexpected load-runner failure.',
      });
    }
  }
  const failed = results.filter((result) => result.status === 'failed').length;
  const skipped = results.filter((result) => result.status === 'skipped').length;
  const reduced = results.filter((result) => result.status === 'passed_reduced_scale').length;
  return {
    version: 1,
    status:
      failed > 0
        ? 'failed'
        : skipped === results.length
          ? 'skipped'
          : reduced > 0 || skipped > 0
            ? 'partial'
            : 'passed',
    targetEnvironment: fixture.baseUrl,
    scale: fixture.scale,
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    summary: {
      scenarios: results.length,
      failed,
      skipped,
      reduced,
      passedAtTarget: results.length - failed - skipped - reduced,
    },
    scenarios: results,
  };
};
