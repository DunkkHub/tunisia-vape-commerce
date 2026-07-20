import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('migration and production Compose wiring preserve least privilege and private data services', async () => {
  const [base, production, gateway, apiDockerfile, workerDockerfile] = await Promise.all([
    readFile(new URL('../../docker-compose.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../docker-compose.production.yml', import.meta.url), 'utf8'),
    readFile(
      new URL('../../docker/nginx/production-gateway.conf.template', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../../docker/Dockerfile.api', import.meta.url), 'utf8'),
    readFile(new URL('../../docker/Dockerfile.worker', import.meta.url), 'utf8'),
  ]);
  assert.match(
    base,
    /migrate:[\s\S]*DATABASE_URL: \$\{DATABASE_MIGRATION_URL:-mysql:\/\/migration_user/,
  );
  assert.match(production, /mysql:[\s\S]*ports: !reset \[\]/);
  assert.match(production, /redis:[\s\S]*ports: !reset \[\]/);
  assert.match(production, /DATABASE_URL: \$\{DATABASE_MIGRATION_URL:\?/);
  assert.match(production, /health\/ready/);
  assert.match(production, /ADMIN_WEB_URL: \$\{ADMIN_WEB_URL:\?/);
  assert.match(production, /OPENAPI_ENABLED: \$\{OPENAPI_ENABLED:-false\}/);
  assert.match(production, /production-gateway\.conf\.template/);
  assert.match(production, /STOREFRONT_HOST: \$\{STOREFRONT_HOST:\?/);
  assert.match(production, /ADMIN_HOST: \$\{ADMIN_HOST:\?/);
  assert.match(gateway, /server_name \$\{STOREFRONT_HOST\}/);
  assert.match(gateway, /server_name \$\{ADMIN_HOST\}/);
  assert.match(gateway, /\^\/admin\(\?:\/\|\$\)/);
  assert.match(gateway, /auth\/admin/);
  assert.match(gateway, /api\/docs/);
  assert.match(gateway, /server_name _;[\s\S]*return 444;/);
  assert.match(
    apiDockerfile,
    /FROM build AS migration[\s\S]*USER node[\s\S]*CMD \["node", "node_modules\/prisma\/build\/index\.js", "migrate", "deploy"\]/,
  );
  assert.doesNotMatch(apiDockerfile, /CMD \["pnpm", "prisma:migrate:deploy"\]/);
  for (const dockerfile of [apiDockerfile, workerDockerfile]) {
    assert.match(
      dockerfile,
      /deploy --prod --legacy \/opt\/[a-z]+[\s\S]*node \/workspace\/node_modules\/prisma\/build\/index\.js generate --schema=prisma\.schema/,
    );
  }
  assert.doesNotMatch(production, /change_me|development-only/);
});
