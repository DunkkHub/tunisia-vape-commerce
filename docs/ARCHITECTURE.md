# Architecture

## Decision summary

The system is a pnpm TypeScript modular monolith: one React/Vite web application, one stateless NestJS API, one independently scalable BullMQ worker, MySQL as the transactional system of record, Redis for ephemeral distributed coordination, and S3-compatible object storage for media. Nginx terminates edge HTTP concerns and proxies same-origin API traffic.

This shape keeps database transactions and business invariants in one deployment boundary while allowing web, API, and background work to scale separately. Microservices are deliberately deferred until measured operational pressure justifies their failure and consistency costs.

## Runtime components

| Component     | Responsibility                                                          | Persistent authority                             |
| ------------- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| React web     | Storefront and /admin UI, i18n, RTL, accessible interaction             | None; server-backed state only                   |
| NestJS API    | Validation, authentication, RBAC, business rules, transactions, OpenAPI | MySQL through Prisma                             |
| BullMQ worker | Notification, export, media, expiry, and retry jobs                     | Job result/status in MySQL; queue state in Redis |
| MySQL 8.4     | Orders, inventory, catalog, customer, delivery, COD, consent, audit     | Primary transactional record                     |
| Redis         | Sessions, rate limits, queues, short caches, distributed coordination   | Reconstructible except active sessions/queues    |
| S3/MinIO      | Original and derived product media, controlled evidence references      | Versioned object data                            |
| Nginx         | TLS/proxy/static delivery, request limits, security headers             | None                                             |

Mailpit and MinIO in Docker Compose are development services, not production service selections.

## Trust boundaries

1. Untrusted browser to Nginx: TLS in staging/production, request-size controls, explicit hosts, CSP and security headers.
2. Nginx to web/API: private network; forwarded host, scheme, IP, and request ID are trusted only from known proxies.
3. API/worker to MySQL: TLS where supported and separate least-privilege runtime/migration identities.
4. API/worker to Redis: private authenticated/TLS connection in production with distinct key namespaces.
5. API/worker to object storage and notification/courier providers: egress allowlist, timeouts, safe DNS/IP validation, credentials scoped to the adapter.
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

For staging/production, use different storefront and admin hostnames with host-only Secure cookies. At a minimum, cookie names and server-side credential extraction remain distinct; an admin guard never falls back to a customer cookie. Nginx may deny /admin on the storefront host, but that edge rule supplements rather than replaces API authorization.

## Module boundaries

NestJS modules follow the domains named in the product specification. Modules may call public application services, not another module's Prisma internals. Cross-domain operations are coordinated by explicit use cases:

- Checkout coordinates carts, catalog, promotions, geography/rates, inventory, orders, consent, and an outbox in one database transaction.
- Delivery transition coordinates delivery history, order projection, age outcome, inventory return workflow, COD collection, and notifications.
- COD reconciliation coordinates collections, remittances, discrepancies, approval, and append-only audit.
- Compliance gate reads versioned settings/legal publications and is enforced inside checkout, never only in React.

## Transaction and concurrency boundaries

Checkout uses a short MySQL transaction:

1. Claim a unique customer/guest-scoped idempotency key.
2. Load the server cart and validate catalog publication and restrictions.
3. Lock inventory rows in a deterministic variant/location order.
4. Calculate active reservations and reject insufficient availability.
5. Resolve promotion and delivery rules and compute integer-millime totals.
6. Create immutable address, item, warning, delivery, promotion, consent, and age snapshots.
7. Create reservations, order, initial history, idempotency result, audit, and outbox records.
8. Commit; only then can workers perform external side effects.

Deadlocks are retried a bounded number of times with jitter. A unique idempotency constraint makes retries return the original result. Sequence/order-number allocation is transactional and does not use max-plus-one.

InventoryItem.onHandQuantity is authoritative. Available quantity is on-hand minus unexpired active reservations. Confirming/deducting stock and releasing/expiring reservations are idempotent state transitions with stock-movement records. Returned stock goes to inspection and is never restored automatically.

## Delivery and COD state

Order, delivery, return, payment, collection, and remittance are related but separate state machines. Delivery success does not by itself prove cash remittance. Reporting distinguishes order created, confirmed, delivered, cash collected, cash remitted, and cash reconciled.

Every transition records actor, source state, target state, timestamp, request ID, reason/evidence metadata, and result. Impossible transitions are rejected even for a Super Administrator; exceptional correction uses a documented approval workflow and compensating event rather than history mutation.

## Queues and external effects

Database changes and an outbox record commit together. A dispatcher publishes deterministic job IDs to BullMQ. Workers:

- are safe to run more than once;
- use bounded exponential backoff and dead-letter handling;
- set network timeouts and provider idempotency keys;
- record every notification/provider attempt;
- never keep a MySQL transaction open during network calls;
- redact payloads and correlation metadata.

Queue depth, oldest-job age, retries, dead letters, and handler latency are monitored.

## Caching

Only public, non-sensitive, reconstructible reads are candidates for caching. Cache keys include locale and representation version. Catalog/settings changes publish invalidation events. Authorization, checkout totals, stock availability decisions, compliance gates, and COD balances are never trusted from stale cache.

## Internationalization and locale

User-facing text uses translation keys for French and Arabic. Document direction switches at the root and components use logical CSS properties. Money is formatted as TND from integer millimes; calculations never use formatted decimal text. Phone numbers are normalized to Tunisia E.164 representation. UTC is the storage and event format; Africa/Tunis is the presentation timezone.

## Deployment topology

Controlled staging/production uses immutable images, at least two API replicas behind a health-aware proxy, separately scaled workers, managed or hardened MySQL with point-in-time recovery, authenticated Redis, versioned S3 storage, centralized telemetry, and a protected migration job. Database and Redis have no public ingress.

The Docker Compose topology is a development/staging-reference environment, not evidence of high availability.

## Architecture decisions deferred

- Real SMS, email, courier, malware-scanning, error-monitoring, and object-storage providers await credentials and business approval.
- Search remains MySQL-backed until measured catalog/query needs justify a search service.
- A CDN and image-processing service are deployment choices behind S3-compatible interfaces.
- RPO/RTO targets are provisional until stakeholders approve and a restore drill measures them.
