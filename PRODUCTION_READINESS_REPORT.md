# Production readiness report

Review date: 2026-08-11

## Verdict vocabulary

The only overall verdict issued by this report is `NOT READY`.

## Executive assessment

The 2026-07-23 software release candidate implemented and locally verified the required storefront,
customer account, atomic COD checkout, catalog/media, inventory, order, manual delivery, cash
custody, settings, notification, administrator, localization, backup, load, and deployment
workflows. The current worktree additionally contains customer-only Google OAuth and recovery,
manual-courier availability/capacity/coverage and guarded WhatsApp handoff, server-generated media
renditions with immutable profile-versioned metadata and cached-content integrity checks, and
collection-scoped COD discrepancy resolution.
Its dependency baseline includes Swagger 11.4.6, the js-yaml 5.2.2 override, PostCSS 8.5.26, and
Nano ID 3.3.18; the security workflow targets Trivy 0.73.0. On 2026-08-11 the exact migration-14
worktree passed the uninterrupted 14-stage local release verifier, all six unchanged full-target
disposable-load scenarios, and an encrypted isolated backup/restore drill at the fourteen-migration
head. The earlier migration-13 collision rehearsal remains relevant historical upgrade evidence.
The final current-head API, migration, worker, and web images also built successfully, passed strict
Trivy 0.73.0 vulnerability and secret scans, and passed a healthy live-stack readiness and checkout
smoke.
Target-owned provider acceptance and mandatory remote container/CI evidence are still required.
Customer and administrator authentication remain separate security realms and no administrator,
customer, product, stock, order, courier, or credential is created by the structural seed.

The current overall verdict remains **NOT READY** for a purchaser's live deployment. Remaining
target-environment and operator conditions include real store identity/contact values, at least one complete active
delivery method and price, production secrets and hosts, TLS, object storage,
notification-provider credentials, protected backup destinations/keys, monitoring targets, an
appropriately enrolled and authorized administrator roster, and successful mandatory CI/security
jobs for the promoted commit. The repository does not fabricate those deployment inputs.

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
| repository migration head               | `20260811170000_product_image_renditions`    | Fourteenth migration directory in the current worktree                |
| configured readiness migration          | `20260811170000_product_image_renditions`    | Environment/runtime defaults; fresh disposable installation passed    |

In the recorded 2026-07-23 release candidate, after a clean migration plus structural seed, the live Compose smoke reported:

- `checkoutEnabled=true`;
- `maintenanceMode=false`;
- `prelaunchMode=false`;
- age-gate cookie issuance and public catalog access successful; and
- exactly `STORE_INFORMATION_MISSING` and `DELIVERY_METHOD_MISSING` as global blockers.

Those two blockers remain intentional in the current structural seed: it does not invent a store
identity, delivery coverage, delivery price, pickup, product, or stock. Once an operator configures
them, checkout is still subject to authoritative address, customer, catalog, promotion, inventory,
consent, idempotency, transaction, and COD validation. The 2026-07-23 smoke predates the current
geography/delivery and later operational migrations. The current repository head is
`20260811170000_product_image_renditions`, migration 14. The exact-worktree release, fresh-install,
load, and current-head restore gates are recorded below. A production-shaped existing-data rehearsal
in the purchaser's target environment remains required for the promoted commit.

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
- Optional Google OAuth exists only in the customer realm. It uses authorization code plus PKCE,
  state, nonce, an exact storefront callback, official signed-token verification, single-use
  encrypted Redis records, safe verified-email/password linking, and a customer-profile-only
  external identity that contains no provider token. A database constraint continues to require a
  password hash for every administrator.
- Password-reset requests use generic responses, independent IP/account Redis buckets and a common
  Argon2 timing baseline. Local reset tokens are random, short-lived, stored only as hashes,
  consumed atomically and delivered through escaped multipart email. Provider-only customers
  receive coalesced Google sign-in guidance. Email links place the token in the browser fragment and
  the storefront removes it from history before use.
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
- Variant publication locks its product and variant and revalidates lifecycle, SKU, price, media,
  inventory/reservations, media-review state, and delivery readiness. Product publication locks the
  product and additionally revalidates eligible published taxonomy and sellable published variants.
  Both guarded transitions are bounded serializable transactions; concurrent stock removal was
  proven to prevent publication. Demoting, suspending, or archiving a published variant also locks
  the owner rows and cannot remove the last positive-priced published sibling from a published
  product; draft-owner cleanup remains allowed. The separate media-review confirmation requires
  administrator authentication, CSRF, `products.update`, recent authentication, exact confirmation
  text, a reason, the expected version, draft state, no pending/quarantined media, and at least one
  eligible approved image; it is audited.
- Catalog import persists bounded dry-run/apply receipts, canonical fingerprints, row results,
  source provenance, audit, and guarded create-only rollback. The official Wotofo path uses exact
  HTTPS source allowlists, fails closed on option changes, preserves manual catalog state, imports
  media through the normal validator, and cannot publish or invent supplier/stock data.
- MySQL outbox rows are authoritative. BullMQ transports deterministic references; retries,
  exponential backoff, terminal state, replay protection, and heartbeat/backlog metrics are present.
- Manual courier assignment, manifests, formula-safe CSV exchange, attempts, rescheduling, refusal,
  failure, return-to-sender, tracking, COD collection/remittance, dual-control reconciliation, and
  reports do not require an external courier API.
- The committed INS 2024 geography snapshot records source/download/license metadata, attribution,
  edition and retrieval dates, and source SHA-256
  `70f8f9f872862d6947d08fc1b2775c66cf6b4d114a55f68092e7a4ce70d5d9ae`. Structural seeding
  validates and idempotently upserts exactly 24 governorates, 279 delegations, and 2,082 localities,
  including Bizerte's 14 delegations and 101 localities; it creates no operational delivery method.
- Delivery zones now model complete mutually exclusive day/minute ETA pairs plus COD payment,
  manual assignment, and driver-communication metadata. `BIZERTE_EXPRESS` has server-enforced
  30–50-minute COD/manual/WhatsApp and Bizerte-only explicit-coverage rules. `STANDARD_COD` remains
  an operator UI preset, not a provider integration or privileged backend code.
- Customer geography, delivery-method, quote, and created-order fulfillment responses omit
  assignment mode, driver-communication, manual-review, provider, and tracking internals. Guarded
  publication checks and the centralized public-catalog predicate hide records missing public
  lifecycle, taxonomy, positive-variant-price, or approved-media eligibility; zero stock after
  publication remains advisory and checkout remains authoritative.

## Release verification evidence

On 2026-08-11, the exact migration-14 worktree completed `pnpm verify:release` uninterrupted through
all 14 ordered stages in 547.4 seconds. Results were:

- frozen dependency installation and supply-chain policy, Prisma generation and validation,
  formatting, zero-warning linting, all workspace type checks, and the high-severity dependency
  audit: passed;
- API unit: 106 files/548 tests; web unit: 28 files/155 tests; worker unit: 6 files/34 tests;
- disposable integration: all 14 migrations applied to a fresh database, the structural seed ran
  twice without creating commerce/demo identities or data, and 4 files/24 tests passed;
- security: 2 files/6 tests; operational tooling: 34 tests; all production workspace builds: passed;
- fast Playwright: 8 passed with 2 intentional project-matrix skips; and
- operational Playwright: 1 passed in approximately 1.4 minutes, covering registration/login,
  catalog/cart/checkout, administrator TOTP, product editing and media/import, delivery, inventory,
  COD, RBAC denial, and technical/maintenance gates.

This is the current exact-source release evidence. The migration-13 and earlier results retained
below are historical predecessor evidence.

On 2026-08-09, the then-current migration-13 worktree completed `pnpm verify:release` all the way
through its fourteen ordered stages in 556.2 seconds using the frozen pnpm 11.11.0 lockfile, MySQL
8.4, distinct migration/runtime identities, Redis database 15 for integration, Redis database 14
for operational E2E, and Chromium. Results were:

- dependency installation and supply-chain policy, Prisma generation/validation, formatting,
  zero-warning linting, all workspace type checks, and the high-severity dependency audit: passed;
- API unit: 105 files/537 tests; web unit: 28 files/154 tests; worker unit: 6 files/34 tests;
- disposable integration: all 13 migrations applied to a new database, structural seed repeated
  without creating commerce/demo identities or data, and 4 files/24 tests passed;
- security: 2 files/6 tests; operational tooling: 33 tests; all production workspace builds: passed;
- fast Playwright: 8 passed with 2 intentional project-matrix skips; and
- operational Playwright: 1 passed in 1.4 minutes, including registration/login, administrator TOTP,
  catalog/product/media/inventory operations, authoritative COD checkout and replay, Bizerte
  Express boundaries, delivery, collection/remittance/reconciliation, RBAC denial, and launch
  gates. Terminal state was `DELIVERED`, `CASH_REMITTED`, reservation `CONSUMED`, with reconciled
  inventory.

The same candidate's price-filter regression first exposed and then repaired a duplicated
sellable-variant relation predicate. On the real fixture, the incorrect price-filter count fell from
3,602 duplicated rows to the exact 3 products; fifty concurrent corrected counts completed in under
one second. A dedicated real-MySQL regression requires a two-variant product to produce exactly one
item, `total=1`, and `totalPages=1`. The unchanged full load subsequently passed at its original
targets and timeouts.

The 2026-08-04 customer-authentication change passed repository-wide formatting and linting; all
six workspace type checks and production builds; Prisma validation; 104 API files/497 tests, 25 web
files/140 tests, and 6 worker files/33 tests; 4 disposable-MySQL integration files/21 tests after a
clean 11-migration install and repeated structural seed; 2 security files/6 tests; 26 operations
tests; and standard Chromium/mobile Playwright with 8 passes and 2 intentional viewport skips.
`pnpm audit --audit-level=low` reported no known vulnerability. Google-provider staging acceptance,
fresh container scans, and the complete release/recovery matrix remained required at that checkpoint.
That migration-13 candidate's completed local scans and release/recovery evidence are recorded
above; Google-provider staging acceptance remains outstanding.

The following is older historical release-gate evidence and predates the 2026-07-27 geography,
delivery-metadata, and catalog-consistency follow-up. The 2026-07-23 local `pnpm verify:release`
command completed all 14 ordered stages in 444.165 seconds on the final release-candidate source.
It used MySQL 8.4, distinct migration
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

### 2026-07-27 through 2026-08-04 follow-up verification boundary

Focused follow-up checks passed for delivery configuration, geography projection, checkout metadata
sanitization, catalog publication policy, product editor/media, and the last-sellable-variant guard.
The pre-authentication-change package results were 97 API unit files/408 tests, 24 web unit files/130
tests, 6 worker unit files/30 tests, and 2 security files/6 tests, all passing. The checkout regression set
includes courier order creation without an unconfigured postal code, automatic use of a configured
locality code, server validation of every submitted code, safe error mapping, and request-reference
feedback. Formatting, linting,
workspace type checking, Prisma validation, and API, worker, and web production builds also pass. The
web build transformed 2,133 modules.

The 2026-07-29 dependency-security follow-up removed the three findings reported at that time by
`pnpm audit --audit-level=high`. GHSA-qwww-vcr4-c8h2 is resolved with the supported React Router 8.3.0
migration: the removed `react-router-dom` compatibility package is gone, normal imports use
`react-router`, and `RouterProvider` uses `react-router/dom`. The application has no unstable RSC
entry or API affected by the advisory, and no route definition, authorization guard, or session
boundary changed. GHSA-r28c-9q8g-f849 and GHSA-mh99-v99m-4gvg are resolved with exact pnpm overrides
to the then-first patched releases, PostCSS 8.5.18 and brace-expansion 5.0.8; their existing Vite and
minimatch parents accept those patches. No Vite, Vitest, ESLint, minimatch, or unrelated direct
dependency was upgraded. A frozen install and the audit pass with zero advisories. The post-update
verification passes formatting, lint, all workspace type checks, Prisma validation, 407 API unit
tests, 129 web unit tests, 30 worker unit tests, 19 disposable MySQL/Redis integration tests, 6
security tests, 26 operations tests, every production build, and fast Playwright with 8 passes and 2
intentional project-matrix skips. A clean Node 24 web-container build also passed with the frozen
lockfile and supply-chain policy enabled. The rebuilt gateway serves `/`, `/admin`, and `/checkout`
with HTTP 200; web-container health is `healthy`, and MySQL, Redis, worker, and migration readiness
remain `up`.

GitHub run 30870440454 then detected two HIGH advisories published on 2026-08-03 after that earlier
evidence: GHSA-4cwx-7wf7-3272 in Undici 7.28.0 and GHSA-rgw5-rvv9-x895 in brace-expansion 5.0.8. The
smallest compatible updates are applied separately: Undici 7.29.0 is pinned both as the API direct
dependency and as an override for jsdom's test-only path, while the existing brace-expansion
override advances to 5.0.9. The all-severity audit also exposed MEDIUM GHSA-fxqj-rqcc-2cmp; the
existing PostCSS override advances independently from 8.5.18 to 8.5.23, which refreshes only its
Nano ID child to 3.3.16. These are the first patched releases for the dependency lines already in
use. No parent framework, test runner, linter, or unrelated dependency changes. A frozen install
passes supply-chain policy and `pnpm audit` now reports no known vulnerabilities locally. The
mandatory remote workflow refresh remains required for the promoted commit.

At that checkpoint, the patched worktree also passed formatting, linting, all workspace type checks,
Prisma validation, 408 API unit tests, 130 web unit tests, 30 worker unit tests, 19 disposable
MySQL/Redis integration tests, 6 security tests, 26 operations tests, and every production workspace
build. Standard Chromium/mobile Playwright passed 8 tests with 2 intentional project-matrix skips. A
fresh disposable operational rerun applied all ten migrations then present, repeated the structural
seed without commerce/demo data, built the production storefront, and passed its complete
real-service journey in 2.2 minutes, ending with the order delivered, cash remitted, and inventory
reservation consumed.

GitHub Security run 30455832962 exposed a separate runtime-image dependency path that the pnpm
override cannot control. Its API and worker SARIF analyses each reported HIGH CVE-2026-14257 in
npm-bundled brace-expansion 5.0.7, fixed in 5.0.8, plus MEDIUM GHSA-r292-9mhp-454m in npm-bundled
tar 7.5.19, fixed in 7.5.21. The web image had zero findings because its nginx runtime contains no
npm tree. The API and worker processes invoke `node` directly and never use npm at runtime, so the
final images removed npm and its binaries instead of upgrading an unused package manager across a
major version. At that checkpoint the Trivy action remained on stable v0.36.0, selected Trivy 0.72.0
rather than its older 0.70.0 default, and explicitly scanned vulnerabilities and secrets while
constraining SARIF enforcement to the declared `HIGH,CRITICAL` policy; fixed findings still failed
the job and `ignore-unfixed` remained enabled.

Local parity runtime builds then passed for both affected images. Each remained non-root, retained
its original direct Node.js command, and contained no npm directory or npm/npx executable. Trivy
0.72.0, using the CI-equivalent vulnerability and secret scanners, HIGH/CRITICAL severity filter,
`ignore-unfixed`, and failing exit code, returned exit zero with no findings for the rebuilt API,
worker, and web runtimes. Formatting, linting, workspace type checks, Prisma validation, 407
API/129 web/30 worker unit tests, 19 disposable integration tests, 6 security tests, 26 operations
tests, every production build, and fast Playwright with 8 passes and 2 intentional skips also passed
on that historical worktree.

The earlier live Compose run applied all 10 migrations and reported the schema up to date. The
structural seed completed twice with stable totals of 9 roles, 43 permissions, 24 governorates, 279
delegations, and 2,082 localities. At that point liveness, storefront home, and `/admin/delivery`
returned HTTP 200 through the gateway. A fresh disposable real-MySQL/Redis integration run likewise
applied all migrations, seeded twice with the same 24/279/2,082 totals, and passed 3 files/19 tests,
including denial of removing the last sellable published variant and success when a sellable sibling
remains.

This is not a replacement for the complete release gate above. On 2026-07-29 the fast Playwright
matrix executed successfully with 8 passing assertions and 2 intentional project-matrix skips. The
full operational browser harness also migrated and seeded its disposable database, started the API,
worker, and production web preview, and launched Chromium. Its HTTP 201 delivery-rate activation
failure exposed an accidental Nest POST default: the controller and generated OpenAPI already
declared these lifecycle actions as HTTP 200. All eight delivery zone, rate, pickup, and window
activate/deactivate handlers now explicitly return HTTP 200; resource creation remains HTTP 201,
and a focused controller metadata regression passed 4 tests. The next browser attempt passed both
delivery activations and exposed stale test interactions with the intentionally closed product
editor disclosures, the uniquely labelled inventory receipt form, and the now server-derived
read-only postal code. Those interactions now follow the rendered controls without changing the
underlying application contracts. A later media deletion assertion exposed overlapping React Query
invalidations: the media list was invalidated directly and then cancelled by a second broad product
prefix invalidation. Product-detail invalidation is now exact, media owner-version actions remain
serialized through their refresh, and the focused media-manager suite passes 5 tests.

On 2026-08-04 the full disposable operational browser runner applied all ten migrations to a new
database, repeated the structural seed at 9 roles, 43 permissions, 24 governorates, 279 delegations,
and 2,082 localities with no users or commerce records, built the production web bundle, and passed
the complete real-service scenario in 1.6 minutes. Registration/login, administrator TOTP, product
creation/editing/publication, product-media lifecycle, stock receipt, authoritative COD checkout and
replay, Bizerte Express supported/unsupported locality boundaries, delivery, cash remittance and
reconciliation, permission denial, checkout gate, and maintenance gate all passed. At that
checkpoint, the next required evidence was a Compose rebuild/smoke, representative existing-data
upgrade, and migration-11 backup/restore drill. That requirement is retained as history and is
superseded by the migration-13 gate below. The overall verdict remained **NOT READY**.

### 2026-08-09 migration-13 candidate boundary

The evidence dated 2026-07-27 through 2026-08-04 in the preceding historical subsections must not be
interpreted as an exact-worktree pass for that candidate. The repository then contained thirteen
migrations. The two migrations after the customer identity change were:

- `20260804120000_manual_courier_operations`, which adds non-destructive courier availability,
  capacity, WhatsApp contact/template, internal integer-millime cost, and optional delivery-zone
  coverage without changing customer delivery rates; and
- `20260804130000_collection_discrepancy_scope`, which links a collection discrepancy and its
  append-only reconciliation events to the exact cash collection without rewriting recorded cash.

The administration delivery workspace now separates courier configuration from assignment and
delivery execution. Operators can search and filter couriers, maintain availability, capacity,
explicit zones and internal fees, review assignment warnings, assign/reassign/unassign within
custody rules, preview a server-rendered manual `wa.me` handoff, record contact separately, and keep
data-minimized internal notes. No courier provider or WhatsApp sender is enabled by these controls.

Collection discrepancy resolution preserves immutable recorded cash, appends an exact adjustment
event under dual control, and keeps the order warning unless the non-void order-wide accountable
total is exact. Remittance completion applies the same order-wide aggregate invariant.

The current dependency-only changes are the smallest compatible patches recorded in the manifests:
Swagger 11.4.6, js-yaml 5.2.2, PostCSS 8.5.26, and the resulting Nano ID 3.3.18. The GitHub security
workflow retains `aquasecurity/trivy-action` v0.36.0 while selecting Trivy 0.73.0, scans fixed and
unfixed findings, and preserves separate build, scan, SARIF upload, and SBOM failure reporting. Its
matrix now includes the dedicated migration image as well as API, worker, and web. The migration
target deploys the already locked Prisma 6.19.3 runtime into a clean non-root Node image, removes the
unused bundled npm tree, exposes no npm/npm/npx on `PATH`, and is about 104 MB instead of the former
roughly 695 MB build-stage image. The exact migration
command applied cleanly at head 13, and Trivy 0.73.0 reported zero HIGH/CRITICAL vulnerability or
secret findings both with and without `ignore-unfixed`. The complete exact-worktree release rerun is
recorded above for that migration-13 candidate. Mandatory remote CI/provider evidence must still be
attached to the promoted commit;
the overall verdict remains **NOT READY**.

### 2026-08-11 current migration-14 boundary

The current repository contains fourteen migrations. The new head,
`20260811170000_product_image_renditions`, records immutable byte count, SHA-256, dimensions, and
encoder-profile version for each generated rendition without rewriting existing approved image
bytes. Product media exposes fixed server-generated WebP/JPEG renditions only when the complete
immutable manifest is present. Public reads do not generate, backfill, write storage, or mutate the
database; an incomplete legacy manifest falls back to the checksum-verified original, while missing
or conflicting objects fail closed.

The migration-14 Prisma schema, fresh disposable installation, uninterrupted release verifier,
full-target load, and current-head encrypted restore drill have all been verified against this exact
worktree. The final current-head images, strict Trivy scans, migration execution, and deployment
smoke are recorded below. Historical migration-13 evidence remains separately labeled.

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

On 2026-08-11, the unchanged `pnpm test:load:disposable` gate passed all six full targets against the
exact migration-14 source. Catalog browsing completed 500/500 requests at concurrency 100 with zero
failures (p95 7,457 ms; max 9,600 ms). Independent checkout completed 50/50 at concurrency 50 with
zero failures (p95 5,841 ms). The final-unit race produced exactly one winner, rejected the other
contender as `OUT_OF_STOCK`, and left authoritative remaining quantity `0`. All 20 idempotent
replays converged on one order identity, the 25-request administrator list passed, worker recovery
ended `HEALTHY` with zero dead letters, and reconciliation was clean. Normal rate limits, the
30-second request timeout, concurrency, and zero-error threshold were not weakened.

The earlier recorded full-target run passed all six targets in 104.8 seconds with one API, one worker,
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

The 2026-08-11 post-run reconciliation found 62 orders, 62 active reservations, 62 notifications,
62 cancelled notification attempts, 62 processed notification outbox events, 66 total outbox
events, no dead letters, no duplicate order, and zero remaining checkout/race/replay stock.

## Backup and restore evidence

On 2026-08-11, a fresh gzip plus AES-256-GCM backup of the migration-14 local MySQL database was
restored into an isolated disposable database and identity. The authenticated manifest, table
counts, and all 14 migration checksums matched, including the current head
`20260811170000_product_image_renditions`. Verification reported zero negative-inventory,
over-reservation, invalid order-total, invalid line-total, cash-accounting, orphan-reference,
incomplete-migration, or expected-migration violations. The encrypted artifact, disposable database,
scoped restore identity, and temporary drill files were removed after verification.

Historically, on 2026-08-09, a fresh gzip plus AES-256-GCM backup of the then-current local MySQL
8.4 database was restored into an isolated disposable database at migration-13 head
`20260804130000_collection_discrepancy_scope`. The authenticated manifest and all 13 migration
checksums passed. Verification reported zero negative-inventory, over-reservation, order-total,
line-total, cash-accounting, orphan, incomplete-migration, or expected-table violations; the
disposable database was removed. A separate representative migration-13 fixture with two legacy
discrepancies claiming the same collection also completed successfully and left both ambiguous
links null, preserving the fail-closed accounting boundary. Repeated structural seeding remained
stable at 9 roles, 43 permissions, 24 governorates, 279 delegations, and 2,082 localities with no
administrator, customer, product, delivery method, or rate created.

On 2026-07-23, the current MySQL 8.4 application database was backed up with gzip plus AES-256-GCM,
an authenticated format-2 manifest, restricted temporary/final files, and an external temporary
destination. A dedicated local backup/root credential was required because the least-privilege
application user correctly has no MySQL `EVENT` privilege. The isolated restore drill passed all
nine migration checksums, table counts, foreign-key/orphan checks, money equations, nonnegative
inventory, reservation coverage, and cash invariants; all violation counts were zero. The generated
database and random scoped restore identity were removed.

Measured artifact/drill values:

- plaintext 4,981,245 bytes; gzip 546,296 bytes; ciphertext 546,328 bytes;
- that historical artifact's latest migration `20260721023000_unverified_operator_source_urls`;
- nine migration checksums matched;
- total drill 20.567 seconds; restore plus verification 16.791 seconds; and
- backup age at drill start 0.698 seconds.

This logical drill does not claim a purchaser's full-service RTO/RPO, off-site retention, object
restore, or provider snapshot/PITR acceptance.

## Container and deployment evidence

On 2026-08-11, the final current-head images built successfully with local image IDs API
`ac4239b3faa1`, migration `1a6e2f36d053`, worker `6ceeeafdc52e`, and web `0096c46a0477`. The
dedicated migration image found all 14 migrations current with none pending. It runs as `node` UID
and GID 1000, invokes the Prisma 6.19.3 CLI through its direct Node command, has no npm, npx, or pnpm
on `PATH`, and contains no bundled npm dependency tree. The upstream Corepack 0.35 installation and
inert package-manager shims remain present but are not used by the runtime command.

The fresh API, worker, web, and Nginx containers were recreated. API, worker, web, proxy, MySQL,
Redis, object storage, and supporting dependencies reached healthy state. Readiness returned HTTP
200 with MySQL, Redis, worker heartbeat, and all 14 migrations up. The storefront returned HTTP 200. Checkout policy returned HTTP 200 with `allowed=true` and `blockers=[]`; storefront state
reported checkout enabled with maintenance and prelaunch disabled. The local gateway remains
available at `http://127.0.0.1:18080`.

On 2026-08-09, the then-current migration-13 working-tree migration, API, worker, and web targets
rebuilt successfully. The dedicated migration image reported all 13 migrations current. API, worker, web,
and Nginx were recreated while preserving the named MySQL/Redis/object-storage volumes; every
application container is non-root with a read-only root filesystem. The policy-aware deployment
smoke passed liveness, MySQL/Redis/worker/migration readiness, storefront state, checkout policy,
trusted-origin age confirmation, public catalog, storefront, customer login, and administrator
login. It reported checkout enabled, maintenance/prelaunch disabled, and no checkout blocker. The
site is running at `http://127.0.0.1:18080`.

On 2026-07-23, the then-current migration, API, worker, and web targets rebuilt successfully
from the pinned multi-stage Dockerfiles. The non-root migration container exited `0`; API, worker,
web, Nginx, MySQL, Redis, MinIO, and Mailpit were simultaneously healthy after only application
containers were replaced, preserving the named data volumes.

That historical policy-aware deployment smoke passed liveness, dependency readiness, storefront
state, checkout policy, trusted-origin age confirmation, public catalog, storefront, customer login,
and admin login. It confirmed checkout enabled, maintenance/prelaunch disabled, and reported only
`STORE_INFORMATION_MISSING` and `DELIVERY_METHOD_MISSING`. The strict operational-readiness variant
correctly failed for those two missing purchaser inputs; neither legal review nor legal documents
appeared as a blocker.

## Local security and artifact evidence

- Full, production-only, and development-only `pnpm audit --audit-level=low` runs reported no known
  vulnerability.
- Gitleaks 8.30.1 scanned 38 commits/~5.62 MB of repository history with redaction enabled and
  reported no leak. The four entries in `.gitleaksignore` are exact historical placeholder/test
  fingerprints; there is no wildcard, path-wide, rule-wide, or entropy suppression.
- Trivy 0.73.0 scanned the exact final migration-14 API, migration, worker, and web images with
  vulnerability and secret scanners, severity `HIGH,CRITICAL`, `--ignore-unfixed=false`, and
  `--exit-code 1`. All four scans exited `0` with zero vulnerabilities and zero secrets. The security
  workflow matrix scans the same four image targets.
- The final migration image runs as non-root `node` UID/GID 1000, invokes the Prisma 6.19.3 CLI
  through a direct Node command, exposes no npm, npx, or pnpm on `PATH`, and contains no bundled npm
  dependency tree. Upstream Corepack 0.35 and inert shims remain present; this evidence does not
  claim the filesystem contains no package-manager shim names.
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

1. Retain the completed migration-14 release, load, and encrypted restore evidence plus the
   migration-12/13 collision rehearsal. Repeat migration/restore, load, and deployment acceptance
   against the purchaser's production-shaped staging clone for the promoted commit.
2. Configure real store name, phone, email, and address.
3. Configure and activate at least one complete delivery method/coverage path with valid pricing;
   then verify `GET /api/v1/checkout/policy` has no blocker.
4. In a clean target environment, create the first Super Administrator interactively with
   `pnpm admin:create`, enroll mandatory TOTP, and store recovery codes securely. For the current
   local environment, recover/authenticate the existing enrolled Super Administrator through the
   supported TOTP process, rotate any exposed credential, and create the requested named
   least-privilege administrator through the protected UI/API. Do not insert or seed an account.
5. Inject unique production database/Redis/browser/session/cookie/encryption/object-storage/SMTP
   and optional Google OAuth secrets from managed custody; configure distinct storefront/admin HTTPS
   hosts and trusted proxy. Keep Google disabled until its exact storefront callback and staging
   acceptance are complete.
6. For any imported Wotofo drafts, enter verified integer-millime selling prices, supplier/batch
   data, and on-hand stock, then complete publication readiness. For other catalog records, configure
   real products, variants, approved media, prices, batches, stock, and thresholds. Manual delivery
   remains fully usable without a courier API.
7. Configure protected encrypted off-site backup storage, key escrow, retention, alerting,
   monitoring/error destinations, and run the same restore/smoke/load gates in the target staging
   environment.
8. Require all CI, CodeQL, Gitleaks, Trivy, container-build, and SBOM jobs to pass for the promoted
   commit; pin promoted image digests and complete operator security/operations approval.
9. Retain the verified cookie-auth phpMyAdmin endpoint only if this optional external tool is
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

The current `20260811170000_product_image_renditions` candidate has passed the exact-worktree
uninterrupted release verifier, fresh fourteen-migration install with repeat seed, full-target load,
encrypted isolated restore drill, final image builds and strict scans, fourteen-migration container
execution, and live-stack smoke. The **NOT READY** verdict remains because a representative
upgrade/recovery run must pass in the purchaser's target environment, purchaser-owned operational
configuration and provider acceptance must be supplied, the requested administrator must be
created through a fully TOTP-authenticated protected flow, and all mandatory CI/security checks
must pass for the promoted commit. Legal approval is not an engineering readiness gate.
