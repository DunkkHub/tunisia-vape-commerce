# Production readiness report

Review date: 2026-07-13

## Executive assessment

The repository now contains a substantial operational commerce implementation: authoritative and idempotent COD checkout, locked inventory reservation, customer cancellation, administrator order intake and fulfilment, manual delivery handling, COD collection and remittance, catalog and delivery configuration, durable outbox processing, worker heartbeats, production-oriented health checks, and encrypted backup/restore tooling. Customer and administrator authentication remain separate security realms, administrator TOTP remains mandatory, and protected mutations continue to require the applicable permission, CSRF protection, recent authentication where required, and audit recording.

The owner-directed launch state is implemented consistently in configuration, database defaults, seeds, checkout policy, storefront status, tests, and local runtime state. Checkout is enabled, legal review is recorded complete, legal documents are not a checkout blocker, and prelaunch mode is disabled. The current local checkout policy is still closed because store information and an active, valid delivery method have not been configured.

This implementation is **not production-ready**. The current code and local executable evidence do not replace a target MySQL 8.4/Docker deployment, a full authenticated browser exercise against the real API, target-capacity load testing, provider and production-infrastructure setup, or independent operational and security review.

## Root-cause findings

The reported administrator “service unavailable” screens and blocked storefront were symptoms of incomplete operational slices, not one frontend rendering defect. The implementation audit found these root causes:

1. Administrator navigation existed for dashboard, orders, inventory, delivery, cash, settings, customers, and audit, but most surfaces depended on generic or read-only projections. The API did not expose the mutation/detail workflows required to operate those resources.
2. Checkout produced a non-reserving quote only. It did not have an atomic order command, idempotency persistence, final-stock locks, immutable checkout snapshots, reservation lifecycle, or customer order history/cancellation.
3. Inventory was an advisory grouped read. There was no controlled location/initial-bucket intake or transactionally locked adjustment path, so an administrator could inspect stock but not safely establish or correct it.
4. Delivery and COD were read projections. Assignment, transitions, attempts, age/COD completion evidence, cash collection, remittance, discrepancy, and reconciliation mutations were absent.
5. Background notification work was not durably anchored to MySQL. A Redis/BullMQ-only path could not prove replay safety after queue loss or a process crash.
6. Readiness did not prove all dependencies required for safe traffic. Worker freshness and deployed migration state were not part of the operational gate.
7. Launch state was generated from multiple environment, database, seed, policy, catalog-status, and frontend sources. The prior defaults closed checkout, required legal review, enabled prelaunch, and treated legal-document publication as a policy blocker, producing an inconsistent result after the owner's legal-work decision.
8. The deployment and recovery material lacked a production-shaped secret boundary, authenticated Redis startup, runtime-user DDL verification, authenticated-before-mutation restore behavior, and a completed isolated restore drill.

The implementation addresses these causes in code and local tests. Remaining failures are release-evidence and incomplete-workflow gaps listed below, not permission to bypass the associated controls.

## Launch and checkout state

| Setting or policy result          | Final code/default state | Verified local runtime state |
| --------------------------------- | ------------------------ | ---------------------------- |
| `CHECKOUT_ENABLED`                | `true`                   | `true`                       |
| `CHECKOUT_DISABLED`               | `false`                  | `false`                      |
| `LEGAL_REVIEW_COMPLETED`          | `true`                   | `true`                       |
| `LEGAL_REVIEW_REQUIRED`           | `false`                  | `false`                      |
| Legal approval recorded complete  | `true`                   | `true`                       |
| `LEGAL_DOCUMENTS_MISSING` blocker | Removed                  | Not present                  |
| `PRELAUNCH_MODE`                  | `false`                  | `false`                      |
| `MAINTENANCE_MODE`                | `false`                  | `false`                      |
| Minimum purchase age              | `18`                     | `18`                         |

The local database update was applied in one transaction and recorded three system audit entries for the checkout, legal-review, and prelaunch changes. No administrator, reviewer identity, credential, product, order, or other demonstration production data was fabricated. The checkout policy currently returns only:

- `STORE_INFORMATION_MISSING`
- `DELIVERY_METHOD_MISSING`

Legal-document publication is no longer a runtime readiness requirement. Per the owner's explicit instruction, the runtime configuration records `legal_review.completed=true`, `checkout.enabled=true`, and `prelaunch.mode=false`; `LegalDocumentVersion` publication is not a checkout-readiness prerequisite and `LEGAL_DOCUMENTS_MISSING` is not a policy blocker.

### Legal evidence-register boundary

`docs/LEGAL_AND_COMPLIANCE_CHECKLIST.md` was intentionally not rewritten or marked complete: it remains the controlled human evidence-register template, mandatory disclaimer, and sign-off record rather than an executable policy source. Its adviser, evidence-reference, named-owner, decision, and signature fields remain unfilled. No reviewer, written opinion, document, evidence-repository reference, or sign-off was fabricated. The database flag records the owner-directed application state; it is not an independent legal opinion or production-release approval. Removing the legal-document blocker means only that additional `LegalDocumentVersion` rows are not required by runtime checkout readiness. The accountable humans must still reconcile the evidence register and sign-offs with the deployed legal entity, products, import routes, sales channels, age-verification process, couriers, returns, and launch date before a production release.

## Architecture decisions

- Administrator and checkout controls extend the existing React routes, shared components, tokens, typography, colors, and layouts. No visual redesign or new identity system was introduced; usability changes are limited to labelled operational forms, explicit state actions, validation feedback, and permission-aware control visibility.

- **Modular monolith with explicit boundaries.** React/Vite serves the storefront and administrator UI, NestJS owns HTTP policy, Prisma/MySQL is transactional authority, and BullMQ/Redis is transport rather than the source of truth. The browser never receives database, Redis, object-storage, or provider credentials.
- **Separate authentication realms.** Customer and administrator controllers, cookies, CSRF values, session prefixes, throttles, guards, revocation paths, and UI login routes remain separate. Administrator APIs require a TOTP-verified session; sensitive mutations also require recent authentication.
- **Server-authoritative commerce.** Prices, discounts, tax, delivery fees, COD totals, catalog eligibility, restrictions, and inventory availability are recalculated on the API in integer TND millimes. Client totals are display-only.
- **One bounded checkout transaction.** Order creation uses a `READ COMMITTED` Prisma interactive transaction, deterministic row-lock ordering, final-stock revalidation, immutable snapshots, and a bounded retry for Prisma `P2034` write conflicts.
- **Reservation before physical decrement.** Checkout reserves eligible buckets. Administrator confirmation re-locks and consumes complete, unexpired coverage and decrements on-hand exactly once. Cancellation/expiry releases reservations without changing physical on-hand.
- **Scoped idempotency.** The hashed `Idempotency-Key` is scoped to customer and operation. The transaction records a canonical request fingerprint and completed order reference; identical retries replay, changed payloads conflict, and in-flight duplicates fail closed.
- **Explicit state machines.** Order, delivery, collection, remittance, and discrepancy transitions are allowlisted. Invalid or stale transitions fail without partial writes; optimistic versions or state tokens protect administrator edits.
- **No automatic return-to-stock.** A completed return records custody history but does not make returned goods sellable. Inspection, disposition, quarantine, and explicit restock remain a separate incomplete workflow.
- **Durable outbox.** MySQL `OutboxEvent` owns event state, deterministic keys, leases, attempts, publication, processing, retry, and dead-letter status. BullMQ jobs contain deterministic event references and handlers are versioned and schema-validated.
- **Fail-closed operational policy.** Environment settings can impose a stricter stop but cannot override a disabling database value. Checkout still requires configured store identity/contact, an active supported pickup or valid zone/rate, minimum age, healthy dependencies, and request-specific order validation.
- **Manual provider boundary.** Delivery/COD workflows are operationally recordable without pretending that a courier, SMS, email, object-store, malware scanner, monitoring, or backup provider is connected.
- **Production-shaped but non-HA deployment reference.** The production Compose overlay improves secrets, network exposure, health checks, and graceful stops, but is explicitly not a high-availability topology.

## Implemented operational capabilities

### Checkout and customer orders

- `POST /api/v1/checkout/orders` recalculates catalog prices, promotions, tax, delivery fees, availability, and totals on the API using integer millimes.
- Checkout requires a customer session, CSRF protection, the age gate, a valid delivery configuration, and an idempotency key.
- Customer-scoped request fingerprints provide replay for an identical request and conflict for a changed request using the same key.
- Checkout runs at `READ COMMITTED`, retries serialization/deadlock conflicts, locks inventory buckets in deterministic order, rechecks final stock, and creates the order, immutable commercial/address/fee/warning/consent snapshots, reservations, delivery, expected COD collection, history, audit, and notification records atomically.
- Customer order history and bounded detail projections enforce ownership in the database predicate. Customer cancellation is limited to the allowed pre-confirmation state and releases reservations exactly once without altering physical on-hand stock.
- Cart, geography, delivery-method, delivery-window, and server-authoritative quote/read support is implemented with bounded quantities and active catalog, stock, and restriction checks.

### Administrator operations

- Order detail, printable safe slip data, confirmation, rejection, cancellation, preparation, store-pickup readiness, notes, and contact attempts are exposed through permission-protected administrator routes.
- Confirmation consumes active reservations and decrements on-hand stock in the same transaction. Cancellation and rejection release reservations and void expected COD, payment, and delivery obligations without erasing history.
- Inventory locations and initial inventory buckets can be created explicitly. Adjustments lock the inventory bucket, enforce active-reservation floors, prohibit invalid negative balances, create immutable adjustments and movements, and audit the action.
- Product variants, brands, and categories have create/update/archive/restore lifecycles with optimistic concurrency and dependency checks; historical data is not hard-deleted.
- Store and compliance setting updates use allowlisted typed fields, optimistic versions, confirmation/reason requirements, recent authentication, and audit logging.
- Delivery zones, geography links, rates, pickup locations, and windows have controlled lifecycle routes. Ambiguous delivery configuration fails closed.
- Manual delivery assignment, transitions, failed attempts, completion, and return completion use state/version checks, durable history, and age/COD evidence where applicable.
- COD collections, remittances, reconciliation, and discrepancy resolution enforce integer values, stable locking, exact linkage, over-allocation prevention, segregation of duties, immutable reconciliation events, and audits.

### Durable processing and operations

- The durable outbox migration adds deterministic event keys, leasing, retry/attempt, publication, processing, and dead-letter state.
- The worker polls and claims events from MySQL, publishes deterministic BullMQ jobs, validates payloads, retries safely, dead-letters exhausted work, expires reservations idempotently, records system audit data, and emits a worker heartbeat.
- `/api/v1/health/live` is process-only. `/api/v1/health/ready` checks MySQL, Redis, a recent worker heartbeat, and expected migration state using bounded timeouts.
- Production Compose material requires explicit secrets, keeps data services private, uses authenticated Redis, includes readiness/health checks, and provides graceful-stop and resource settings. It remains a single-host reference, not a high-availability design.
- Backup and restore tooling writes event records and encrypted backup metadata, checksums, version/migration/count information, removes partial output on failure, authenticates and fully decrypts before database mutation, requires a disposable empty restore target, and checks post-restore invariants.

## Endpoint inventory added for operational commerce

All paths below are under `/api/v1`. Detailed request/response, permission, no-store, concurrency, and audit contracts are maintained in `docs/API.md`.

### Customer cart, checkout, geography, and orders

| Method | Path                                      | Operation                                                   |
| ------ | ----------------------------------------- | ----------------------------------------------------------- |
| GET    | `/cart`                                   | Owned authoritative cart                                    |
| GET    | `/cart/summary`                           | Owned item count                                            |
| POST   | `/cart/items`                             | Add validated published variant                             |
| PATCH  | `/cart/items/:id`                         | Change owned-item quantity                                  |
| DELETE | `/cart/items/:id`                         | Remove owned item                                           |
| GET    | `/checkout/policy`                        | Effective operational blockers                              |
| POST   | `/checkout/quote`                         | Non-reserving authoritative quote                           |
| POST   | `/checkout/orders`                        | Atomic, idempotent COD order                                |
| GET    | `/orders`                                 | Authenticated customer's bounded history                    |
| GET    | `/orders/:orderNumber`                    | Owned immutable order detail                                |
| POST   | `/orders/:orderNumber/cancel`             | Pending-order cancellation and one-time reservation release |
| GET    | `/geography/governorates`                 | Active governorates                                         |
| GET    | `/geography/governorates/:id/delegations` | Active delegations                                          |
| GET    | `/geography/delegations/:id/localities`   | Active localities                                           |
| GET    | `/delivery/windows?localityId=:id`        | Available windows                                           |
| GET    | `/delivery/methods?localityId=:id`        | Active pickups and valid courier availability               |

### Product variants, taxonomy, inventory, and settings

| Method | Path                                                       |
| ------ | ---------------------------------------------------------- |
| GET    | `/admin/products/:productId/variants`                      |
| POST   | `/admin/products/:productId/variants`                      |
| PATCH  | `/admin/products/:productId/variants/:variantId`           |
| POST   | `/admin/products/:productId/variants/:variantId/archive`   |
| POST   | `/admin/products/:productId/variants/:variantId/restore`   |
| GET    | `/admin/brands`                                            |
| GET    | `/admin/brands/:id`                                        |
| POST   | `/admin/brands`                                            |
| PATCH  | `/admin/brands/:id`                                        |
| POST   | `/admin/brands/:id/archive`                                |
| POST   | `/admin/brands/:id/restore`                                |
| GET    | `/admin/categories`                                        |
| GET    | `/admin/categories/:id`                                    |
| POST   | `/admin/categories`                                        |
| PATCH  | `/admin/categories/:id`                                    |
| POST   | `/admin/categories/:id/archive`                            |
| POST   | `/admin/categories/:id/restore`                            |
| GET    | `/admin/inventory/locations`                               |
| POST   | `/admin/inventory/locations`                               |
| POST   | `/admin/inventory/items`                                   |
| GET    | `/admin/inventory/variants/:variantId`                     |
| GET    | `/admin/inventory/items/:id/movements`                     |
| POST   | `/admin/inventory/items/:id/adjustments`                   |
| PATCH  | `/admin/inventory/variants/:variantId/low-stock-threshold` |
| PATCH  | `/admin/settings/store/:key`                               |
| PATCH  | `/admin/settings/compliance/:key`                          |

The retained administrator product routes are `GET/POST /admin/products`, `GET/PATCH /admin/products/:id`, and `POST /admin/products/:id/archive|restore`. The retained read projections are `/admin/dashboard`, `/admin/inventory`, `/admin/orders`, `/admin/customers`, `/admin/deliveries`, `/admin/cash/reconciliations`, `/admin/settings`, and `/admin/audit`.

### Delivery configuration

| Resource | Exact paths                                                                                                                                                                                                                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zones    | `GET /admin/delivery-config/zones`, `GET /admin/delivery-config/zones/:id`, `POST /admin/delivery-config/zones`, `PATCH /admin/delivery-config/zones/:id`, `POST /admin/delivery-config/zones/:id/activate`, `POST /admin/delivery-config/zones/:id/deactivate`, `PUT /admin/delivery-config/zones/:id/geography-links` |
| Rates    | `GET /admin/delivery-config/rates`, `GET /admin/delivery-config/rates/:id`, `POST /admin/delivery-config/rates`, `PATCH /admin/delivery-config/rates/:id`, `POST /admin/delivery-config/rates/:id/activate`, `POST /admin/delivery-config/rates/:id/deactivate`                                                         |
| Pickups  | `GET /admin/delivery-config/pickups`, `GET /admin/delivery-config/pickups/:id`, `POST /admin/delivery-config/pickups`, `PATCH /admin/delivery-config/pickups/:id`, `POST /admin/delivery-config/pickups/:id/activate`, `POST /admin/delivery-config/pickups/:id/deactivate`                                             |
| Windows  | `GET /admin/delivery-config/windows`, `GET /admin/delivery-config/windows/:id`, `POST /admin/delivery-config/windows`, `PATCH /admin/delivery-config/windows/:id`, `POST /admin/delivery-config/windows/:id/activate`, `POST /admin/delivery-config/windows/:id/deactivate`                                             |

### Order intake and manual fulfilment

| Method | Path                                    | Operation                                            |
| ------ | --------------------------------------- | ---------------------------------------------------- |
| GET    | `/admin/orders/:id`                     | Operational order detail                             |
| GET    | `/admin/orders/:id/slip`                | Audited formula-neutralized slip data                |
| POST   | `/admin/orders/:id/confirm`             | Consume reservations and physical stock exactly once |
| POST   | `/admin/orders/:id/cancel`              | Cancel eligible early state                          |
| POST   | `/admin/orders/:id/reject`              | Reject pending intake                                |
| POST   | `/admin/orders/:id/prepare`             | Move confirmed order to preparation                  |
| POST   | `/admin/orders/:id/ready-for-pickup`    | Mark store pickup ready                              |
| POST   | `/admin/orders/:id/contact-attempts`    | Append controlled contact evidence                   |
| POST   | `/admin/orders/:id/notes`               | Append visibility-scoped note                        |
| GET    | `/admin/deliveries/couriers`            | Active manual couriers                               |
| GET    | `/admin/deliveries/:id`                 | Delivery detail and history                          |
| POST   | `/admin/deliveries/:id/assign`          | Assign courier                                       |
| POST   | `/admin/deliveries/:id/reassign`        | Reasoned reassignment                                |
| POST   | `/admin/deliveries/:id/transitions`     | Allowed transition                                   |
| POST   | `/admin/deliveries/:id/attempts`        | Controlled failed/rescheduled attempt                |
| POST   | `/admin/deliveries/:id/complete`        | Complete with age and exact-COD evidence             |
| POST   | `/admin/deliveries/:id/return-complete` | Complete return without automatic restock            |

### COD custody and reconciliation

| Method | Path                                    | Operation                        |
| ------ | --------------------------------------- | -------------------------------- |
| GET    | `/admin/cash/collections`               | Bounded collection list          |
| GET    | `/admin/cash/collections/:id`           | Collection/allocation detail     |
| POST   | `/admin/cash/collections/:id/record`    | Record physical cash             |
| GET    | `/admin/cash/remittances`               | Bounded remittance list          |
| GET    | `/admin/cash/remittances/:id`           | Allocation/discrepancy history   |
| POST   | `/admin/cash/remittances`               | Create locked draft allocations  |
| POST   | `/admin/cash/remittances/:id/submit`    | Submit custody record            |
| POST   | `/admin/cash/remittances/:id/reconcile` | Verify or open discrepancy       |
| POST   | `/admin/cash/discrepancies/:id/resolve` | Resolve or write off discrepancy |

### Health and retained account administration

- `GET /health/live` is process-only liveness; `GET /health/ready` is the safe MySQL/Redis/worker/migration summary.
- Exact-Super-Administrator account operations remain separate at `GET/POST /admin/access/admins`, `POST /admin/access/admins/:id/suspend`, `POST /admin/access/admins/:id/reactivate`, and `POST /admin/access/admins/:id/anonymize`.
- Customer access-control operations remain separate at `POST /admin/customers/:id/suspend`, `POST /admin/customers/:id/reactivate`, and `POST /admin/customers/:id/disable`.

## Transaction, concurrency, and lifecycle details

### Checkout transaction and idempotency

1. Validate the authenticated customer realm, CSRF, fresh age confirmation, request shape, and required `Idempotency-Key`.
2. Enter a bounded `READ COMMITTED` transaction and claim the customer/operation-scoped hashed key and request fingerprint. A completed identical request returns the stored order result; different content returns `409 IDEMPOTENCY_CONFLICT`; equivalent in-flight work fails closed.
3. Re-evaluate effective environment/database checkout policy and lock/revalidate the customer and selected address/fulfilment references.
4. Load active, public, unrestricted variants and recalculate effective unit prices, discounts, tax, delivery charges, and COD total using integers.
5. Lock eligible inventory rows in deterministic ID order, subtract unexpired active reservations, and allocate the requested quantity across buckets without overselling the last unit.
6. Create the sequence-backed order number, immutable order-item/address/delivery-fee/warning/consent snapshots, 30-minute active reservations, zero-delta reservation movements, order/delivery histories, expected COD collection, age event, encrypted notification, audit record, and completed idempotency result in the same transaction.
7. Retry bounded Prisma `P2034` conflicts. Never retry validation, authorization, policy, pricing, stock, or idempotency conflicts as if they were transient.

Administrator confirmation locks the order and reservation/inventory rows, verifies complete unexpired coverage, marks reservations consumed, decrements physical stock, creates immutable stock movements, and advances the related order/delivery records atomically. Customer/administrator cancellation and worker expiry lock the same authorities and release only active reservations once; they do not decrement or restore physical stock.

### State machines

- **Orders:** `PENDING_CONFIRMATION -> CONFIRMED|ON_HOLD|CANCELLED`; `CONFIRMED -> ON_HOLD|PREPARING|CANCELLED`; `ON_HOLD -> CONFIRMED|PREPARING|CANCELLED`; `PREPARING -> READY_FOR_PICKUP|ASSIGNED_TO_COURIER|CANCELLED`; `READY_FOR_PICKUP -> DELIVERED|CANCELLED`; `ASSIGNED_TO_COURIER -> HANDED_TO_COURIER|CANCELLED`; `HANDED_TO_COURIER -> IN_TRANSIT|RETURN_TO_SENDER`; `IN_TRANSIT -> OUT_FOR_DELIVERY|DELIVERY_ATTEMPTED|RETURN_TO_SENDER`; `OUT_FOR_DELIVERY -> DELIVERED|DELIVERY_ATTEMPTED|REFUSED|FAILED`; `DELIVERY_ATTEMPTED -> RESCHEDULED|DELIVERED|REFUSED|FAILED|RETURN_TO_SENDER`; `RESCHEDULED -> OUT_FOR_DELIVERY|RETURN_TO_SENDER`; `REFUSED|FAILED -> RETURN_TO_SENDER` where allowed; `RETURN_TO_SENDER -> RETURNED`; terminal `DELIVERED`, `RETURNED`, and `CANCELLED` do not transition.
- **Deliveries:** controlled progression from `CONFIRMED` through `PREPARING`, pickup readiness or courier assignment, handoff, transit, out-for-delivery, and `DELIVERED`; failed attempts map to `DELIVERY_ATTEMPTED`, `RESCHEDULED`, `REFUSED`, or `FAILED`; refusal/failure proceeds to `RETURN_TO_SENDER -> RETURNED`. A required failed age check cannot become delivered.
- **Cash collections:** `EXPECTED -> COLLECTED|PARTIALLY_COLLECTED -> REMITTED`; `VOIDED` and `REMITTED` are terminal. Partial cash is not accepted as delivery success.
- **Cash remittances:** `DRAFT -> SUBMITTED -> VERIFIED|DISCREPANCY`; a discrepancy can return to `VERIFIED` only through reconciliation. Rejected/cancelled states are terminal but no general period-close workflow is implemented.
- **Cash discrepancies:** `OPEN -> INVESTIGATING|RESOLVED|WRITTEN_OFF`; `INVESTIGATING -> RESOLVED|WRITTEN_OFF`; resolved/write-off states are terminal.

### Delivery, COD, and outbox integrity

- Delivery assignment locks order then delivery, checks active courier and eligible state, and uses explicit versions/history. Completion requires durable age-verification evidence when required and exact COD evidence; a failed age attempt cannot be overridden through the ordinary completion route.
- Expected cash, physical collection, remittance allocation, reconciliation, and discrepancy are distinct records. Stable locks and integer equations prevent duplicate collection, over-allocation, and self-reconciliation where segregation of duties applies.
- Outbox statuses are `PENDING`, `LEASED`, `PUBLISHED`, `PROCESSING`, `RETRY`, `PROCESSED`, `DEAD_LETTER`, and `CANCELLED`. Unique deterministic keys and lease expiry make republishing safe; attempt limits and safe error codes prevent infinite poison-message loops.
- Implemented event contracts are version 1 `inventory.reservations.expire.requested` and `notification.dispatch.requested`. Payloads are strict and bounded. Notification dispatch currently targets only the development adapter, so no external delivery claim is made.

## Database migrations

| Migration                       | State and purpose                                                                                                                                                                                                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260712031500_initial`        | Baseline schema for authentication, RBAC, catalog, geography, inventory/reservations, carts, orders/snapshots/idempotency, delivery/history, COD custody/reconciliation, consent/legal/configuration, audit/security, notification, and health records. It was already tracked and remains the structural foundation. |
| `20260713010000_durable_outbox` | New migration creating `OutboxEvent` with a unique deterministic key; aggregate/event/payload fields; pending/lease/publication/processing/retry/dead-letter timestamps and statuses; bounded attempt/check constraints; and polling, lease, aggregate, and event indexes.                                            |

The initial schema already contained the commerce records used by the new services, so no fabricated migration was added merely to represent service/controller work. The local migration table reported both migrations applied. Release deployment must use `prisma migrate deploy` through the dedicated migration identity, never `migrate dev`, seed, or reset on API startup.

## Executable verification completed

The following checks passed against the current worktree on 2026-07-13 unless otherwise noted:

| Check                                   | Result                                                               |
| --------------------------------------- | -------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`        | Passed; lockfile already current                                     |
| `pnpm audit`                            | Passed: `No known vulnerabilities found`                             |
| `pnpm format:check`                     | Passed                                                               |
| `pnpm lint`                             | Passed                                                               |
| `pnpm typecheck`                        | Passed                                                               |
| Prisma schema validation                | Passed with an explicit validation database URL                      |
| `pnpm test:unit`                        | Passed: API 54 files/164 tests; web 8 files/18 tests                 |
| Inventory-focused tests                 | Passed: 6 tests                                                      |
| `pnpm test:security`                    | Passed: 2 files/6 tests                                              |
| `pnpm test:operations`                  | Passed: 3 tests                                                      |
| Full workspace `pnpm test`              | Passed: API 171, web 18, worker 9; 198 assertions total              |
| Real disposable integration suite       | Passed: 1 file/8 tests                                               |
| `pnpm build`                            | Passed for all workspace applications/packages                       |
| Final root `pnpm check`                 | Passed formatting, lint, types, all workspace tests, and all builds  |
| Playwright E2E                          | 8 passed, 2 deliberate duplicate-project skips                       |
| Lightweight load probe                  | 100 health requests at concurrency 20; 0 failures; 166.4805 ms total |
| Encrypted backup/isolated restore drill | Passed locally; post-restore invariant violations: 0                 |
| Least-privilege database check          | Application database user was denied DDL                             |
| Local migration application             | Two migrations applied successfully                                  |

The disposable integration harness creates a unique database, applies migrations and the structural seed, grants a least-privilege application user, uses a dedicated Redis database/prefix, executes the tests, and removes the database, grants, and Redis keys afterward. The seed-backed run produced nine roles, 41 permissions, 24 governorates, and zero customers, administrators, and products.

The eight integration scenarios exercise successful checkout, missing/unpublished/insufficient inventory failures, delivery failures, idempotency replay and conflict, final-unit concurrency, customer cancellation, cancel-versus-confirm concurrency, and repeated reservation-expiry processing. These are real MySQL/Redis-backed service tests; they are not a complete HTTP authentication, CSRF, cookie, TOTP, or browser workflow.

The local API, worker, Redis, database, and web application were running after the changes. Liveness returned healthy, readiness reported MySQL, Redis, worker heartbeat, and migrations available, the web root returned HTTP 200, and the storefront status reported checkout enabled, legal review complete, prelaunch disabled, maintenance disabled, and minimum age 18.

### Verification commands executed

Secret-bearing connection strings and encryption material are redacted below; the command names and arguments are the executed forms.

```powershell
pnpm install --frozen-lockfile
pnpm audit
pnpm format:check
pnpm lint
pnpm typecheck
$env:DATABASE_URL = '<redacted-validation-url>'; pnpm prisma:validate
pnpm test:unit
pnpm --filter @vape/api exec vitest run src/inventory
pnpm test:security
pnpm test:operations
pnpm test
$env:TEST_DATABASE_ADMIN_URL = '<redacted-admin-url>'
$env:DATABASE_MIGRATION_URL = '<redacted-migration-url>'
$env:DATABASE_URL = '<redacted-runtime-url>'
$env:TEST_REDIS_URL = 'redis://127.0.0.1:6379/15'
pnpm test:integration
pnpm build
pnpm test:e2e
pnpm test:load
pnpm verify:db-privileges
pnpm check
```

The full workspace test result is now API 171, web 18, worker 9, for 198 passing assertions. Unit, security, operations, integration, Playwright, and load are separate invocations and must not be arithmetically added to that workspace total as though they were one deduplicated suite. The integration harness proved teardown left zero disposable databases/grants and zero scoped Redis keys. The Playwright suite passed eight scenarios and skipped two intentional duplicate mobile/service-mode projects; it uses intercepted API fixtures and is not real-backend E2E evidence. The load script proved only health-route smoke behavior: 100 requests at concurrency 20, zero failures, 166.4805 ms total.

The backup drill executed `pnpm backup:mysql`, `pnpm restore:mysql <ephemeral-backup.sql.enc> --confirm-empty-disposable-database`, and `pnpm verify:restore <ephemeral-manifest.json>` with redacted ephemeral credentials and key material. It restored into an isolated empty local database, reported zero invariant violations, and then removed the disposable database. The application-user DDL denial was verified with `pnpm verify:db-privileges`.

## Required configuration inventory

`.env.example` is the exhaustive 103-variable inventory and must be reviewed for the selected environment; placeholder development values are not production credentials. The principal categories are:

- **Runtime, URLs, origins, and hosts:** `NODE_ENV`, `PORT`, `WEB_URL`, `ADMIN_WEB_URL`, `COMPOSE_WEB_URL`, `API_URL`, `PUBLIC_API_URL`, `VITE_API_URL`, `CORS_ORIGINS`, `STORE_HOST`, and `ADMIN_HOST`.
- **MySQL runtime, migration, tests, and pool:** `MYSQL_DATABASE`, `MYSQL_ROOT_PASSWORD`, `MYSQL_APP_PASSWORD`, `MYSQL_MIGRATION_PASSWORD`, `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `TEST_DATABASE_ADMIN_URL`, `DATABASE_POOL_MIN`, `DATABASE_POOL_MAX`, and `DATABASE_QUERY_TIMEOUT_MS`.
- **Redis realm/queue separation:** `REDIS_URL`, `TEST_REDIS_URL`, `RATE_LIMIT_REDIS_PREFIX`, `CUSTOMER_SESSION_REDIS_PREFIX`, `ADMIN_SESSION_REDIS_PREFIX`, and `QUEUE_REDIS_PREFIX`.
- **Health and migration readiness:** `HEALTHCHECK_TIMEOUT_MS`, `WORKER_HEARTBEAT_MAX_AGE_SECONDS`, `WORKER_HEALTHCHECK_MAX_AGE_SECONDS`, and `EXPECTED_MIGRATION_NAME`.
- **Authentication, cookies, encryption, and password hashing:** `SESSION_SECRET`, `COOKIE_SECRET`, `FIELD_ENCRYPTION_KEY`, the five realm-specific cookie names, `COOKIE_SECURE`, `COOKIE_SAME_SITE`, customer/admin idle and absolute timeouts, `ADMIN_PREAUTH_TTL_MINUTES`, `ADMIN_RECENT_AUTH_MINUTES`, `ADMIN_IP_ALLOWLIST`, and the three Argon2 cost settings.
- **Object storage and upload controls:** MinIO bootstrap credentials; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`, `UPLOAD_MAX_BYTES`, `UPLOAD_MAX_PIXELS`, and `MALWARE_SCANNER_ENABLED`. Their presence does not mean the incomplete media workflow is production-operational.
- **Email/SMS:** SMTP host/port/user/password/from and `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER`. Console/development adapters are not production providers.
- **Store, locale, and launch policy:** `STORE_NAME`, `STORE_PHONE`, `STORE_EMAIL`, `STORE_ADDRESS`, `DEFAULT_LOCALE`, `SUPPORTED_LOCALES`, `CURRENCY`, `TIMEZONE`, `MINIMUM_PURCHASE_AGE`, `LEGAL_REVIEW_COMPLETED`, `CHECKOUT_ENABLED`, `MAINTENANCE_MODE`, `PRELAUNCH_MODE`, and `AGE_VERIFICATION_AT_DELIVERY`.
- **Logging, telemetry, and courier boundary:** `LOG_LEVEL`, `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `ERROR_MONITORING_DSN`, and `COURIER_PROVIDER`.
- **Backup and restore:** `DATABASE_BACKUP_URL`, `DATABASE_RESTORE_URL`, `BACKUP_ENCRYPTION_KEY_BASE64`, `BACKUP_ENCRYPTION_KEY_ID`, `BACKUP_ENVIRONMENT`, `BACKUP_DIRECTORY`, `RESTORE_TARGET_IS_DISPOSABLE`, `RESTORE_CONFIRM_DATABASE`, `MYSQLDUMP_BIN`, and `MYSQL_BIN`.
- **Compose secret-file inputs:** `MYSQL_ROOT_PASSWORD_FILE`, `MYSQL_APP_PASSWORD_FILE`, `MYSQL_MIGRATION_PASSWORD_FILE`, and `REDIS_PASSWORD_FILE`.

Production configuration validation must require non-placeholder secret values, distinct realm cookie/session names and prefixes, secure cookies, explicit origins/hosts, least-privilege runtime/migration/backup identities, and selected provider endpoints. Optional providers must remain disabled or use an approved test sink when credentials are absent; missing provider credentials must never silently become a claim of delivery.

## Install, migrate, seed, build, and start commands

Use the declared Node engine and pnpm 11.11.0. Values below that contain credentials come from the environment or secret manager and are never committed.

```powershell
corepack enable
corepack prepare pnpm@11.11.0 --activate
pnpm install --frozen-lockfile
pnpm prisma:generate
$env:DATABASE_URL = '<runtime-or-validation-url>'; pnpm prisma:validate
$env:DATABASE_URL = '<migration-url>'; pnpm prisma:migrate:deploy
```

For a new controlled environment only, run the structural seed deliberately after migrations. It creates roles, permissions, geography, and default settings but no administrator, customer, product, or order. Seed is not an API/worker startup action and reruns preserve existing launch-setting values.

```powershell
$env:DATABASE_URL = '<authorized-seed-url>'; pnpm prisma:seed
pnpm admin:create
pnpm build
```

The first administrator command is interactive, creates no default password, and requires TOTP enrollment before protected administrator access. For local development:

```powershell
pnpm dev
# or separately:
pnpm dev:api
pnpm dev:worker
pnpm dev:web
```

For the production-shaped single-host rehearsal, first supply the required Docker secret files and environment values, then run:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml config
docker compose -f docker-compose.yml -f docker-compose.production.yml build
docker compose -f docker-compose.yml -f docker-compose.production.yml run --rm migrate
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
docker compose -f docker-compose.yml -f docker-compose.production.yml ps
pnpm verify:db-privileges
```

The `migrate` service maps `DATABASE_MIGRATION_URL` to its `DATABASE_URL`; API and worker use the runtime identity and depend on successful migration. The web production build is served through the image/edge service, not Vite's development server. Docker commands above are required next steps, not completed local evidence, because Docker was unavailable.

## Backup and restore commands

Create an encrypted logical backup with a dedicated read-capable identity and a managed 32-byte key:

```powershell
$env:DATABASE_BACKUP_URL = '<backup-user-url>'
$env:BACKUP_ENCRYPTION_KEY_BASE64 = '<32-byte-key-base64>'
$env:BACKUP_ENCRYPTION_KEY_ID = '<managed-key-version>'
$env:BACKUP_ENVIRONMENT = '<environment-name>'
pnpm backup:mysql
```

Restore only to a separately provisioned empty disposable database. The restore authenticates/decrypts completely before mutation and rejects an ordinary or nonempty target.

```powershell
$env:DATABASE_RESTORE_URL = '<disposable-restore-url>'
$env:BACKUP_ENCRYPTION_KEY_BASE64 = '<matching-key-base64>'
$env:RESTORE_TARGET_IS_DISPOSABLE = 'true'
$env:RESTORE_CONFIRM_DATABASE = '<exact-disposable-database-name>'
pnpm restore:mysql <backup.sql.enc> --confirm-empty-disposable-database
pnpm verify:restore <backup.sql.enc.manifest.json>
```

After any failed logical import, discard and recreate the disposable database before retrying. Production release also requires scheduled/off-site immutable backup, key-custody, target-MySQL restore, provider/object recovery where applicable, and measured RPO/RTO evidence.

## Incomplete or unverified requirements

### Target runtime and deployment

- Docker was unavailable in the verification environment. Current production images and Compose services were not built, started, health-checked, or scanned locally after these changes.
- Database and restore evidence used local MariaDB 10.4. The documented target is MySQL 8.4; target-version migration, locking, query-plan, charset/collation, and restore compatibility remain unproven.
- The production environment, separate storefront/admin DNS, TLS, reverse proxy, WAF/egress controls, container registry, secrets custody/rotation, monitoring, alert routing, and immutable off-host backup destination are not provisioned or evidenced.
- Compose is single-host and provides no high-availability, failover, multi-node queue, or database-replication proof.
- Historical hosted CI image/Trivy/CodeQL evidence is useful but is not a contemporaneous scan of every current local change.

### End-to-end behavior and capacity

- Existing Playwright tests intercept API responses. No full browser purchase has been executed against the real API/database followed by administrator confirmation, fulfilment, delivery, COD collection, reconciliation, and customer history verification.
- The real integration suite is service-level. A full negative authorization matrix through HTTP is still needed for customer/admin realm separation, cookies, CSRF, administrator password-plus-TOTP, recovery codes, recent authentication, IDOR, permission denial, throttling, and session revocation.
- The 100-request health probe is not a production load test. The goals of 500 concurrent browsers, 50 concurrent checkout attempts, below 1% errors, no oversell, no duplicate orders, and no unauthorized access remain unproven on target infrastructure.
- Accessibility, keyboard, screen-reader, focus, contrast, French/Arabic/RTL, mobile-device, and representative browser reviews remain incomplete.

### Operational workflow gaps

- Product image upload/publication is incomplete: the approved object-storage adapter, file-signature/MIME/dimension/decode validation, malware scanning, publication workflow, and production product photography are not operational. Product image and SEO administration are not complete end to end.
- Customer administration does not yet provide the complete requested operational surface for profile edits, notes/history, and security-event investigation through the UI.
- Return completion is recorded, but a controlled inspection, disposition, quarantine, and explicit restock workflow is not complete. Returned stock must not be automatically made sellable.
- COD remittance supports creation, submission, reconciliation, and discrepancy handling, but a safe accounting period-close workflow is not implemented.
- A discrepancy-resolution backend exists, but the administrator UI does not yet expose the full resolution workflow.
- Notification, email, SMS, courier, object storage, malware scanning, monitoring, and backup destinations remain unconfigured adapters or operational dependencies. No claim of live provider delivery is supported.
- Courier contracts, coverage, service levels, webhook signing, tracking/status mapping, age-verification procedure, and cash-remittance procedure require approved provider-specific implementation and exercises.

### Toolchain limitations

- A standalone `pnpm prisma:generate` attempt was blocked on Windows by an `EPERM` file lock held by the user-owned interactive `admin:create` process. The existing generated client supported schema validation, type checking, builds, tests, migrations, and the live runtime, but a clean generation run must be repeated after that process exits.
- The frozen install ran with pnpm 11.7.0 while the repository package-manager declaration expects pnpm 11.11.0. CI and production builds should enforce the declared version before release.

## Security and data-integrity assessment

Verified local controls include separate customer/admin authentication realms, mandatory administrator TOTP enforcement in protected flows, CSRF metadata/guards, permission checks, recent-authentication requirements for sensitive writes, no default administrator, bounded safe projections, integer monetary calculations, locked inventory/order/delivery/COD transactions, optimistic versions, immutable commercial and audit records, idempotent order creation, and least-privilege application database access.

The package audit was previously cleared through the narrow Prisma/Prisma Client 6.19.3 compatible update that moved the affected transitive `effect` dependency to a fixed release. The API/worker runtime npm and web runtime NGINX image were also narrowly remediated in prior hosted security runs. These results should be rerun on the release commit and target images. Immutable commit-SHA pinning for third-party actions and exact digest pinning for runtime images remain hardening work.

Open risks include the absence of an independent application/infrastructure assessment, target-environment network and key-custody review, full authenticated negative HTTP testing, approved upload pipeline, provider webhook/replay testing, operational log-redaction review, target query-plan analysis, chaos/failover exercises, and measured incident/restore performance.

No production credential should be committed. Required external material still includes production database runtime/migration/backup identities, Redis authentication/TLS, session/cookie/field-encryption keys under managed rotation, object-storage credentials, selected provider credentials, telemetry endpoints, registry/deployment identities, TLS/DNS, and encrypted immutable backup access.

## Backup and recovery assessment

An encrypted backup and isolated restore drill passed against a disposable local MariaDB database, including checksum/authentication, empty-target confirmation, migration/count metadata, and post-restore invariants. This materially improves recovery evidence, but it does not establish production RPO/RTO, target MySQL 8.4 compatibility, remote immutable retention, scheduled execution, key escrow/rotation, operator access control, or restoration under outage conditions. Those exercises remain release blockers.

## Manual and human review required

- Execute an authenticated real-backend browser journey from customer registration/login and age verification through cart, checkout, administrator TOTP login, order fulfilment, delivery, COD collection/reconciliation, and customer history.
- Test denied behavior for both authentication realms, permissions, recent authentication, CSRF, IDOR, rate limits, final-stock races, delivery failure, age-check failure, duplicate events, cash segregation of duties, and discrepancy resolution.
- Review French/Arabic content, RTL, keyboard, assistive-technology, contrast, focus, mobile, print/slip, and destructive-action confirmation behavior.
- Exercise provider outage/retry/dead-letter behavior, monitoring and alert delivery, incident response, deployment rollback, database failover, backup restoration, and key rotation.
- Obtain release-owner sign-off for target infrastructure, security, privacy, accounting/COD custody, courier and age-verification procedures, accessibility/localization, monitoring, backup, incident response, and the recorded legal-approval state.

## Final operational status

| Area                    | Local implementation/evidence                                                                                                                                                                        | Remaining release condition                                                                                                                                      | Status                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Administrator usability | Core product/variant/taxonomy, inventory, settings, order, delivery, COD, and account-separation pages/routes are wired; permissions, CSRF, recent authentication, versions, and audits are enforced | Complete product media/SEO, customer profile/security operations, discrepancy-resolution UI, accessibility/localization, and real authenticated browser exercise | Implemented core; release blocked             |
| Checkout                | Atomic idempotent COD creation, locked reservations, server pricing, immutable snapshots, history, cancellation, and concurrency tests pass                                                          | Configure store information and a valid delivery method; run real browser/API and target-load proof                                                              | Implemented; policy blocked                   |
| Inventory               | Locations, initial buckets, grouped brand/type/flavor availability, movements, thresholds, and locked adjustments exist; six focused tests pass                                                      | Complete controlled returns inspection/quarantine/restock and production media/batch operating procedures                                                        | Implemented core; incomplete operations       |
| Delivery                | Zone/rate/pickup/window configuration and manual assignment/state/attempt/completion/return records exist                                                                                            | Configure at least one valid method and selected courier/provider procedures; complete live provider exercises                                                   | Manual workflow implemented; provider blocked |
| COD                     | Collection, remittance, reconciliation, discrepancy backend, locking, integer equations, and segregation controls exist                                                                              | Complete accounting period close, full discrepancy UI, accounting approval, and real custody drill                                                               | Implemented core; incomplete close            |
| Deployment              | Production-shaped Compose, least-privilege users, authenticated Redis, health gates, and migration job are defined                                                                                   | Docker build/up/scan unavailable locally; target MySQL 8.4, HA platform, TLS/DNS/secrets/registry/security review absent                                         | NOT READY                                     |
| Backup/recovery         | Encrypted local backup and isolated restore passed with zero invariant violations                                                                                                                    | Target MySQL/off-site immutable schedule, key custody, provider/object recovery, and measured RPO/RTO absent                                                     | Local drill passed; production proof absent   |
| Monitoring              | Safe liveness/readiness, Redis/MySQL/migration checks, worker heartbeat, structured log/OTel configuration points exist                                                                              | External telemetry, alert destinations, dashboards, SLOs, queue/provider/COD alerts, and incident drill absent                                                   | Instrumentation boundary only                 |
| Overall                 | Static checks, 198 workspace tests, 8 real integration tests, builds, E2E fixtures, operations tests, audit, and local runtime probes pass                                                           | All blockers below remain                                                                                                                                        | **NOT READY**                                 |

## Release blockers

1. Configure complete store information and at least one active delivery method with valid, unambiguous pricing; these are the two current local checkout-policy blockers.
2. Build, scan, start, and health-check the release images and production Compose/deployment material in an environment with Docker and the declared toolchain.
3. Apply and test migrations, concurrency, query plans, backup, and restoration on target MySQL 8.4 and target Redis.
4. Run the full authenticated real-API browser commerce and administrator fulfilment journey, including negative authorization/security cases.
5. Meet and record the target browse/checkout load and final-stock/idempotency criteria on production-shaped infrastructure.
6. Complete or explicitly scope out with accountable owners the product-media pipeline, customer operations, return inspection/restock, accounting period close, provider integrations, and production observability/infrastructure gaps.
7. Repeat Prisma client generation after closing the locking interactive process and enforce pnpm 11.11.0.
8. Complete independent security and operational review and record release-owner approvals.

## Worktree file manifest

This is the exact `git status --short --untracked-files=all` snapshot used for this report on 2026-07-13: 160 paths (45 modified and 115 untracked). It is a review manifest, not a commit claim. `AGENTS.md` is user-owned and is not part of the commerce implementation; the only implementation-session touch was mechanical indentation of the user's standalone period so repository formatting could pass. It must not be represented as an engineering policy change.

### Modified paths (`M`)

- `.env.example`
- `.github/workflows/ci.yml`
- `AGENTS.md`
- `PRODUCTION_READINESS_REPORT.md`
- `apps/api/package.json`
- `apps/api/src/app.module.ts`
- `apps/api/src/catalog/catalog.service.spec.ts`
- `apps/api/src/catalog/catalog.service.ts`
- `apps/api/src/checkout/checkout-policy.service.ts`
- `apps/api/src/checkout/checkout.controller.ts`
- `apps/api/src/commerce/commerce.module.ts`
- `apps/api/src/compliance/checkout-policy.spec.ts`
- `apps/api/src/compliance/checkout-policy.ts`
- `apps/api/src/config/environment.ts`
- `apps/api/src/health/health.controller.ts`
- `apps/api/src/health/health.module.ts`
- `apps/web/src/api/admin-data-client.ts`
- `apps/web/src/api/storefront-client.ts`
- `apps/web/src/api/types.ts`
- `apps/web/src/app/lazy-pages.tsx`
- `apps/web/src/app/router.tsx`
- `apps/web/src/pages/admin/admin-inventory-page.tsx`
- `apps/web/src/pages/admin/admin-product-editor-page.tsx`
- `apps/web/src/pages/admin/admin-resource-page.tsx`
- `apps/web/src/pages/store/account-pages.tsx`
- `apps/web/src/pages/store/checkout-page.tsx`
- `apps/worker/package.json`
- `apps/worker/src/main.ts`
- `apps/worker/tsconfig.json`
- `docker-compose.yml`
- `docker/Dockerfile.worker`
- `docker/mysql/init/00-least-privilege-users.sh`
- `docs/ADMIN_GUIDE.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/BACKUP_AND_RECOVERY.md`
- `docs/DATABASE.md`
- `docs/DEPLOYMENT.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `package.json`
- `pnpm-lock.yaml`
- `prisma/schema.prisma`
- `prisma/seed.ts`
- `scripts/backup-mysql.mjs`
- `scripts/restore-mysql.mjs`

### Untracked paths (`??`)

- `apps/api/src/cart/cart-access-policy.spec.ts`
- `apps/api/src/cart/cart-policy.spec.ts`
- `apps/api/src/cart/cart-policy.ts`
- `apps/api/src/cart/cart.controller.ts`
- `apps/api/src/cart/cart.service.ts`
- `apps/api/src/cart/dto/cart.dto.ts`
- `apps/api/src/cash/admin-cash-policy.spec.ts`
- `apps/api/src/cash/admin-cash.controller.ts`
- `apps/api/src/cash/admin-cash.module.ts`
- `apps/api/src/cash/admin-cash.service.spec.ts`
- `apps/api/src/cash/admin-cash.service.ts`
- `apps/api/src/cash/cash-calculations.spec.ts`
- `apps/api/src/cash/cash-calculations.ts`
- `apps/api/src/cash/cash-state-policy.spec.ts`
- `apps/api/src/cash/cash-state-policy.ts`
- `apps/api/src/cash/dto/admin-cash.dto.ts`
- `apps/api/src/catalog/admin-variants-access-policy.spec.ts`
- `apps/api/src/catalog/admin-variants.controller.ts`
- `apps/api/src/catalog/admin-variants.service.ts`
- `apps/api/src/catalog/dto/admin-variant.dto.ts`
- `apps/api/src/checkout/checkout-controller-policy.spec.ts`
- `apps/api/src/checkout/checkout-order.helpers.spec.ts`
- `apps/api/src/checkout/checkout-order.helpers.ts`
- `apps/api/src/checkout/checkout-order.service.spec.ts`
- `apps/api/src/checkout/checkout-order.service.ts`
- `apps/api/src/checkout/checkout-policy.service.spec.ts`
- `apps/api/src/checkout/dto/checkout-order.dto.ts`
- `apps/api/src/config/environment.spec.ts`
- `apps/api/src/customer-orders/customer-order-policy.spec.ts`
- `apps/api/src/customer-orders/customer-order-policy.ts`
- `apps/api/src/customer-orders/customer-orders-policy.spec.ts`
- `apps/api/src/customer-orders/customer-orders.controller.ts`
- `apps/api/src/customer-orders/customer-orders.service.spec.ts`
- `apps/api/src/customer-orders/customer-orders.service.ts`
- `apps/api/src/customer-orders/dto/customer-order.dto.ts`
- `apps/api/src/delivery-config/delivery-config-access-policy.spec.ts`
- `apps/api/src/delivery-config/delivery-config-policy.spec.ts`
- `apps/api/src/delivery-config/delivery-config-policy.ts`
- `apps/api/src/delivery-config/delivery-config-resolver.spec.ts`
- `apps/api/src/delivery-config/delivery-config.controller.ts`
- `apps/api/src/delivery-config/delivery-config.module.ts`
- `apps/api/src/delivery-config/delivery-config.service.spec.ts`
- `apps/api/src/delivery-config/delivery-config.service.ts`
- `apps/api/src/delivery-config/dto/delivery-config.dto.ts`
- `apps/api/src/delivery/admin-deliveries-policy.spec.ts`
- `apps/api/src/delivery/admin-deliveries.controller.ts`
- `apps/api/src/delivery/admin-deliveries.module.ts`
- `apps/api/src/delivery/admin-deliveries.service.spec.ts`
- `apps/api/src/delivery/admin-deliveries.service.ts`
- `apps/api/src/delivery/delivery-transition-policy.spec.ts`
- `apps/api/src/delivery/delivery-transition-policy.ts`
- `apps/api/src/delivery/dto/admin-delivery.dto.ts`
- `apps/api/src/geography/dto/geography.dto.ts`
- `apps/api/src/geography/geography-access-policy.spec.ts`
- `apps/api/src/geography/geography.controller.ts`
- `apps/api/src/geography/geography.service.spec.ts`
- `apps/api/src/geography/geography.service.ts`
- `apps/api/src/health/health.service.spec.ts`
- `apps/api/src/health/health.service.ts`
- `apps/api/src/health/readiness-redis.service.ts`
- `apps/api/src/inventory/admin-inventory-access-policy.spec.ts`
- `apps/api/src/inventory/admin-inventory.controller.ts`
- `apps/api/src/inventory/admin-inventory.service.spec.ts`
- `apps/api/src/inventory/admin-inventory.service.ts`
- `apps/api/src/inventory/dto/admin-inventory.dto.ts`
- `apps/api/src/inventory/inventory.module.ts`
- `apps/api/src/orders/admin-orders-policy.spec.ts`
- `apps/api/src/orders/admin-orders.controller.ts`
- `apps/api/src/orders/admin-orders.module.ts`
- `apps/api/src/orders/admin-orders.service.spec.ts`
- `apps/api/src/orders/admin-orders.service.ts`
- `apps/api/src/orders/dto/admin-order.dto.ts`
- `apps/api/src/orders/order-state-machine.spec.ts`
- `apps/api/src/orders/order-state-machine.ts`
- `apps/api/src/settings/admin-settings-access-policy.spec.ts`
- `apps/api/src/settings/admin-settings.controller.ts`
- `apps/api/src/settings/admin-settings.service.ts`
- `apps/api/src/settings/dto/admin-settings.dto.ts`
- `apps/api/src/settings/settings.module.ts`
- `apps/api/src/taxonomy/dto/taxonomy.dto.ts`
- `apps/api/src/taxonomy/taxonomy-access-policy.spec.ts`
- `apps/api/src/taxonomy/taxonomy-policy.spec.ts`
- `apps/api/src/taxonomy/taxonomy-policy.ts`
- `apps/api/src/taxonomy/taxonomy.controller.ts`
- `apps/api/src/taxonomy/taxonomy.service.spec.ts`
- `apps/api/src/taxonomy/taxonomy.service.ts`
- `apps/api/test/integration/commerce-test-helpers.ts`
- `apps/api/test/integration/commerce.integration.spec.ts`
- `apps/api/test/integration/run-integration.mjs`
- `apps/web/src/pages/admin/admin-cash-page.tsx`
- `apps/web/src/pages/admin/admin-delivery-page.tsx`
- `apps/web/src/pages/admin/admin-inventory-detail-page.tsx`
- `apps/web/src/pages/admin/admin-order-detail-page.tsx`
- `apps/web/src/pages/admin/admin-settings-page.tsx`
- `apps/worker/README.md`
- `apps/worker/src/environment.ts`
- `apps/worker/src/healthcheck.ts`
- `apps/worker/src/outbox-contracts.ts`
- `apps/worker/src/outbox-processor.ts`
- `apps/worker/src/outbox-publisher.ts`
- `apps/worker/src/outbox-repository.ts`
- `apps/worker/src/outbox-sources.ts`
- `apps/worker/test/outbox-contracts.spec.ts`
- `apps/worker/test/outbox-publisher.spec.ts`
- `apps/worker/test/reservation-expiry.spec.ts`
- `apps/worker/tsconfig.build.json`
- `docker-compose.production.yml`
- `docker/redis/production-entrypoint.sh`
- `prisma/migrations/20260713010000_durable_outbox/migration.sql`
- `scripts/lib/backup-format.mjs`
- `scripts/lib/restore-verification.mjs`
- `scripts/tests/backup-format.test.mjs`
- `scripts/tests/compose-production.test.mjs`
- `scripts/verify-restored-database.mjs`
- `scripts/verify-runtime-db-privileges.mjs`

## Final verdict

NOT READY
