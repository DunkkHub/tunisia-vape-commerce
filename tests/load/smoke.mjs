import { fileURLToPath } from 'node:url';
import { loadFixture, runLoadSuite } from './lib/load-runner.mjs';

const defaultFixture = fileURLToPath(new URL('./fixture.example.json', import.meta.url));
const fixturePath = process.env.LOAD_FIXTURE_PATH ?? defaultFixture;
const requireAll = process.env.LOAD_REQUIRE_ALL === 'true';

try {
  const { fixture, fixturePath: resolvedFixturePath } = await loadFixture(fixturePath);
  const report = await runLoadSuite(fixture);
  process.stdout.write(
    `${JSON.stringify(
      {
        ...report,
        fixture: resolvedFixturePath,
        strictTargetRequirement: requireAll,
      },
      null,
      2,
    )}\n`,
  );
  if (
    report.status === 'failed' ||
    (requireAll && report.scenarios.some((scenario) => scenario.status !== 'passed_at_target'))
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      status: 'configuration_failed',
      fixture: fixturePath,
      reason: error instanceof Error ? error.message : 'Unknown load-runner error.',
    })}\n`,
  );
  process.exitCode = 1;
}
