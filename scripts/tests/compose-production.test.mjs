import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const composeServiceBlock = (source, service) => {
  const match = source.match(
    new RegExp(`^  ${service}:\\r?\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|^secrets:)`, 'mu'),
  );
  assert.ok(match, `Missing Compose service ${service}`);
  return match[0];
};

test('migration and production Compose wiring preserve least privilege and private data services', async () => {
  const [
    base,
    production,
    productionEnvironment,
    gateway,
    apiDockerfile,
    workerDockerfile,
    dockerignore,
    migrationRuntimeManifest,
  ] = await Promise.all([
    readFile(new URL('../../docker-compose.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../docker-compose.production.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../.env.production.example', import.meta.url), 'utf8'),
    readFile(
      new URL('../../docker/nginx/production-gateway.conf.template', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../../docker/Dockerfile.api', import.meta.url), 'utf8'),
    readFile(new URL('../../docker/Dockerfile.worker', import.meta.url), 'utf8'),
    readFile(new URL('../../.dockerignore', import.meta.url), 'utf8'),
    readFile(new URL('../../packages/migration-runtime/package.json', import.meta.url), 'utf8'),
  ]);
  assert.match(
    base,
    /migrate:[\s\S]*DATABASE_URL: \$\{DATABASE_MIGRATION_URL:-mysql:\/\/migration_user/,
  );
  assert.match(production, /mysql:[\s\S]*ports: !reset \[\]/);
  assert.match(production, /redis:[\s\S]*ports: !reset \[\]/);
  for (const localService of ['minio', 'minio-init', 'mailpit']) {
    assert.match(
      composeServiceBlock(production, localService),
      /profiles: \['local-dependencies'\]/,
    );
  }
  for (const applicationService of ['api', 'worker']) {
    const block = composeServiceBlock(production, applicationService);
    assert.match(block, /depends_on: !override/);
    assert.match(block, /migrate:[\s\S]*condition: service_completed_successfully/);
    assert.match(block, /redis:[\s\S]*condition: service_healthy/);
    assert.doesNotMatch(block, /minio|mailpit/);
  }
  assert.match(production, /DATABASE_URL: \$\{DATABASE_MIGRATION_URL:\?/);
  assert.match(production, /health\/ready/);
  assert.match(production, /ADMIN_WEB_URL: \$\{ADMIN_WEB_URL:\?/);
  assert.match(production, /OPENAPI_ENABLED: \$\{OPENAPI_ENABLED:-false\}/);
  assert.match(production, /CATALOG_IMPORT_MEDIA_HOSTS: \$\{CATALOG_IMPORT_MEDIA_HOSTS:-\}/);
  assert.match(production, /production-gateway\.conf\.template/);
  assert.match(production, /STOREFRONT_HOST: \$\{STOREFRONT_HOST:\?/);
  assert.match(production, /ADMIN_HOST: \$\{ADMIN_HOST:\?/);
  assert.match(gateway, /server_name \$\{STOREFRONT_HOST\}/);
  assert.match(gateway, /server_name \$\{ADMIN_HOST\}/);
  assert.match(gateway, /\^\/admin\(\?:\/\|\$\)/);
  assert.match(gateway, /auth\/admin/);
  assert.match(gateway, /api\/docs/);
  assert.match(
    gateway,
    /catalog\/imports\/\[\^\/\]\+\/media\/apply\$ \{[\s\S]*proxy_read_timeout 7200s;/,
  );
  assert.match(gateway, /location \/api\/ \{[\s\S]*proxy_read_timeout 30s;/);
  assert.match(gateway, /server_name _;[\s\S]*return 444;/);
  assert.match(
    apiDockerfile,
    /pnpm --filter @vape\/migration-runtime deploy --prod --legacy \/opt\/migration[\s\S]*FROM \$\{NODE_IMAGE\} AS migration[\s\S]*rm -rf \/usr\/local\/lib\/node_modules\/npm \/usr\/local\/bin\/npm \/usr\/local\/bin\/npx[\s\S]*COPY --from=build --chown=node:node \/opt\/migration \.\/[\s\S]*USER node[\s\S]*CMD \["node", "node_modules\/prisma\/build\/index\.js", "migrate", "deploy", "--schema=\/app\/prisma\/schema\.prisma"\]/,
  );
  assert.doesNotMatch(apiDockerfile, /FROM build AS migration/);
  assert.doesNotMatch(apiDockerfile, /CMD \["pnpm", "prisma:migrate:deploy"\]/);
  assert.deepEqual(JSON.parse(migrationRuntimeManifest).dependencies, { prisma: '6.19.3' });
  for (const dockerfile of [apiDockerfile, workerDockerfile]) {
    assert.match(
      dockerfile,
      /deploy --prod --legacy \/opt\/[a-z]+[\s\S]*node \/workspace\/node_modules\/prisma\/build\/index\.js generate --schema=prisma\.schema/,
    );
  }
  assert.doesNotMatch(production, /change_me|development-only/);
  assert.match(productionEnvironment, /^DATABASE_BACKUP_URL=mysql:\/\/backup_user:/mu);
  assert.match(productionEnvironment, /^BACKUP_ENCRYPTION_MODE=aes-256-gcm$/mu);
  assert.match(productionEnvironment, /^MYSQL_TLS_MODE=VERIFY_IDENTITY$/mu);
  assert.match(productionEnvironment, /^RESTORE_TARGET_IS_DISPOSABLE=false$/mu);
  assert.match(productionEnvironment, /^RESTORE_DRILL_TARGET_IS_ISOLATED=false$/mu);
  assert.doesNotMatch(productionEnvironment, /^DATABASE_RESTORE_URL=\S+/mu);
  assert.doesNotMatch(productionEnvironment, /^RESTORE_DRILL_ADMIN_URL=\S+/mu);
  assert.match(dockerignore, /^secrets$/m);
  assert.match(dockerignore, /^\*\*\/secrets$/m);
  assert.match(dockerignore, /^uploads$/m);
  assert.match(dockerignore, /^\*\*\/uploads$/m);
});
