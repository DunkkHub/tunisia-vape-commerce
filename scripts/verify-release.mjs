import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageManifest = JSON.parse(
  await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
);

const requiredEnvironment = [
  'TEST_DATABASE_ADMIN_URL',
  'DATABASE_MIGRATION_URL',
  'DATABASE_URL',
  'TEST_REDIS_URL',
  'TEST_E2E_REDIS_URL',
];

const stages = [
  { name: 'Frozen dependency installation', arguments: ['install', '--frozen-lockfile'] },
  { name: 'Prisma client generation', arguments: ['prisma:generate'] },
  { name: 'Formatting', arguments: ['format:check'] },
  { name: 'Linting', arguments: ['lint'] },
  { name: 'Type checking', arguments: ['typecheck'] },
  { name: 'Prisma schema validation', arguments: ['prisma:validate'] },
  { name: 'High-severity dependency audit', arguments: ['audit', '--audit-level=high'] },
  { name: 'Unit tests', arguments: ['test:unit'] },
  {
    name: 'Disposable MySQL and Redis integration tests',
    arguments: ['test:integration'],
    environment: { NODE_ENV: 'test' },
  },
  { name: 'Security regression tests', arguments: ['test:security'] },
  { name: 'Operational tooling tests', arguments: ['test:operations'] },
  { name: 'Production builds', arguments: ['build'] },
  { name: 'Fast Playwright browser regressions', arguments: ['test:e2e'] },
  {
    name: 'Disposable operational Playwright path',
    arguments: ['test:e2e:operational'],
    environment: { NODE_ENV: 'test' },
  },
];

const usage =
  `Usage: pnpm verify:release [--list]\n\n` +
  'Runs every local release-verification stage without skipping failures.\n' +
  'Use --list to inspect the ordered stages and required environment variable names.';

const argument = process.argv[2];
if (argument && !['--help', '--list'].includes(argument)) {
  throw new Error(`Unknown argument: ${argument}\n${usage}`);
}
if (process.argv.length > 3) throw new Error(usage);

if (argument === '--help') {
  process.stdout.write(`${usage}\n`);
  process.exit(0);
}

if (argument === '--list') {
  process.stdout.write(
    `${JSON.stringify(
      {
        packageManager: packageManifest.packageManager,
        requiredEnvironment,
        stages: stages.map(({ name, arguments: stageArguments, environment }) => ({
          name,
          command: ['pnpm', ...stageArguments].join(' '),
          ...(environment ? { environment } : {}),
        })),
        delegatedCiGates: ['container-builds', 'codeql', 'gitleaks', 'trivy', 'sbom'],
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

const expectedPnpmVersion = String(packageManifest.packageManager ?? '').match(/^pnpm@(.+)$/)?.[1];
const actualPnpmVersion = process.env.npm_config_user_agent?.match(/^pnpm\/([^\s]+)/)?.[1];
if (!expectedPnpmVersion || actualPnpmVersion !== expectedPnpmVersion) {
  throw new Error(
    `Release verification requires ${String(packageManifest.packageManager)} through Corepack; ` +
      `received ${actualPnpmVersion ? `pnpm@${actualPnpmVersion}` : 'an unknown package manager'}`,
  );
}

const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
if (missingEnvironment.length > 0) {
  throw new Error(
    `Release verification requires these disposable-test variables: ${missingEnvironment.join(', ')}`,
  );
}

const safeUrl = (name) => {
  try {
    return new URL(process.env[name]);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
};

for (const name of ['TEST_DATABASE_ADMIN_URL', 'DATABASE_MIGRATION_URL', 'DATABASE_URL']) {
  const value = safeUrl(name);
  if (value.protocol !== 'mysql:') throw new Error(`${name} must use the mysql protocol`);
}
const testRedis = safeUrl('TEST_REDIS_URL');
if (!['redis:', 'rediss:'].includes(testRedis.protocol) || testRedis.pathname !== '/15') {
  throw new Error('TEST_REDIS_URL must use redis or rediss and explicitly select database 15');
}
const testE2eRedis = safeUrl('TEST_E2E_REDIS_URL');
if (!['redis:', 'rediss:'].includes(testE2eRedis.protocol) || testE2eRedis.pathname !== '/14') {
  throw new Error('TEST_E2E_REDIS_URL must use redis or rediss and explicitly select database 14');
}

const runPnpm = (stageArguments, stageEnvironment = {}) =>
  new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    const executable = windows ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm';
    const arguments_ = windows
      ? ['/d', '/s', '/c', path.join(repositoryRoot, 'pnpm.cmd'), ...stageArguments]
      : stageArguments;
    const child = spawn(executable, arguments_, {
      cwd: repositoryRoot,
      env: { ...process.env, ...stageEnvironment },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`pnpm was terminated by ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`pnpm exited with code ${String(code)}`));
    });
  });

for (const [index, stage] of stages.entries()) {
  process.stdout.write(`\n[verify:release ${index + 1}/${stages.length}] ${stage.name}\n`);
  try {
    await runPnpm(stage.arguments, stage.environment);
  } catch (error) {
    throw new Error(`Release verification failed during: ${stage.name}`, { cause: error });
  }
}

process.stdout.write(
  '\nLocal release verification passed. CI-managed container and supply-chain gates must also pass.\n',
);
