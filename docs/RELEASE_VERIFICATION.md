# Release verification

`pnpm verify:release` is the definitive local software-release check. It is cross-platform, stops
at the first failure, does not change application configuration, and has no legal-approval gate.

> Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside
> the software production-readiness assessment.

## Prerequisites

- Use the Node.js version accepted by `package.json` and the exact Corepack-managed pnpm version.
- Install Playwright Chromium once with
  `pnpm --filter @vape/web exec playwright install --with-deps chromium` on Linux CI, or
  `pnpm --filter @vape/web exec playwright install chromium` on a prepared local workstation.
- Provide a disposable MySQL 8 server through three URLs: an administrative identity allowed to
  create/drop test databases, a migration identity, and a separate DML-only runtime identity.
- Provide disposable Redis URLs that explicitly select database 15 for integration tests and
  database 14 for the operational browser test. Never point these variables at production or a
  shared non-disposable database.

Required variable names are:

```text
TEST_DATABASE_ADMIN_URL
DATABASE_MIGRATION_URL
DATABASE_URL
TEST_REDIS_URL
TEST_E2E_REDIS_URL
```

The wrapper injects `NODE_ENV=test` only into its disposable integration and operational-browser
stages. Callers do not need to set it globally, and an inherited production value cannot make those
destructive test guards ambiguous.

The command validates only variable structure and never prints their values. Inspect the exact
ordered stages without executing them with `pnpm verify:release --list`.

## Real browser commerce path

`pnpm test:e2e` keeps the fast route-mocked visual and navigation regressions. Run
`pnpm test:e2e:operational` for the non-mocked path. It creates a generated `vape_e2e_*` database,
applies every migration, runs the structural seed, creates test-only sellable inventory, delivery
configuration, a courier and three disposable administrators, builds and starts the real API and
web applications, and then drives customer registration/login, French and Arabic RTL catalog
filtering, mobile navigation, cart mutation, keyboard checkout navigation, atomic COD checkout and
retry, customer order history, mandatory administrator TOTP, product create/edit, inventory
receipt, fulfillment, delivery, COD collection, independent reconciliation, CSV exports,
checkout/maintenance gates and a denied-permission role through Chromium. It verifies persisted
order, reservation, inventory, COD, consent, notification and TOTP state before dropping the
database and flushing Redis database 14.

The fixture command is deliberately unusable by accident: `NODE_ENV` must equal `test`,
`DATABASE_URL` must name the generated disposable database, the database must contain no users or
products, and `OPERATIONAL_E2E_FIXTURE_CONFIRM` must exactly equal
`CREATE_DISPOSABLE_OPERATIONAL_E2E_FIXTURE`. The runner generates credentials in memory and never
creates a default administrator or modifies the structural seed. Do not run the fixture command
directly except when developing the disposable runner itself.

## Local gate order

The command runs frozen installation, Prisma generation, formatting, linting, strict type checks,
Prisma validation, a non-mutating high-severity dependency audit, API/web/worker unit tests, the
disposable MySQL/Redis migration-and-seed integration harness, security and operational-tooling
tests, production builds, and Playwright tests. Any missing prerequisite or failed stage makes the
command fail.

## Latest recorded local result

On 2026-07-20, the complete 14-stage command passed in 762 seconds on the final combined worktree
using MySQL 8.4, dedicated
migration/runtime identities, Redis database 15 for integration and database 14 for operational
browser coverage. It recorded no known high-severity dependency vulnerability; 268 API, 36 web,
and 29 worker unit tests; 10 integration tests; 6 security tests; 20 operational-tool tests; every
production build; 8 fast Playwright passes with 2 intentional project-matrix skips; and the complete
real-service operational browser scenario in 42.9 seconds (47.0-second suite). The structural seed
created 9 roles, 42 permissions and 24 governorates, with no users, administrators or products.

The same revision family also passed all runtime container builds. A clean Compose database applied
all six migrations, the API/worker/web/gateway and required services became healthy, and the live
deployment smoke passed through Nginx. See `PRODUCTION_READINESS_REPORT.md` for the exact load,
backup/restore and container evidence. Rerun `pnpm verify:release` on the exact promoted commit and
retain the CI-owned evidence below; an earlier local pass is not a substitute for commit-specific
promotion evidence.

## CI-owned gates

Some release checks require privileged GitHub runners or security-report upload permissions and
are therefore delegated to mandatory workflows rather than silently skipped locally:

| Workflow job                            | Release evidence                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `CI / test`                             | Clean MySQL 8.4 migration, structural seed through the disposable harness, unit, integration, security and operations tests |
| `CI / build`                            | API, worker and web production builds                                                                                       |
| `CI / e2e`                              | Workspace-scoped Playwright installation, fast mocked regressions and disposable real-service commerce/TOTP/RBAC path       |
| `CI / docker`                           | API, worker and web runtime-container builds                                                                                |
| `Security / dependency-and-secret-scan` | Frozen dependency audit and Gitleaks secret scan                                                                            |
| `Security / codeql`                     | JavaScript/TypeScript CodeQL analysis                                                                                       |
| `Security / image-scan-and-sbom`        | Trivy image scanning and SPDX JSON SBOM artifacts for every runtime image                                                   |

A release candidate passes only when `pnpm verify:release` and every applicable CI/Security job
for the same commit pass. Backup drills, target-environment smoke/load exercises, and deployment
approval remain separately recorded operational evidence; this command does not fabricate them.
