# Implementation plan

Last updated: 2026-08-04

## Delivery policy

Work proceeds in reviewable vertical slices. A phase is complete only when its code, migrations, tests, builds, documentation, and operational checks pass. A green build does not imply legal approval, measured capacity, backup validity, or production readiness.

The exact dependency set is pinned by package.json files and pnpm-lock.yaml. CI installs with the frozen lockfile. Renovation of a dependency requires its changelog, security impact, migration notes, and regression results to be reviewed.

## Selected dependency baseline

The direct dependency baseline selected in the manifests on 2026-07-11 is:

| Area                   | Exact versions                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain              | Node >=22.22.0 (container line 24), pnpm 11.11.0, TypeScript 5.9.3, Prisma/Prisma Client 6.19.3, ESLint 10.7.0, Prettier 3.9.5, tsx 4.23.0                                  |
| API framework/security | NestJS common/core/platform-express 11.1.28, Nest config 4.0.4, Swagger 11.4.5, throttler 6.5.0, Argon2 0.44.0, Helmet 8.2.0, cookie-parser 1.4.7, Zod 4.4.3                |
| API runtime/telemetry  | ioredis 5.11.1, nestjs-pino 4.6.1, pino-http 11.0.0, otplib 13.4.1, qrcode 1.5.4, RxJS 7.8.2, Undici 7.29.0, uuid 14.0.1                                                    |
| Web                    | React/React DOM 19.2.7, Vite 8.1.4, React Router 8.3.0, TanStack Query 5.101.2, React Hook Form 7.81.0, Zod 4.4.3, i18next 26.3.6, react-i18next 17.0.9, Tailwind CSS 4.3.2 |
| Accessible UI          | Radix Dialog 1.1.19, Radix Slot 1.3.0, Lucide React 1.24.0                                                                                                                  |
| Tests                  | Vitest 4.1.10, Testing Library React 16.3.2/User Event 14.6.1/jest-dom 6.9.1, Playwright 1.61.1, Supertest 7.2.2, jsdom 29.1.1                                              |
| Worker                 | BullMQ 5.80.2, ioredis 5.11.1, Pino 10.3.1, Zod 4.4.3                                                                                                                       |
| Local containers       | MySQL 8.4, Redis 7.4 Alpine, MinIO RELEASE.2025-04-22T22-12-26Z, MinIO client RELEASE.2025-04-16T18-13-26Z, Mailpit v1.27, Nginx unprivileged 1.30.2 Alpine slim            |

The 2026-07-29 dependency-security update addresses GHSA-qwww-vcr4-c8h2 by replacing the removed
`react-router-dom` compatibility package with `react-router` 8.3.0 and moving `RouterProvider` to
the supported `react-router/dom` entry point. The storefront does not use the advisory's unstable
RSC APIs, and the migration changes no route definitions or authentication boundaries. React
Router 8 raises the declared Node.js floor to 22.22.0; CI and containers remain on Node 24. The same
update resolves GHSA-r28c-9q8g-f849 and GHSA-mh99-v99m-4gvg with exact pnpm overrides to the then-first
patched transitive releases, PostCSS 8.5.18 and brace-expansion 5.0.8. Vite, Vitest, ESLint,
minimatch, and all unrelated direct dependencies remain unchanged. Regenerating the pnpm 11
lockfile also normalizes the existing `@vitest/coverage-v8` peer reference from the web workspace's
`@types/node` 26.1.1 context to the API workspace's declared 24.10.9 context; this changes no package
version or manifest.

Three advisories published on 2026-08-03 require a second, isolated patch refresh. HIGH
GHSA-4cwx-7wf7-3272 is addressed by moving the API's direct Undici dependency from 7.28.0 to 7.29.0
and applying the same exact override to the jsdom test path. HIGH GHSA-rgw5-rvv9-x895 supersedes the
earlier brace-expansion mitigation and moves that override from 5.0.8 to 5.0.9. MEDIUM
GHSA-fxqj-rqcc-2cmp moves the existing PostCSS override from 8.5.18 to 8.5.23; PostCSS's patched
manifest resolves Nano ID 3.3.16 as its sole associated lockfile refresh. Each selected version is
the first patched release in the dependency line already present. No Vite, Vitest, jsdom, ESLint,
minimatch, or unrelated application dependency is upgraded.

The exact patched worktree passes the frozen install and all-severity dependency audit, formatting,
linting, workspace type checking, Prisma validation, 97 API files/408 unit tests, 24 web files/130
unit tests, 6 worker files/30 unit tests, 3 disposable MySQL/Redis integration files/19 tests, 2
security files/6 tests, 26 operations tests, and all six production workspace builds. Standard
Playwright passes 8 tests with 2 intentional project-matrix skips. The disposable operational
Chromium journey reapplies all ten migrations and the structural seed, then passes its complete
checkout, TOTP, RBAC, catalog/media/import, inventory, Bizerte Express, delivery, COD, maintenance,
and technical-gate scenario in 2.2 minutes.

The corresponding container-security follow-up removes unused npm binaries and npm's bundled
dependency tree from the final API and worker images. Both services already start directly with
`node`, so this changes no runtime command or application dependency. It removes the separate
image copies of vulnerable brace-expansion 5.0.7 and tar 7.5.19 without a broad package-manager
upgrade. The Trivy action remains on stable v0.36.0 and now selects the current stable Trivy 0.72.0
scanner, explicitly scans vulnerabilities and secrets, limits its SARIF gate to the configured
`HIGH,CRITICAL` severities, and retains `ignore-unfixed: true` and a failing exit code.
Local parity builds of both final images pass, retain the non-root `node` user and direct Node.js
commands, and contain no npm directory or npm/npx executable. Trivy 0.72.0 returns success with zero
fixed HIGH/CRITICAL vulnerability or secret findings for the API, worker, and current web runtimes.

The lockfile, not this summary, resolves transitive versions. Before controlled staging, review runtime compatibility and security advisories, pin container digests and CI action commit SHAs, generate an SBOM, and record any approved exception.

## Current status

| Phase                             | Scope                                                                         | Status                         | Recorded exit evidence                                                           |
| --------------------------------- | ----------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| 1. Foundation                     | pnpm workspace, React, NestJS, worker, configuration, Docker, CI              | Implemented/local pass         | Frozen gate, production builds, healthy full Compose stack                       |
| 2. Database                       | Complete Prisma model, migration, structural Tunisia/RBAC seed, indexes       | Implemented; gate refresh open | Fresh 10-migration integration; repeat seed at 24/279/2,082; recovery still open |
| 3. Authentication and RBAC        | Separate customer/admin authentication, sessions, 2FA, permissions, admin CLI | Implemented/local pass         | Realm/CSRF/TOTP/RBAC positive and negative tests                                 |
| 4. Catalog                        | Products, variants, taxonomy, suppliers, images, admin CRUD, storefront       | Implemented; browser gate open | API 97/408; web 24/130; variant guard 14/14; real integration                    |
| 5. Inventory                      | Locations, movements, reservations, batch/expiry, concurrency                 | Implemented/local pass         | Receipt/adjustment/transfer plus full-target final-unit race                     |
| 6. Geography and delivery pricing | Tunisia hierarchy, zones, rates, pickup, deterministic resolver               | Implemented; focused pass      | INS hierarchy/rules plus fresh real-service integration (3 files/19 tests)       |
| 7. Cart and checkout              | Customer carts, authoritative totals, COD, reservations and idempotency       | Implemented/local pass         | Real browser checkout/replay and 50-checkout/20-replay load                      |
| 8. Orders and delivery            | State machines, attempts, manual fulfillment and notifications                | Implemented/local pass         | Real order-to-delivery flow, guarded transitions, manual operations              |
| 9. COD reconciliation             | Collection, remittance, discrepancies, reports                                | Implemented/local pass         | Collection/remittance and independent dual-control reconciliation                |
| 10. Compliance                    | Age gates, consent, delivery verification and operational launch gate         | Implemented/local pass         | Configurable controls; only store/delivery blockers on fresh seed                |
| 11. Reporting/admin               | Dashboards, customer operations, settings, exports and audit views            | Implemented/local pass         | Permission/pagination/privacy/formula-safe export and admin UI tests             |
| 12. Hardening                     | Security, health, outbox, backup/restore, load and staging deployment         | Implemented; target open       | Security gate, 500/50 load, encrypted restore drill, non-root Compose smoke      |

Do not change a status to complete based on unrecorded local results. Link CI runs, test reports, migration checks, restore evidence, and human sign-offs in this file or the readiness report.

The 2026-07-27 through 2026-08-04 geography, delivery-metadata, catalog-consistency, administrator-workspace, settings-feedback, checkout-feedback, and dependency-security follow-up has current API unit (97 files/408 tests), web unit (24 files/130 tests plus a focused 5-test media-manager pass), worker unit (6 files/30 tests), security (2 files/6 tests), static, and six-workspace production-build evidence. It also has a live Compose migration-10 deployment, repeat-seed proof at 24/279/2,082, a fresh real-MySQL/Redis integration pass (3 files/19 tests), and fast Playwright evidence with 8 passes and 2 intentional project-matrix skips. The delivery lifecycle controller now explicitly returns the documented HTTP 200 for all eight activate/deactivate actions, with focused metadata coverage, while resource-creation routes retain HTTP 201. On 2026-08-04 the disposable operational browser scenario applied all ten migrations, ran the structural seed without commerce/demo accounts, built the production web bundle, and passed its complete real-service scenario in 1.6 minutes. Its stale closed-disclosure, receipt-form, and read-only postal-code interactions were corrected, and the media manager now serializes owner-version mutations and avoids overlapping list invalidation through a broad product-query prefix. The current full Compose smoke, representative upgrade, and migration-10 backup/restore drill still require exact-worktree refresh. The 2026-07-23 complete release evidence is historical.

The shared worktree contains the complete operational slices for separated authentication and account lifecycle, writable catalog/media/taxonomy, transactional inventory and reservations, Tunisia geography and manual delivery, customer carts/accounts, authoritative atomic COD checkout, guarded order/delivery transitions, COD custody/reconciliation, settings, notifications, durable outbox processing, dependency readiness, and encrypted backup/restore. The recorded local evidence now includes MySQL 8.4/Redis integration, real-browser order-to-cash coverage, the full 500-browser/50-checkout load target, an isolated encrypted restore drill, production builds, non-root container builds, and a healthy full Compose smoke. Purchaser provider credentials and target-environment acceptance remain deployment work, not missing application behavior.

Fresh-database operational defaults are `checkout.enabled=true` and `prelaunch.mode=false`, with corresponding environment defaults `CHECKOUT_ENABLED=true` and `PRELAUNCH_MODE=false`. Re-running the structural seed preserves an existing setting value rather than overriding an operator change. Legal review and legal-document publication are not runtime checkout prerequisites or technical-readiness inputs. Checkout still fails closed for a stricter checkout or prelaunch environment override, maintenance mode, an invalid configured minimum age, missing store name/phone/email/address, no active pickup or supported zone/current rate, unavailable required services, and request-specific catalog, customer, address, stock, pricing, configured consent, or COD validation failures. The structural seed creates no administrator, customer, product, stock, rate, pickup, or provider configuration.

> Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

## Phase details

### Phase 1 — foundation

- Establish strict TypeScript across the workspace.
- Validate every environment variable at API and worker startup.
- Keep API instances stateless; put sessions, distributed throttles, cache coordination, and queues in Redis.
- Provide MySQL 8.4, Redis, MinIO, Mailpit, API, worker, web, and Nginx containers with health checks and persistent development volumes.
- Use multi-stage images and non-root runtime users.
- Establish formatting, lint, type, unit, integration, build, dependency, secret, static, image, and SBOM CI gates.
- Exit only after docker compose up -d reaches healthy state from a clean machine.

### Phase 2 — database

- Model all required domains with foreign keys, uniqueness, referential behavior, immutable snapshots, archive fields, and UTC timestamps.
- Keep physical on-hand quantity authoritative. Derive available quantity as on-hand minus active reservations; do not persist a conflicting available value.
- Use a structural seed only: roles, permissions, role mappings, the versioned INS 2024 Tunisia hierarchy (24 governorates, 279 delegations, and 2,082 localities), secure settings, and feature flags. The normalized snapshot embeds the INS dataset/page/download/license metadata, edition and retrieval dates, attribution, and source SHA-256 `70f8f9f872862d6947d08fc1b2775c66cf6b4d114a55f68092e7a4ce70d5d9ae`. Validate the exact expected counts, stable codes, uniqueness, and parent relationships before idempotent upserts; never invent geography when validation fails.
- Validate query plans for catalog, inventory, order, delivery, COD, audit, and reporting access paths.
- Test an empty migration and a representative prior-version upgrade.

### Phase 3 — authentication and authorization

- Implement customer endpoints only under /api/v1/auth/customer/* and admin endpoints only under /api/v1/auth/admin/*.
- Use distinct cookie names, Redis session prefixes, CSRF tokens, throttles, guards, login audit events, revocation, and timeouts.
- A successful admin password check creates only a short-lived pending challenge. Mandatory TOTP promotes it to a full admin session; a recovery endpoint is not currently exposed.
- During first-login enrollment, return an `otpauth://` URI and render its QR code locally in the admin UI with a manual-key fallback. Reuse the same encrypted, unverified TOTP seed across password retries until enrollment succeeds or an authorized reset explicitly replaces it.
- Keep the admin UI entry at /admin/login and customer entry at /login.
- Implement Argon2id hashing, generic errors, progressive delay, reset/verification token hashing, rotation, idle and absolute expiry, and full revocation.
- Create the first Super Administrator through a secure interactive CLI; never seed one.
- Restrict that interactive CLI to the first administrator only. Subsequent named non-super administrators are created through the exact-super protected API and must enroll TOTP before becoming operational.
- Separate administrator and customer lifecycle commands. Require exact Super Administrator role plus permissions, CSRF, recent authentication, confirmation, reason, optimistic versions, realm-scoped revocation, and audit; forbid self-lifecycle changes and loss of the last operational Super Administrator.
- Enforce permissions on the NestJS API and add a deny-by-default RBAC matrix.

### Phases 4–7 — commerce core

- Catalog/media, promotion validation, supplier/batch operations, product/variant/taxonomy writes, archival, ordering, secure image upload, durable deletion, and production-scale verification are implemented and covered by the release, browser, and load gates. Imported-media review closes through a distinct audited, recent-authenticated draft transition only after every pending/quarantined image is resolved and an approved eligible image remains; it never publishes or clears pricing/stock controls.
- The administrator product editor keeps taxonomy, variant, inventory, delivery, media, and product publication as explicit separate actions. Variant create/update forms snapshot their values synchronously before starting asynchronous mutations, preserve the edited form on failure, and announce scoped success or allowlisted publication blockers. Successful product, variant, media, and stock changes invalidate the public home, catalog/list/detail, cart, and checkout query families as well as their admin detail/list caches. Server-side permissions, recent authentication, optimistic concurrency, and publication readiness remain authoritative.
- The operational browser fixture drives product/variant/media/inventory/publication work through the real administrator UI rather than pre-creating the catalog through a production seed or direct database write. It counts as release evidence only after the full scenario passes against disposable services.
- Draft-to-published transitions run guarded serializable checks after locking their owners. Variant publication locks the product and variant and checks product lifecycle, SKU, real positive price, approved eligible media, reservation-aware live stock, media-review state, and active fulfillment. Product publication locks the product and additionally requires eligible published taxonomy and at least one sellable published variant. Demoting, suspending, or archiving a published variant also locks the owner rows and is rejected with `SELLABLE_VARIANT_MISSING` if its published product would have no positive-priced published sibling; draft-product cleanup remains allowed. Public home/catalog/detail and downstream cart/checkout lookups share the centralized published-catalog eligibility predicate for status, taxonomy, restrictions, positive variant price, and approved eligible media. Stock may later reach zero while the product remains visibly published with zero advisory availability; cart, quote, and order validation remain authoritative.
- Catalog import now uses persisted CSV/JSON previews, canonical payload fingerprints, bounded validation, explicit replay-safe apply, row receipts, source provenance, audit, and a create-only version-guarded archival rollback. Concurrent identical apply calls converge on one fingerprint-validated receipt. Image-source overrides retain the prior source row and image link under a reserved historical key before creating the new canonical record. The reviewed official Wotofo path verifies 19 products and 321 deterministic variants against allowlisted source endpoints, then imports approved media through the normal validator/storage boundary. The recorded local media result is 145 stored images. All imported records remain drafts and real price, supplier cost, available stock, and publication remain operator work.
- The current commerce API exposes bounded published catalog and facet reads; guarded/audited product, variant, brand, and category lifecycle operations; reservation-aware inventory reads and adjustments; bounded geography/delivery-option reads; authenticated customer cart operations; authoritative checkout-policy evaluation; and a non-reserving integer-millime quote.
- `POST /api/v1/checkout/orders` is implemented for authenticated customers and COD only. One bounded `READ COMMITTED` transaction claims a customer-scoped hashed idempotency key, replays a completed identical request, validates authoritative policy/customer/catalog/pricing/delivery data, locks eligible inventory rows in stable order, subtracts active reservations, and creates immutable order/item/address/consent/fee snapshots, active reservations, initial order/delivery/COD records, a queued notification, audit evidence, and the completed idempotency result. Checkout reserves but does not decrement physical on-hand.
- Checkout treats the postal code as optional when the selected locality has no authoritative postal-code record, matching the API and nullable address snapshot contract. When geography supplies a postal code, the storefront fills it from the locality and the order service still validates every submitted value. Order failures use an allowlisted localized recovery message, preserve the same idempotency key for an unchanged manual retry, and expose only the safe request reference; no automatic order retry is introduced.
- The public home surface uses a responsive French/Arabic dark-neon presentation with API-derived featured products, prices, availability, flavors, and categories. Decorative device artwork is code-native; empty catalogs remain explicit and no demonstration product claims, ratings, nicotine levels, stock, or delivery promises are fabricated.
- A local-only landing-page preview may render that surface during prelaunch only in Vite development, only when explicitly enabled, and only after any enabled minimum-age confirmation. It does not change stored prelaunch, checkout, maintenance, API, or production-build gates.
- Resolve delivery rate precedence deterministically: explicit locality rule, delegation rule, governorate rule, zone rule, then eligible store-wide base; apply documented surcharges in stable priority order. A missing or ambiguous result blocks checkout.
- Administrator confirmation locks the order, active reservations, and inventory, requires complete unexpired coverage and expected versions, decrements physical on-hand exactly once, consumes reservations, and advances order/delivery history. Customer or administrator cancellation releases only active reservations, does not increase physical stock, and cancels the COD expectation atomically.
- Delivery configuration supports inactive-by-default zones, locality-expanded governorate/delegation links, rates, pickups, and time windows with deterministic specificity, validity/ambiguity checks, activation readiness, audited lifecycle actions, and optimistic concurrency. The zone model stores mutually exclusive day or minute ETA pairs plus COD payment, assignment, and driver-communication metadata. There is no separate `DeliveryMethod` table or provider integration.
- The administrator workflow exposes zone ETA, confirmation, priority, operational metadata, and express-rate fields already enforced by the API; converts both created and edited TND rates to exact integer millimes with a visible preview; normalizes validated configuration codes; selects governorate, delegation, or locality coverage by name instead of opaque database identifiers; and shows localized, request-referenced mutation failures beside the originating form. Courier success/failure remains beside the courier form and missing inventory-location prerequisites remain beside stock intake. These are presentation controls only: recent authentication, batch traceability, dual-control adjustments, zone geography/rate activation, and audit remain authoritative.
- The delivery administration surface separates guided configuration, daily fulfillment, and advanced CSV tools while keeping every form mounted. Zone cards expose coverage and active-rate prerequisites before activation, link operators to the next missing step, and keep the API activation guards authoritative.
- `STANDARD_COD` is an operator preset, not an integration or a privileged backend code: it records 1–3 days, COD, manual assignment, phone confirmation, explicit approved national locality coverage, and a target 8,000-millime zone base fee. The reserved `BIZERTE_EXPRESS` code is server-enforced at 30–50 minutes, COD, manual assignment, WhatsApp communication, explicit delegation/locality coverage entirely inside Bizerte, and an active zone base rate before activation.
- Customer delivery-method, quote, and created-order fulfillment responses expose only customer-safe timing, COD, confirmation, fee, label, and availability fields. Assignment mode, driver communication, manual-review state, provider internals, and tracking operations remain admin/internal snapshot data.

### Phases 8–11 — operations

- The authenticated administration console uses permission-filtered navigation groups and consistent task workspaces. Stock intake, lot management, order processing, COD custody, store settings, catalog import, taxonomy, variants, media, and administrator creation use progressive disclosure while keeping forms mounted and preserving their original field names, mutations, permission checks, recent-authentication gates, optimistic versions, idempotency keys, dual-control rules, and audit behavior. The presentation is responsive, keyboard operable, RTL-safe, and does not change any API or database contract.
- Store-setting mutations now report success, unchanged values, validation failures, recent-authentication expiry, optimistic conflicts, and safe request references beside the originating card. Fixed Tunisia currency/timezone values are identified as already configured instead of inviting an impossible resubmission; the API security and audit gates remain unchanged.
- Implemented administrator order intake includes detail/slip, confirm, cancel/reject, prepare, ready-for-pickup, append-only contact attempts, and visibility-scoped notes. Manual delivery includes courier assignment/reassignment, controlled transitions and attempts, exact age/COD completion, and return completion without automatic restock.
- Implemented COD custody separates expected collection, physical cash recording, draft allocation/remittance, submission, verification or discrepancy creation, and reasoned discrepancy resolution/write-off. Recent authentication protects remittance and reconciliation actions; collected cash is not treated as reconciled merely because delivery succeeded.
- Continue enforcing and testing order and delivery transition matrices on the backend and preserve immutable histories.
- Make a failed age-verification result terminal for delivery until a separately authorized return/override workflow.
- Track COD expected, collected, held, remitted, discrepant, and reconciled as separate events and amounts.
- Require recent authentication and elevated permission for reconciliation, inventory corrections, role changes, compliance publication, and other dangerous actions.
- Treat administrator anonymization and customer disabling as distinct suspended-first workflows. Preserve append-only audit and historical commerce references; customer disabling is not a substitute for legally reviewed privacy erasure.
- Bound every list/export; enqueue large exports; minimize personal data and neutralize CSV formulas. The minimized customer export is bounded; a generic asynchronous large-export service is not claimed.

### Phase 12 — hardening and release

- The durable worker now leases MySQL `OutboxEvent` rows in bounded batches and uses BullMQ only as transport. Versioned handlers expire reservations or dispatch notifications idempotently; failures use bounded retry and dead-letter states. Development supports console and Mailpit SMTP; production supports authenticated TLS SMTP and an optional authenticated HTTPS SMS webhook. Explicitly disabled SMS rows close as cancelled without a provider call. Selected-provider acceptance evidence remains a deployment task.
- `/api/v1/health/live` is process-only. `/api/v1/health/ready` fails with 503 unless MySQL, Redis, the expected migration, and a fresh durable-worker heartbeat are all available.
- Backup tooling creates a timestamped gzip logical MySQL dump, AES-256-GCM encrypted by default, plus an authenticated checksum/migration/count manifest and safe age retention. Restore requires an explicitly confirmed empty disposable target, authenticates and expands before mutation, and runs migration/structural verification. The 2026-07-20 local drill restored and verified in 16.372 seconds, removed its generated database/identity, and recorded zero invariant violations. The purchaser must still measure accepted full-service RPO/RTO in target staging.
- Architecture, security, business-logic, accessibility, and operations checks are included in the local release and operational-browser suites; an independent human review remains part of target acceptance.
- The documented disposable workload passed the full 500-browser/50-checkout targets without oversell, duplicate orders, dead letters, or reconciliation drift.
- Dependency/source/secret/container/SBOM workflows are configured; mandatory remote workflow results must be retained for the promoted commit.
- Obtain human security, operations, and release approval before considering any limited production release. Legal suitability is tracked separately and is not an input to this technical plan.

## Mandatory scenario ledger

The following require automated evidence: customer COD checkout and any future guest checkout; invalid and unsupported addresses; exact server delivery fee; final-unit exclusion; idempotent retry; customer-order IDOR denial; RBAC denials; valid delivery transitions; admin-without-2FA denial; archived product behavior; reservation release; configured age/consent behavior; refused/failed-age return flows; cash collection/remittance/reconciliation; malicious upload rejection; login throttling; CSV injection protection; and maintenance, checkout-disabled, and prelaunch gates.

## Blocking external inputs

Legal approval is recorded complete by owner instruction and no additional legal-document publication is required by the runtime checkout policy. Controlled staging still requires these external operating inputs:

- Verified legal store identity and real store contact information in operational settings.
- Real delivery coverage/rates and an approved pickup/courier operating process.
- Real commercial prices, supplier/stock intake, and publication review for any imported catalog drafts.
- Interactive creation and TOTP enrollment of the first Super Administrator.
- Approved manual courier process or optional provider credentials.
- Production DNS/TLS, secrets, SMTP/SMS, object-storage, monitoring, and backup destinations.
- Named owners for security, incidents, cash reconciliation, privacy requests, and releases.

## Definition of done

All required root scripts pass; web, API, worker, and Docker production builds pass; migrations succeed from empty and representative existing data; secure admin creation works; authorization and customer isolation are verified; no negative stock, oversell, duplicate order, invalid transition, or unreconciled ledger mutation is possible; backup and restore are proven; the compliance gate works; and all documentation/review evidence is current.
