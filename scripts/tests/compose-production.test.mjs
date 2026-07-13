import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('migration and production Compose wiring preserve least privilege and private data services', async () => {
  const [base, production] = await Promise.all([
    readFile(new URL('../../docker-compose.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../docker-compose.production.yml', import.meta.url), 'utf8'),
  ]);
  assert.match(
    base,
    /migrate:[\s\S]*DATABASE_URL: \$\{DATABASE_MIGRATION_URL:-mysql:\/\/migration_user/,
  );
  assert.match(production, /mysql:[\s\S]*ports: !reset \[\]/);
  assert.match(production, /redis:[\s\S]*ports: !reset \[\]/);
  assert.match(production, /DATABASE_URL: \$\{DATABASE_MIGRATION_URL:\?/);
  assert.match(production, /health\/ready/);
  assert.doesNotMatch(production, /change_me|development-only/);
});
