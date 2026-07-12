const target = process.env.TARGET_URL ?? 'http://localhost:3000/api/v1/health/live';
const concurrency = Number.parseInt(process.env.LOAD_CONCURRENCY ?? '20', 10);
const requests = Number.parseInt(process.env.LOAD_REQUESTS ?? '100', 10);

const started = performance.now();
let failures = 0;

for (let offset = 0; offset < requests; offset += concurrency) {
  const batch = Array.from({ length: Math.min(concurrency, requests - offset) }, async () => {
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) failures += 1;
    } catch {
      failures += 1;
    }
  });
  await Promise.all(batch);
}

const durationMs = performance.now() - started;
const errorRate = failures / requests;
console.log(JSON.stringify({ target, requests, concurrency, failures, errorRate, durationMs }));
if (errorRate >= 0.01) process.exitCode = 1;
