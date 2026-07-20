# Production readiness report

Review date: 2026-07-20

## Verdict vocabulary

The only overall verdict issued by this report is `NOT READY`.

## Executive assessment

The software release candidate now implements and locally verifies the required storefront,
customer account, atomic COD checkout, catalog/media, inventory, order, manual delivery, cash
custody, settings, notification, administrator, localization, backup, load, and deployment
workflows. Customer and administrator authentication remain separate security realms and no
administrator, customer, product, stock, order, or credential is created by the structural seed.

The current overall verdict remains **NOT READY** for a purchaser's live deployment. The remaining
conditions are target-environment and operator configuration: real store identity/contact values,
at least one complete active delivery method and price, production secrets and hosts, TLS, object
storage, notification-provider credentials, protected backup destinations/keys, monitoring targets,
the interactive first administrator, and successful mandatory CI/security jobs for the promoted
commit. The repository does not fabricate those deployment inputs.

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

Legal review, approval metadata, and legal-document publication are not startup, health, checkout,
or engineering-verdict inputs. No legal opinion or approval is asserted.

## Launch and checkout state

| Input or derived result                 | Final value                                  | Source/evidence                                                       |
| --------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| `CHECKOUT_ENABLED`                      | `true`                                       | API environment schema, Compose, examples                             |
| `checkout.enabled`                      | `true`                                       | Structural seed; existing operator values are preserved               |
| effective `CHECKOUT_DISABLED`           | `false`                                      | Derived; there is no executable `CHECKOUT_DISABLED` environment input |
| `MAINTENANCE_MODE` / `maintenance.mode` | `false`                                      | Environment default and structural seed                               |
| `PRELAUNCH_MODE` / `prelaunch.mode`     | `false`                                      | Environment default and structural seed                               |
| `LEGAL_REVIEW_REQUIRED`                 | `false`                                      | Removed from executable configuration/policy                          |
| legal approval                          | recorded complete outside runtime evaluation | Operator instruction; not used by application readiness               |
| `LEGAL_DOCUMENTS_MISSING`               | not a blocker                                | Absent from the checkout blocker vocabulary                           |
| additional legal documents              | not required by software                     | No document-count readiness gate                                      |
| minimum purchase age                    | `18`                                         | Configurable structural default                                       |
| expected latest migration               | `20260720160000_cash_collection_idempotency` | API/worker/readiness and restore verification                         |

After a clean migration plus structural seed, the live Compose smoke reported:

- `checkoutEnabled=true`;
- `maintenanceMode=false`;
- `prelaunchMode=false`;
- age-gate cookie issuance and public catalog access successful; and
- exactly `STORE_INFORMATION_MISSING` and `DELIVERY_METHOD_MISSING` as global blockers.

Those two blockers are intentional: the safe seed does not invent a store identity, delivery
coverage, delivery price, pickup, product, or stock. Once an operator configures them, checkout is
still subject to authoritative address, customer, catalog, promotion, inventory, consent,
idempotency, transaction, and COD validation.

## Implemented technical guarantees

- The API owns price, promotion, delivery fee, stock, tax, discount, and integer-millime total
  calculations.
- COD order creation uses one bounded MySQL transaction, deterministic row locking, reservation
  expiry, final-stock validation, immutable commercial/address/consent snapshots, idempotency,
  histories, delivery, COD expectation, audit, and transactional outbox state.
- Repeated identical keys replay one order; conflicting payloads are rejected; different concurrent
  keys cannot oversell the final unit.
- Confirmation consumes reservations and physical inventory exactly once. Cancellation/expiry
  releases active reservations without creating stock.
- Order, delivery, return, collection, remittance, reconciliation, inventory, and administrator
  lifecycle transitions are permission checked, version checked, audited, and recent-auth protected
  where sensitive.
- Customer/admin cookies, Redis prefixes, CSRF contexts, throttles, guards, timeouts, TOTP flows,
  revocation, and login routes remain separate.
- Product media validates MIME, signature, decoding, dimensions, filenames, and storage boundaries;
  durable deletion supports local and S3-compatible storage.
- MySQL outbox rows are authoritative. BullMQ transports deterministic references; retries,
  exponential backoff, terminal state, replay protection, and heartbeat/backlog metrics are present.
- Manual courier assignment, manifests, formula-safe CSV exchange, attempts, rescheduling, refusal,
  failure, return-to-sender, tracking, COD collection/remittance, dual-control reconciliation, and
  reports do not require an external courier API.

## Release verification evidence

The full local release command completed all 14 ordered stages in 762 seconds on the final combined
worktree. It used MySQL 8.4, distinct migration and runtime users, Redis database 15 for integration,
Redis database 14 for operational E2E, the frozen lockfile, and Chromium.

Results from that complete run:

- dependency install and supply-chain policy verification: passed;
- Prisma generate and validate: passed;
- format and lint: passed with zero warnings;
- all six workspace type checks: passed;
- `pnpm audit --audit-level high`: no known vulnerabilities;
- API unit: 76 files, 268 tests passed;
- web unit: 14 files, 36 tests passed;
- worker unit: 6 files, 29 tests passed;
- clean migrations plus structural seed: 6 migrations, 9 roles, 42 permissions, 24 governorates,
  zero users/administrators/products;
- integration: 10 tests passed;
- security: 2 files, 6 tests passed;
- operations: 20 tests passed;
- API, worker, shared packages, and web production builds: passed;
- fast Playwright: 8 passed and 2 project-matrix skips; and
- real-service operational Playwright: 1 passed in 42.9 seconds (47.0-second suite).

The operational browser test proved registration/login, French and Arabic RTL, search/type/flavor
filtering, mobile navigation, cart quantity/removal, keyboard checkout navigation, atomic COD
checkout and retry, customer history, mandatory admin TOTP, simultaneous realm cookies, product
create/edit, idempotent inventory receipt, order confirmation, courier assignment, delivery,
collection, independent reconciliation, bounded CSV exports, technical checkout/maintenance gates,
and denied-permission behavior. Persisted terminal state was `DELIVERED`, `CASH_REMITTED`, and
reservation `CONSUMED`, with reconciled inventory.

Container execution found and repaired two production-only packaging issues before the final gate:
the non-root migration entrypoint no longer invokes mutable pnpm workspace logic, and API/worker
deploy stages regenerate Prisma Client inside the deployed package. Static regression tests,
rebuilt images, in-container enum/client probes, clean migration execution, service health, live
smoke, and the subsequent complete 14-stage release rerun all passed.

## Load and concurrency evidence

`pnpm test:load:disposable` passed all six full targets in 96.4 seconds with one API, one worker,
MySQL pools 60/10, Redis database 13, and 213 distinct loopback source addresses while normal
throttles remained enabled:

| Scenario                 | Result                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| Catalog browsing         | 500/500, concurrency 100, 0 failures; p50 856.592 ms, p95 1094.155 ms, p99 1156.995 ms      |
| Independent checkout     | 50/50, concurrency 50, 0 failures; p50 4546.099 ms, p95 7782.495 ms, p99/max 8035.067 ms    |
| Final-unit race          | 2 contenders, exactly 1 winner; loser `OUT_OF_STOCK`; authoritative remaining quantity `0`  |
| Repeated idempotency     | 20/20, 0 failures, exactly 1 order identity; p50 332.185 ms, p95 401.341 ms, p99 407.925 ms |
| Administrator order list | 25/25, 0 failures; p50 144.304 ms, p95 148.384 ms                                           |
| Worker backlog recovery  | 10 triggers; maximum backlog 2; final actionable/dead-letter counts 0; worker `HEALTHY`     |

Post-run reconciliation found 62 orders, 62 active reservations, 62 notifications, 62 cancelled
notification attempts, 62 processed notification outbox events, 64 total processed events (the
additional two were scheduled reservation events), no dead letters, no duplicate order, and zero
remaining checkout/race/replay stock.

## Backup and restore evidence

A fresh MySQL 8.4 source database received all six migrations and the structural seed. The verified
backup used gzip plus AES-256-GCM, an authenticated manifest, restricted temporary/final files, and
an ignored workspace destination. The isolated restore drill passed all migration checksums, table
counts, foreign-key/orphan checks, money equations, nonnegative inventory, reservation coverage,
and cash invariants; all violation counts were zero. The generated database and scoped restore
identity were removed.

Measured artifact/drill values:

- plaintext 202,567 bytes; gzip 26,275 bytes; ciphertext 26,307 bytes;
- latest migration `20260720160000_cash_collection_idempotency`;
- six migration checksums matched;
- total drill 23.551 seconds; restore plus verification 16.372 seconds; and
- backup age at drill start 1.203 seconds.

This logical drill does not claim a purchaser's full-service RTO/RPO, off-site retention, object
restore, or provider snapshot/PITR acceptance.

## Container and deployment evidence

- API, worker, web, and migration targets built successfully from pinned multi-stage Dockerfiles.
- API and worker runtime containers run as non-root and contain generated Prisma clients.
- The migration container ran all six migrations and exited `0` as non-root.
- MySQL, Redis, MinIO, Mailpit, web, API, worker, and Nginx were simultaneously healthy.
- Final API and worker logs contained no warning/error/exception entries.
- Live deployment smoke passed liveness, dependency readiness, storefront state, checkout policy,
  trusted-origin age confirmation, catalog, storefront, customer login, and admin login through the
  gateway at `http://127.0.0.1:18080`.

## Remaining target-environment configuration

1. Configure real store name, phone, email, and address.
2. Configure and activate at least one complete delivery method/coverage path with valid pricing;
   then verify `GET /api/v1/checkout/policy` has no blocker.
3. Create the first Super Administrator interactively with `pnpm admin:create`, enroll mandatory
   TOTP, store recovery codes securely, and create named least-privilege administrators afterward.
4. Inject unique production database/Redis/browser/session/cookie/encryption/object-storage/SMTP
   secrets from managed custody; configure distinct storefront/admin HTTPS hosts and trusted proxy.
5. Configure real products, media, variants, prices, batches, on-hand stock, thresholds, and any
   optional SMS or courier adapter. Manual delivery remains fully usable without a courier API.
6. Configure protected encrypted off-site backup storage, key escrow, retention, alerting,
   monitoring/error destinations, and run the same restore/smoke/load gates in the target staging
   environment.
7. Require all CI, CodeQL, Gitleaks, Trivy, container-build, and SBOM jobs to pass for the promoted
   commit; pin promoted image digests and complete operator security/operations approval.

## Required release commands

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm prisma:generate
$env:DATABASE_URL = $env:DATABASE_MIGRATION_URL
corepack pnpm prisma:migrate:deploy
corepack pnpm prisma:seed
corepack pnpm admin:create
corepack pnpm verify:release
corepack pnpm test:load:disposable
corepack pnpm backup:mysql
corepack pnpm restore:drill <backup.sql.gz.enc>
corepack pnpm smoke:deployment
```

See `docs/BUYER_HANDOFF.md`, `docs/DEPLOYMENT.md`, `docs/STORE_CONFIGURATION.md`, and
`docs/BACKUP_AND_RECOVERY.md` for required environment guards and complete commands.

## Final verdict

**NOT READY**

Local software technical-readiness score: **9.0/10**. The remaining point is reserved for the
purchaser's configured target environment, promoted-commit CI/security evidence, and operational
acceptance—not legal approval.
