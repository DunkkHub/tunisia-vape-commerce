import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);

test('release verification injects test mode into every disposable application stage', async () => {
  const { stdout } = await execute(process.execPath, ['scripts/verify-release.mjs', '--list'], {
    cwd: new URL('../..', import.meta.url),
    windowsHide: true,
  });
  const result = JSON.parse(stdout);
  const disposableStages = result.stages.filter(({ name }) => name.startsWith('Disposable '));

  assert.equal(disposableStages.length, 2);
  for (const stage of disposableStages) {
    assert.deepEqual(stage.environment, { NODE_ENV: 'test' });
  }
});
