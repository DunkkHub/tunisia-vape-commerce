# Production readiness report

Review date: 2026-07-23

## Verdict vocabulary

The only overall verdict issued by this report is `NOT READY`.

## Executive assessment

The software release candidate implements and locally verifies the required storefront,
customer account, atomic COD checkout, catalog/media, inventory, order, manual delivery, cash
custody, settings, notification, administrator, localization, backup, load, and deployment
workflows. Customer and administrator authentication remain separate security realms and no
administrator, customer, product, stock, order, or credential is created by the structural seed.

The current overall verdict remains **NOT READY** for a purchaser's live deployment. The remaining
conditions are target-environment and operator configuration: real store identity/contact values,
at least one complete active delivery method and price, production secrets and hosts, TLS, object
storage, notification-provider credentials, protected backup destinations/keys, monitoring targets,
an appropriately enrolled and authorized administrator roster, and successful mandatory
CI/security jobs for the promoted commit. The repository does not fabricate those deployment
inputs.

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

Legal review, approval metadata, and legal-document publication are not startup, health, checkout,
or engineering-verdict inputs. No legal opinion or approval is asserted.

## Launch and checkout state

| Input or derived result                 | Final value                                      | Source/evidence                                                       |
| --------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| `CHECKOUT_ENABLED`                      | `true`                                           | API environment schema, Compose, examples                             |
| `checkout.enabled`                      | `true`                                           | Structural seed; existing operator values are preserved               |
| effective `CHECKOUT_DISABLED`           | `false`                                          | Derived; there is no executable `CHECKOUT_DISABLED` environment input |
| `MAINTENANCE_MODE` / `maintenance.mode` | `false`                                          | Environment default and structural seed                               |
| `PRELAUNCH_MODE` / `prelaunch.mode`     | `false`                                          | Environment default and structural seed                               |
| `LEGAL_REVIEW_REQUIRED`                 | `false`                                          | Removed from executable configuration/policy                          |
| legal approval                          | recorded complete outside runtime evaluation     | Operator instruction; not used by application readiness               |
| `LEGAL_DOCUMENTS_MISSING`               | not a blocker                                    | Absent from the checkout blocker vocabulary                           |
| additional legal documents              | not required by software                         | No document-count readiness gate                                      |
| minimum purchase age                    | `18`                                             | Configurable structural default                                       |
| expected latest migration               | `20260721023000_unverified_operator_source_urls` | API/worker/readiness and restore verification                         |

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
- Product media validates MIME, signature, exact container boundaries, decoding, dimensions,
  animation, metadata, checksums, ownership, and storage boundaries; accepted rasters are safely
  re-encoded and durable deletion supports local and S3-compatible storage.
- Generic remote media ingestion is fail-closed: it accepts only exact configured HTTPS hosts,
  rejects IP literals, resolves public addresses, pins the validated address for the request,
  revalidates redirects, strips query/fragment material from persisted provenance, and enforces
  bounded retries, timeouts, sizes, and concurrency. Redis locks and leases serialize competing
  work. Generic media enters private `PENDING` review and can never become public merely by import.
- Official allowlisted media enters the same validator and may be approved only when its trusted
  official-source checks succeed. Public media responses require both an `APPROVED` media row and
  a public owner. Override imports preserve the previous immutable source row and create a new
  canonical provenance row instead of rewriting history.
- Product and variant publication revalidate category, brand, media, inventory, reservation, and
  delivery readiness inside a bounded serializable transaction after locking the owner rows.
  Concurrent stock removal was proven to prevent publication. The separate media-review
  confirmation requires administrator authentication, CSRF, `products.update`, recent
  authentication, exact confirmation text, a reason, the expected version, draft state, no
  pending/quarantined media, and at least one eligible approved image; it is audited.
- Catalog import persists bounded dry-run/apply receipts, canonical fingerprints, row results,
  source provenance, audit, and guarded create-only rollback. The official Wotofo path uses exact
  HTTPS source allowlists, fails closed on option changes, preserves manual catalog state, imports
  media through the normal validator, and cannot publish or invent supplier/stock data.
- MySQL outbox rows are authoritative. BullMQ transports deterministic references; retries,
  exponential backoff, terminal state, replay protection, and heartbeat/backlog metrics are present.
- Manual courier assignment, manifests, formula-safe CSV exchange, attempts, rescheduling, refusal,
  failure, return-to-sender, tracking, COD collection/remittance, dual-control reconciliation, and
  reports do not require an external courier API.

## Release verification evidence

The 2026-07-23 complete local `pnpm verify:release` command completed all 14 ordered stages in
444.165 seconds on the final release-candidate source. It used MySQL 8.4, distinct migration
and runtime users, Redis database 15 for integration, Redis database 14 for operational E2E, the
frozen lockfile, and Chromium.

Results from that complete run:

- dependency install and supply-chain policy verification: passed;
- Prisma generate and validate: passed;
- format and lint: passed with zero warnings;
- all six workspace type checks: passed;
- `pnpm audit --audit-level high`: no known vulnerabilities;
- API unit: 91 files, 377 tests passed;
- web unit: 19 files, 58 tests passed;
- worker unit: 6 files, 30 tests passed;
- clean migrations plus structural seed: 9 migrations, 9 roles, 43 permissions, 24 governorates,
  zero users/administrators/products;
- integration: 3 files, 15 tests passed;
- security: 2 files, 6 tests passed;
- operations: 26 tests passed;
- API, worker, shared packages, and web production builds: passed;
- fast Playwright: 8 passed and 2 project-matrix skips; and
- real-service operational Playwright: 1 passed in 43.5 seconds.

The promoted-candidate CI run exposed one fixture-only InnoDB deadlock while two independent carts
were being prepared before the final-unit checkout race. The fixture now prepares those carts in a
deterministic sequence; the two checkout transactions under assertion remain concurrent. The
disposable integration suite then passed twice on separate fresh databases, including once inside
the complete release command above.

The final source also removes an environment-derived Windows command interpreter and absolute shell
argument from the release verifier. It now invokes the fixed `cmd.exe`/`pnpm.cmd` toolchain from the
repository working directory, addressing the CodeQL command-injection finding without changing any
application behavior. The operational browser harness now pins both customer and administrator
origins to its disposable web server and verifies the administrator CORS preflight before starting
Playwright, so an ignored local Compose `.env` cannot leak a different admin origin into the test.

The operational browser test proved registration/login, atomic COD checkout and order creation,
customer history, mandatory admin TOTP, simultaneous realm cookies, product create/edit and media
lifecycle, generic remote-media import replay, explicit moderation approval, primary-image
selection, two public media fetches, inventory receipt, order confirmation, courier assignment,
delivery, collection, independent reconciliation, RBAC denial, and technical gates. Persisted
terminal state was `DELIVERED`, `CASH_REMITTED`, and reservation `CONSUMED`, with reconciled
inventory.

An earlier final-gate attempt exposed a test-harness race: the two new publication/media integration
files could create a product while the structural-seed integration file asserted the shared
disposable database was empty. The runner now serializes real-database test files while retaining
the explicit concurrent operations inside each file. A focused rerun passed 3 files/15 tests, and
the subsequent uninterrupted 14-stage release command passed.

Container execution found and repaired two production-only packaging issues before the final gate:
the non-root migration entrypoint no longer invokes mutable pnpm workspace logic, and API/worker
deploy stages regenerate Prisma Client inside the deployed package. Static regression tests,
rebuilt images, in-container enum/client probes, clean migration execution, service health, live
smoke, and the subsequent complete 14-stage release rerun all passed.

## Catalog import and media evidence

The original guarded 2026-07-21 local run verified the reviewed manifest against official endpoints
and used the persisted dry-run/apply/media workflow. On 2026-07-23, the current working-tree CLI
fetched and revalidated all 19 official product sources, replayed the same reviewed import key, ran
the media replay, and generated a fresh structural verification report against the preserved MySQL
database:

- dry run: `PREVIEW_VALID`, 19 official source products and 321 reviewed rows;
- atomic apply: `APPLIED_WITH_WARNINGS`, 19 draft products and 321 deterministic draft variants;
- fresh exact import-key replay: returned the original `APPLIED_WITH_WARNINGS` receipt with 321
  rows and 321 applied outcomes without creating additional products or variants;
- media: 145 approved stored images (19 product and 126 distinct variant images), zero missing,
  zero rejected, seven duplicate/fallback outcomes, and zero products left for media review;
- fresh media replay: zero new objects, 152 already-imported/fallback outcomes, zero missing,
  zero rejected, and zero products requiring manual review;
- fresh verification generated at `2026-07-23T14:36:19.589Z`: 19/19 products, 321/321 variants,
  145 approved official images (19 product and 126 variant), no duplicate SKU/slug, no missing or
  unexpected product, no identity mismatch, no missing translation/image/source-provenance finding,
  and a structurally valid result; and
- account preservation: the live user count remained three; import/seed created no identity.

The fresh release suite covers the catalog/import/media units and the real operational media flow.
Focused post-fix checks also passed for the media-review confirmation flow and the real-MySQL
publication race. The clean disposable MySQL integration path exercises import idempotency,
manual-state preservation, rollback, media handling, and MIME-spoof denial. CI-managed container,
CodeQL, Gitleaks, Trivy, and SBOM gates remain mandatory for the promoted commit.

All 19 products and all 321 variants remain non-public drafts. All 19 products still report manual
pricing and stock requirements, no variant has a positive price, imported supplier cost is unknown
(`NULL`), and inventory remains zero rows/zero on-hand units. The 145 stored images therefore do not
make the catalog sellable by themselves.

## Load and concurrency evidence

`pnpm test:load:disposable` passed all six full targets in 104.8 seconds with one API, one worker,
MySQL pools 60/10, Redis database 13, and 211 distinct loopback source addresses while normal
throttles remained enabled:

| Scenario                 | Result                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Catalog browsing         | 500/500, concurrency 100, 0 failures; p50 2708.153 ms, p95 7112.361 ms, p99 7929.817 ms, max 8952.369 ms |
| Independent checkout     | 50/50, concurrency 50, 0 failures; p50 7799.371 ms, p95 11143.321 ms, p99/max 11532.150 ms               |
| Final-unit race          | 2 contenders, exactly 1 winner; loser `OUT_OF_STOCK`; authoritative remaining quantity `0`               |
| Repeated idempotency     | 20/20, 0 failures, exactly 1 order identity                                                              |
| Administrator order list | 25/25, 0 failures                                                                                        |
| Worker backlog recovery  | 10 triggers; maximum backlog 5; final actionable/dead-letter counts 0; worker `HEALTHY`                  |

Post-run reconciliation found 62 orders, 62 active reservations, 62 notifications, 62 cancelled
notification attempts, 62 processed notification outbox events, 66 total outbox events, no dead
letters, no duplicate order, and zero
remaining checkout/race/replay stock.

## Backup and restore evidence

On 2026-07-23, the current MySQL 8.4 application database was backed up with gzip plus AES-256-GCM,
an authenticated format-2 manifest, restricted temporary/final files, and an external temporary
destination. A dedicated local backup/root credential was required because the least-privilege
application user correctly has no MySQL `EVENT` privilege. The isolated restore drill passed all
nine migration checksums, table counts, foreign-key/orphan checks, money equations, nonnegative
inventory, reservation coverage, and cash invariants; all violation counts were zero. The generated
database and random scoped restore identity were removed.

Measured artifact/drill values:

- plaintext 4,981,245 bytes; gzip 546,296 bytes; ciphertext 546,328 bytes;
- latest migration `20260721023000_unverified_operator_source_urls`;
- nine migration checksums matched;
- total drill 20.567 seconds; restore plus verification 16.791 seconds; and
- backup age at drill start 0.698 seconds.

This logical drill does not claim a purchaser's full-service RTO/RPO, off-site retention, object
restore, or provider snapshot/PITR acceptance.

## Container and deployment evidence

On 2026-07-23, the final working-tree migration, API, worker, and web targets rebuilt successfully
from the pinned multi-stage Dockerfiles. The non-root migration container exited `0`; API, worker,
web, Nginx, MySQL, Redis, MinIO, and Mailpit were simultaneously healthy after only application
containers were replaced, preserving the named data volumes. The current site remains available at
`http://127.0.0.1:18080`.

The policy-aware deployment smoke passed liveness, dependency readiness, storefront state, checkout
policy, trusted-origin age confirmation, public catalog, storefront, customer login, and admin login.
It confirmed checkout enabled, maintenance/prelaunch disabled, and reported only
`STORE_INFORMATION_MISSING` and `DELIVERY_METHOD_MISSING`. The strict operational-readiness variant
correctly failed for those two missing purchaser inputs; neither legal review nor legal documents
appeared as a blocker.

## Local security and artifact evidence

- `pnpm audit --audit-level high` reported no known high-severity dependency vulnerability.
- Gitleaks 8.30.1 scanned Git history with the four exact historical placeholder/test fingerprints
  in `.gitleaksignore`; it found no leak. The ignore file has no wildcard, path-wide, rule-wide, or
  entropy suppression. A separate Trivy secret-only stream of all 493 tracked and nonignored files
  also reported zero findings.
- Trivy 0.69.3 scanned the freshly built API, worker, and web runtime images for fixed
  `HIGH`/`CRITICAL` vulnerabilities with the same `ignore-unfixed` policy as CI. Every image reported
  zero high and zero critical findings.
- Local CycloneDX 1.6 SBOM generation succeeded for API (440 components), worker (269), and web (22).
  GitHub must still regenerate and retain the repository's required SPDX artifacts for the promoted
  commit.
- CodeQL, Gitleaks, Trivy, container-build, and SBOM GitHub jobs remain mandatory promoted-commit
  evidence; local results do not substitute for those checks.

## MySQL and phpMyAdmin evidence boundary

The application and migration identities were verified against the repository Docker MySQL 8.4
service on host loopback port `13306`; `pnpm db:doctor` distinguishes the endpoint, server engine,
database, identity, privileges, and migration state. The machine also has an unrelated XAMPP
MariaDB listener on `3306` and a separate WSL MySQL instance. Treating either as the Docker
application database risks operating on the wrong data.

The external XAMPP phpMyAdmin configuration was corrected and PHP syntax-checked on 2026-07-23. It
now uses cookie authentication, TCP to `127.0.0.1:13306`, no stored database password, no active
control-user/control-password pair, `AllowNoPassword=false`, and a newly generated valid blowfish
secret. A browser login using the dedicated application database identity opened `vape_store` with
HTTP 200 and without an access-denied/control-user error. phpMyAdmin remains optional and is not an
application dependency; historical XAMPP InnoDB corruption evidence remains outside the supported
MySQL 8.4 release path and must not be imported into the application database.

## Known residual risks and protected administrative state

- Object storage and MySQL cannot participate in one atomic transaction. The implementation uses
  bounded validation, checksums, leases, durable status, and compensating cleanup, but a process or
  provider failure between object and database commits can leave an orphaned object or a media row
  requiring reconciliation. Operational orphan monitoring and cleanup remain required.
- No additional administrator was created during this review. The supported creation flow requires
  an active Super Administrator session that has completed mandatory TOTP, CSRF validation, recent
  authentication, and the relevant permission. The available enrolled TOTP state could not be
  authenticated during this run, so bypassing or resetting it was correctly refused. An authorized
  operator must authenticate with the current authenticator and create the named account through
  the protected administration flow; no credential or TOTP material is recorded in this report.
- Any password or setup material previously exposed in a screenshot must be rotated through the
  supported credential/recovery procedure before the affected account is trusted.

## Remaining target-environment configuration

1. Configure real store name, phone, email, and address.
2. Configure and activate at least one complete delivery method/coverage path with valid pricing;
   then verify `GET /api/v1/checkout/policy` has no blocker.
3. In a clean target environment, create the first Super Administrator interactively with
   `pnpm admin:create`, enroll mandatory TOTP, and store recovery codes securely. For the current
   local environment, recover/authenticate the existing enrolled Super Administrator through the
   supported TOTP process, rotate any exposed credential, and create the requested named
   least-privilege administrator through the protected UI/API. Do not insert or seed an account.
4. Inject unique production database/Redis/browser/session/cookie/encryption/object-storage/SMTP
   secrets from managed custody; configure distinct storefront/admin HTTPS hosts and trusted proxy.
5. For any imported Wotofo drafts, enter verified integer-millime selling prices, supplier/batch
   data, and on-hand stock, then complete publication readiness. For other catalog records, configure
   real products, variants, approved media, prices, batches, stock, and thresholds. Manual delivery
   remains fully usable without a courier API.
6. Configure protected encrypted off-site backup storage, key escrow, retention, alerting,
   monitoring/error destinations, and run the same restore/smoke/load gates in the target staging
   environment.
7. Require all CI, CodeQL, Gitleaks, Trivy, container-build, and SBOM jobs to pass for the promoted
   commit; pin promoted image digests and complete operator security/operations approval.
8. Retain the verified cookie-auth phpMyAdmin endpoint only if this optional external tool is
   operationally required.

## Required release commands

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm prisma:generate
$env:DATABASE_URL = $env:DATABASE_MIGRATION_URL
corepack pnpm db:doctor -- --url-env DATABASE_URL --role migration
corepack pnpm prisma:migrate:deploy
corepack pnpm prisma:seed
corepack pnpm admin:create
corepack pnpm verify:release
corepack pnpm test:load:disposable
corepack pnpm backup:mysql
corepack pnpm restore:drill <backup.sql.gz.enc>
corepack pnpm smoke:deployment
```

When the reviewed Wotofo catalog is intentionally selected, run the separate guarded workflow
after backup and migration, using an active named administrator with `catalog.import`:

```powershell
corepack pnpm catalog:import:wotofo -- --actor-email <authorized-admin@example.tld> --import-key <reviewed-import-key> --json
corepack pnpm catalog:import:wotofo -- --actor-email <authorized-admin@example.tld> --import-key <reviewed-import-key> --apply --json
corepack pnpm catalog:media:wotofo -- --batch-id <applied-batch-id> --actor-email <authorized-admin@example.tld> --json
corepack pnpm catalog:verify:wotofo -- --output outputs/catalog/wotofo-verification.json
```

See `docs/BUYER_HANDOFF.md`, `docs/DEPLOYMENT.md`, `docs/STORE_CONFIGURATION.md`, and
`docs/BACKUP_AND_RECOVERY.md` for required environment guards and complete commands. Catalog
operators must also follow `docs/CATALOG_IMPORT_AND_MEDIA.md`.

## Final verdict

**NOT READY**

This verdict remains until the requested administrator is created through a fully TOTP-authenticated
protected flow, purchaser target operational configuration is supplied, and all mandatory
CI/security checks pass for the promoted commit. Legal approval is not an engineering readiness
gate.
