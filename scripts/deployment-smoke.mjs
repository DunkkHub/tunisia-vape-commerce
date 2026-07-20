import { parseSmokeBoolean, runDeploymentSmoke } from './lib/deployment-smoke.mjs';

if (process.argv.length > 2) {
  throw new Error('Usage: pnpm smoke:deployment');
}
const timeout = Number(process.env.SMOKE_TIMEOUT_MS ?? '10000');
const result = await runDeploymentSmoke({
  webUrl: process.env.SMOKE_WEB_URL ?? process.env.COMPOSE_WEB_URL ?? 'http://127.0.0.1:8080',
  adminWebUrl:
    process.env.SMOKE_ADMIN_WEB_URL ??
    process.env.SMOKE_WEB_URL ??
    process.env.COMPOSE_WEB_URL ??
    'http://127.0.0.1:8080',
  apiUrl: process.env.SMOKE_API_URL ?? process.env.PUBLIC_API_URL ?? 'http://127.0.0.1:3000/api/v1',
  allowInsecureHttp: process.env.SMOKE_ALLOW_INSECURE_HTTP,
  timeoutMilliseconds: timeout,
  expectedCheckoutEnabled: parseSmokeBoolean(
    process.env.SMOKE_EXPECT_CHECKOUT_ENABLED,
    'SMOKE_EXPECT_CHECKOUT_ENABLED',
  ),
  requireCheckoutReady:
    parseSmokeBoolean(
      process.env.SMOKE_REQUIRE_CHECKOUT_READY ?? 'true',
      'SMOKE_REQUIRE_CHECKOUT_READY',
    ) ?? true,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
