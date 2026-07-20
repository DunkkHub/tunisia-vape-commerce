import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const runner = fileURLToPath(new URL('./run-disposable-load.mjs', import.meta.url));

const invoke = (environment) =>
  spawnSync(process.execPath, [runner], {
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      ...environment,
    },
    encoding: 'utf8',
    timeout: 10_000,
  });

test('refuses to create a fixture outside NODE_ENV=test', () => {
  const result = invoke({
    NODE_ENV: 'development',
    DISPOSABLE_LOAD_CONFIRM: 'RUN_DISPOSABLE_FULL_TARGET_LOAD',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires NODE_ENV=test/);
});

test('requires the exact destructive-fixture confirmation before reading infrastructure URLs', () => {
  const result = invoke({ NODE_ENV: 'test', DISPOSABLE_LOAD_CONFIRM: 'wrong' });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Set DISPOSABLE_LOAD_CONFIRM=RUN_DISPOSABLE_FULL_TARGET_LOAD exactly/,
  );
  assert.doesNotMatch(result.stderr, /TEST_DATABASE_ADMIN_URL is required/);
});

test('requires explicitly supplied disposable infrastructure after both safety guards pass', () => {
  const result = invoke({
    NODE_ENV: 'test',
    DISPOSABLE_LOAD_CONFIRM: 'RUN_DISPOSABLE_FULL_TARGET_LOAD',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /TEST_DATABASE_ADMIN_URL is required/);
});
