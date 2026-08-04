# Architecture

## Decision summary

The system is a pnpm TypeScript modular monolith: one React/Vite web application, one stateless NestJS API, one independently scalable BullMQ worker, MySQL as the transactional system of record, Redis for ephemeral distributed coordination, and S3-compatible object storage for media. Nginx terminates edge HTTP concerns and proxies same-origin API traffic.

This shape keeps database transactions and business invariants in one deployment boundary while allowing web, API, and background work to scale separately. Microservices are deliberately deferred until measured operational pressure justifies their failure and consistency costs.

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

## Runtime components

| Component     | Responsibility                                                          | Persistent authority                                  |
| ------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| React web     | Storefront and /admin UI, i18n, RTL, accessible interaction             | None; server-backed state only                        |
| NestJS API    | Validation, authentication, RBAC, business rules, transactions, OpenAPI | MySQL through Prisma                                  |
| BullMQ worker | Durable-outbox publication, reservation expiry and notification retry   | Event/notification state in MySQL; transport in Redis |
| MySQL 8.4     | Orders, inventory, catalog, customer, delivery, COD, consent, audit     | Primary transactional record                          |
| Redis         | Sessions, rate limits, queues, short caches, distributed coordination   | Reconstructible except active sessions/queues         |
| S3/MinIO      | Original and derived product media, controlled evidence references      | Versioned object data                                 |
| Nginx         | TLS/proxy/static delivery, request limits, security headers             | None                                                  |

Mailpit and MinIO in Docker Compose are development services, not production service selections.

## Trust boundaries

1. Untrusted browser to Nginx: TLS in staging/production, request-size controls, explicit hosts, CSP and security headers.
2. Nginx to web/API: private network; forwarded host, scheme, IP, and request ID are trusted only from known proxies.
3. API/worker to MySQL: TLS where supported and separate least-privilege runtime/migration identities.
4. API/worker to Redis: private authenticated/TLS connection in production with distinct key namespaces.
5. API/worker to object storage, reviewed official catalog sources, and notification/courier providers: egress allowlist, timeouts, redirect/response bounds, safe DNS/IP validation where a provider is configurable, and credentials scoped to the adapter.
6. Administrator to privileged APIs: separate authentication realm, mandatory TOTP, permission checks, recent authentication, and audit.

## Authentication architecture

Customer and admin login are intentionally not variants of one endpoint.

| Property        | Customer realm                          | Administrator realm                                         |
| --------------- | --------------------------------------- | ----------------------------------------------------------- |
| UI entry        | /login                                  | /admin/login                                                |
| API prefix      | /api/v1/auth/customer/*                 | /api/v1/auth/admin/*                                        |
| Session cookie  | Distinct customer-only name             | Distinct admin-only name                                    |
| Redis namespace | session:customer:*                      | session:admin:*                                             |
| 2FA             | Optional                                | Mandatory TOTP or one-time recovery code                    |
| Session policy  | Longer configurable idle/absolute limit | Short idle/absolute limit                                   |
| CSRF/throttle   | Customer-specific token and buckets     | Admin-specific token and stricter buckets                   |
| Guard           | Customer principal only                 | Admin principal, full 2FA, suspension and permission checks |

The admin password step issues only a short-lived, narrowly scoped pending challenge. It is not an admin session and cannot call protected admin endpoints. Successful TOTP rotates the identifier and creates a full admin session. Logout, password change, suspension, role-critical events, and explicit revocation invalidate the relevant realm's sessions.

The customer realm optionally supports Google authorization code plus PKCE. Provider state lives only as encrypted, cookie-bound, expiring Redis records. Persistent `CustomerExternalIdentity` rows belong to `CustomerProfile`, contain a stable hashed subject and normalized presentation email, and contain no provider token. A verified-email match links to an eligible customer; it never crosses into `AdminProfile`. Provider-only customers may have a null local password, while a MySQL check and the administrator services continue to require an administrator password. Completing either password or Google authentication rotates an existing same-realm session cookie.

For staging/production, use different storefront and admin hostnames with host-only Secure cookies. At a minimum, cookie names and server-side credential extraction remain distinct; an admin guard never falls back to a customer cookie. Nginx may deny /admin on the storefront host, but that edge rule supplements rather than replaces API authorization.

## Module boundaries

NestJS modules follow the domains named in the product specification. Modules may call public application services, not another module's Prisma internals. The current API composes separate commerce, inventory, order intake, delivery configuration, manual delivery, cash, settings, health, access, and operations modules. Cross-domain operations are coordinated by explicit use cases:

- Catalog import separates untrusted intake from mutation. A bounded CSV/JSON or reviewed Wotofo payload becomes a persisted dry-run receipt with row issues and a canonical fingerprint; explicit apply revalidates that receipt and writes catalog/source records atomically. The official media phase fetches only reviewed Wotofo/Shopify HTTPS paths with bounded concurrency/retry/redirects, then passes bytes through the same decode/re-encode/checksum and object-storage boundary as manual uploads. Imports cannot publish or create inventory, and version-guarded rollback only archives unchanged create-only records.
- Checkout coordinates catalog, geography/rates, inventory, orders, consent, and a durable queued `Notification` plus its deterministic `OutboxEvent` in one database transaction. The worker source bridge only recovers eligible legacy notifications that predate that invariant.
- Delivery transition coordinates delivery history, order projection, age outcome, inventory return workflow, COD collection, and notifications.
- COD reconciliation coordinates collections, remittances, discrepancies, approval, and append-only audit.
- The operations gate reads environment overrides plus versioned store/compliance settings and is enforced inside quote and order creation, never only in React. Its launch blockers are checkout disabled, maintenance, prelaunch, a missing minimum age when an enabled age control needs it, incomplete store information, and absence of an active delivery method with valid pricing. Legal approval and `LegalDocumentVersion` publication are not software-readiness or global checkout prerequisites. A terms/privacy version supplied for an enabled consent snapshot is still validated as request data before it is recorded.

Customer carts and orders are currently authenticated-customer flows. There is no guest-cart checkout implementation. Manual courier/pickup workflows deliberately do not claim a real courier or payment-provider integration. Notification delivery is a separate provider-neutral worker boundary with production SMTP and authenticated HTTPS SMS adapters; selected provider credentials and staging evidence are still deployment requirements.

## Transaction and concurrency boundaries

Authenticated-customer COD checkout uses a bounded MySQL `READ COMMITTED` transaction with a five-second acquisition wait, 15-second transaction timeout, and at most three recognized transaction-conflict attempts:

1. Claim or lock a unique customer-scoped SHA-256 idempotency key and request fingerprint. A completed identical request replays its stored order response; a changed request conflicts.
2. Validate the operational launch policy, active customer/blocklist state, submitted items, catalog publication/restrictions, integer prices, and the confirmations enabled by operator configuration.
3. Lock inventory rows in a deterministic variant/location order.
4. Calculate active reservations and reject insufficient availability.
5. Resolve promotion and delivery rules and compute integer-millime totals.
6. Create immutable address, item, warning, delivery-fee/rule, and configured confirmation snapshots. Optional supplied terms/privacy version references are validated before snapshotting when those confirmations are enabled.
7. Create active 30-minute reservations, zero-physical-delta reservation movements, the pending order/delivery histories, expected COD collection, queued notification, audit record, and completed idempotency result.
8. Commit; only then can workers perform external side effects.

Deadlocks are retried a bounded number of times with jitter. A unique idempotency constraint makes retries return the original result. Sequence/order-number allocation is transactional and does not use max-plus-one.

`InventoryItem.onHandQuantity` is authoritative. Available quantity is on-hand minus unexpired active reservations. Checkout does not decrement physical stock. Administrator confirmation locks the order, reservations, and inventory in stable order, requires complete unexpired reservation coverage and expected versions, decrements on-hand and consumes each reservation exactly once. Customer/admin cancellation and worker expiry only release an active reservation and clear its active key; they do not add to on-hand. Returned stock goes to inspection and is never restored automatically.

Administrator edits use optimistic versions where the schema provides them. Delivery zones use `updatedAt`; delivery rates use `version`. `PickupLocation` and `DeliveryTimeWindow` have neither, so the API derives a SHA-256 state token and combines it with a row lock. MySQL/Prisma still cannot express every exclusive-owner, workflow, or append-only invariant; services fail closed and require real-database concurrency evidence.

## Delivery and COD state

Order, delivery, return, payment, collection, and remittance are related but separate state machines. Delivery success does not by itself prove cash remittance. Reporting distinguishes order created, confirmed, delivered, cash collected, cash remitted, and cash reconciled.

Every implemented transition records actor, source state, target state, timestamp, request ID, reason/evidence metadata, and result. Order intake supports confirmation, cancellation/rejection, preparation, store-pickup readiness, contact attempts, notes, and an audited printable slip. Manual delivery supports courier assignment/reassignment, controlled transitions/attempts, completion only with age and exact-COD evidence, and return completion without automatic restock. Impossible transitions are rejected even for a Super Administrator; exceptional correction uses a documented approval workflow and compensating event rather than history mutation.

COD custody is separate from order and delivery state. Checkout creates an `EXPECTED` collection. Authorized operations record physical cash, allocate eligible collections to a draft courier remittance under locks, submit it for review, verify the declared amount or open a discrepancy, and resolve/write off a discrepancy with recent authentication and audit. Delivery success alone never marks cash remitted or reconciled.

## Queues and external effects

MySQL `OutboxEvent` is the durable work ledger; BullMQ is transport only. The worker claims bounded ordered batches under `READ COMMITTED`, leases recoverable work, publishes a deterministic hashed BullMQ job ID, and reloads and strictly validates the versioned payload from MySQL. Database-only handlers commit domain work with the `PROCESSED` transition; external notification and media deletion handlers claim briefly, perform I/O without database locks, and finalize in a second short transaction. Supported version-1 sources are reservation-expiry, notification-dispatch, and media-object-deletion requests. Workers:

- are safe to run more than once;
- use bounded exponential backoff and dead-letter handling;
- set network timeouts and provider idempotency keys;
- record every notification/provider attempt;
- never keep a MySQL transaction open during network calls;
- redact payloads and correlation metadata.

Reservation expiry locks expired active reservations and their inventory rows, marks each reservation `EXPIRED`, clears its active key, and writes a zero-delta release movement plus system audit. Notification payloads contain only a notification ID. Local email uses SMTP/Mailpit; production email uses authenticated TLS SMTP and enabled SMS uses an authenticated HTTPS webhook. Production rejects disabled/development adapters. When SMS is explicitly disabled its queued rows close as cancelled without provider calls; provider failures for enabled channels retry and eventually dead-letter without copying recipients into Redis. Product image replacement/deletion stores a deterministic media cleanup event with the soft-deleted metadata; immediate cleanup is followed by an idempotent local/S3 worker retry path with traversal and bucket checks. Queue depth, oldest-job age, retries, dead letters, and handler latency still need production monitoring and staging evidence; there is no dead-letter replay UI.

## Health and recovery boundaries

`GET /api/v1/health/live` proves only that the API process can answer. `GET /api/v1/health/ready` is no-store and returns 503 unless MySQL responds, Redis answers `PING`, the configured expected migration is applied with no unfinished migration, and the latest `durable-outbox-worker` health record is fresh. It returns only named up/down checks and no credentials or database details.

Logical backup tooling uses `mysqldump --single-transaction`, streams SQL through gzip and AES-256-GCM by default, and writes a checksum, key identifier, database/tool/migration metadata, byte counts, and selected table counts to a sidecar manifest. Safe local fixtures may explicitly opt out of encryption; staging/production cannot. Retention pruning is restricted to recognized timestamped artifacts in a non-linked backup directory. Restore refuses a non-empty or unconfirmed target, verifies checksum and authentication before starting MySQL mutation, restores only to an explicitly disposable database, then checks migration state, structure and invariants. The automated drill creates a randomly named isolated database, invokes the guarded restore, records measured evidence, and removes that database by default. Counts may differ when writes occurred during the logical backup and are advisory. Script tests are not a production-shaped restore drill; RPO/RTO remain unmeasured until a real drill is recorded.

## Caching

Only public, non-sensitive, reconstructible reads are candidates for caching. Cache keys include locale and representation version. Catalog/settings changes publish invalidation events. Authorization, checkout totals, stock availability decisions, compliance gates, and COD balances are never trusted from stale cache.

Public catalog filtering uses indexed relational product type, puff count, variant nicotine strength, flavor, brand, and integer-millime price fields. Source URLs and import payloads are provenance/receipt data, never browser authority or a substitute for current publication, pricing, or inventory state.

## Internationalization and locale

User-facing text uses translation keys for French and Arabic. Document direction switches at the root and components use logical CSS properties. Money is formatted as TND from integer millimes; calculations never use formatted decimal text. Phone numbers are normalized to Tunisia E.164 representation. UTC is the storage and event format; Africa/Tunis is the presentation timezone.

## Deployment topology

Controlled staging/production uses immutable images, at least two API replicas behind a health-aware proxy, separately scaled workers, managed or hardened MySQL with point-in-time recovery, authenticated Redis, versioned S3 storage, centralized telemetry, and a protected migration job. Database and Redis have no public ingress.

The Docker Compose topology is a development/staging-reference environment, not evidence of high availability. Unit/static checks, local builds, or a successful logical backup script are not evidence of multi-instance safety, a restorable production backup, or production readiness.

## Architecture decisions deferred

- Production SMTP and SMS adapters are implemented but await selected-provider credentials and staging acceptance. Courier, malware-scanning, error-monitoring, and object-storage providers await credentials and business approval.
- Search remains MySQL-backed until measured catalog/query needs justify a search service.
- A CDN and image-processing service are deployment choices behind S3-compatible interfaces.
- RPO/RTO targets are provisional until stakeholders approve and a restore drill measures them.
