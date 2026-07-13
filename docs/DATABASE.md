# Database design

## Scope and operating assumptions

The authoritative data store is MySQL 8 or newer using InnoDB. Prisma is the application ORM. Redis is used for distributed rate limiting, queues, and optionally as a session cache, but MySQL remains the durable source for sessions, revocations, orders, inventory, delivery events, cash reconciliation, consent, and audit evidence.

The schema is in `prisma/schema.prisma`. It is intentionally a normalized operational model rather than an analytics warehouse. Reporting queries must be bounded, indexed, and moved to background exports when they are large.

Database and connection requirements:

- Create the database with `utf8mb4` and a Unicode collation appropriate to the deployed MySQL version. French and Arabic content must round-trip without transliteration.
- Keep the server and all application connections on UTC (`time_zone = '+00:00'`). Convert for display using `Africa/Tunis`.
- Use InnoDB foreign keys and do not disable foreign-key checks during normal migrations.
- Use separate least-privilege application and migration users. The application user must not have schema-altering privileges.
- Use connection pooling with finite acquisition and query timeouts. Do not share an unbounded Prisma client per request.
- All money is an integer number of Tunisian millimes. The currency column is `TND`. Monetary arithmetic must never use JavaScript floating point.

## Domain layout

The short section comments in the Prisma schema correspond to these ownership boundaries:

| Boundary                | Principal records                                                     | Important invariant                                                                  |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Authentication and RBAC | `User`, profiles, sessions, 2FA, roles and permissions                | An identity and every session have one immutable audience: customer or admin.        |
| Customer management     | addresses, notes, tags, risk, blocklist and privacy requests          | Administrative risk signals do not silently become an automatic permanent block.     |
| Catalog                 | product, variants, attributes, suppliers, batches and images          | Referenced products are archived/soft-deleted, not hard-deleted.                     |
| Inventory               | locations, items, movements, reservations and adjustments             | Physical stock never becomes negative; availability is derived.                      |
| Cart and promotions     | customer carts, wishlists, promotions, coupons and redemptions        | The backend reloads all prices and rules at checkout.                                |
| Geography and delivery  | Tunisian geography, zones, rates, windows, blackouts and pickup       | No matching valid rate means checkout is blocked, not guessed.                       |
| Orders                  | order header, item/address/consent/discount snapshots and idempotency | Historical commercial facts are immutable.                                           |
| Delivery                | courier assignment, attempts, events, manifests, labels and proof     | Every state transition is validated and appended to history.                         |
| COD and returns         | collection, remittance, discrepancy, reconciliation and inspection    | Created orders are not revenue; returned goods are not stock before inspection.      |
| Compliance              | settings, legal versions, consent, age checks and restrictions        | Production checkout is fail-closed. No identity-document image is stored by default. |
| Operations              | notifications, outbox, audit, security, health and settings           | Sensitive changes append an audit record in the same transaction when possible.      |

## Authentication realms are separated

`User.audience` is either `CUSTOMER` or `ADMIN` and is assigned when the identity is created. A customer has a `CustomerProfile`; an administrator has an `AdminProfile`. Application code must reject a profile that does not match the user's audience. This is an application invariant because MySQL cannot express the cross-table exclusive-profile rule through a normal foreign key.

Every `Session` repeats the audience. The session loader must require both `Session.audience == expected route audience` and `User.audience == expected route audience`. Customer and admin login endpoints must use different routes, cookie names, cookie paths, idle/absolute timeouts, and CSRF contexts. A valid customer cookie must never be accepted by an admin guard.

An admin request additionally requires:

- an active, non-suspended user and `AdminProfile`;
- a verified `TwoFactorSecret`;
- `AdminProfile.mustEnrollTwoFactor == false`;
- `Session.twoFactorVerified == true`;
- recent authentication for designated sensitive actions;
- the server-calculated RBAC permission set.

Only hashes of session, verification, reset, recovery, and CSRF tokens are stored. TOTP secrets are encrypted with an external key and key identifier. The structural seed creates no user or administrator. The first administrator must be created by the secure interactive CLI.

## Inventory authority and availability

`InventoryItem.onHandQuantity` is the authoritative physical quantity for one variant, location, and lot. `InventoryItem.version` supports optimistic conflict detection. There is deliberately no persisted `reservedQuantity` or `availableQuantity`, because duplicated counters drift under retries and failure recovery.

Availability at a point in time is:

```text
available = onHandQuantity
          - SUM(StockReservation.quantity
                WHERE state = ACTIVE AND expiresAt > database_utc_now)
```

The query and subsequent reservation insert happen while the relevant inventory rows are locked in one transaction. Availability shown in browsing APIs is advisory; only the locked checkout calculation is authoritative.

`StockReservation.activeKey` implements the partial-unique pattern MySQL otherwise lacks. While a reservation is active it contains a deterministic value such as `inventoryItemId:sourceType:sourceId` and is globally unique. When the reservation becomes consumed, released, or expired, `activeKey` is set to `NULL`. Historical rows remain queryable. Cleanup uses `(state, expiresAt)` and `(inventoryItemId, state, expiresAt)` indexes. Current checkout reservations expire after 30 minutes.

All physical changes append a `StockMovement` with the delta and resulting on-hand quantity. Reservation and release movement types are audit events and do not by themselves change physical on-hand. Order confirmation/dispatch policy must be selected consistently; the recommended policy is:

1. reserve during the atomic checkout transaction;
2. consume the reservation and decrement on-hand once the order is confirmed for fulfillment;
3. release an active reservation on cancellation or expiry;
4. create a separate inspected return movement before restoring refused, failed, or customer-returned goods;
5. write damage or expiry movements instead of making silent corrections.

The database service must reject zero/negative requested quantities, any negative resulting on-hand value, and quantity overflow. These checks belong in DTO validation and the locked transaction; Prisma does not generate all useful MySQL `CHECK` constraints.

## Immutable order history

An order keeps current workflow fields and immutable commercial snapshots:

- customer name, normalized phone, optional email, minimum age and confirmation time;
- delivery method, selected fee rule, zone/rate references, fee, preferred date/window and full `OrderAddressSnapshot` text;
- product and variant names, SKU/barcode, unit price, discounts, tax, warnings, quantity, and complete line totals in `OrderItem`;
- promotion/coupon name, code and rule JSON in `OrderDiscount` and the header promotion snapshot;
- exact consent time, granted result, legal version number/title/hash, IP and user agent in `OrderConsentSnapshot`;
- subtotal, discount, delivery, tax, grand total, currency and expected COD amount.

Product, variant, promotion, coupon, and geography foreign keys are optional or use restrictive deletion behavior where historical evidence must survive. Snapshot text and amounts are never regenerated from current catalog data. Normal application APIs must not update or delete order items, address snapshots, consent snapshots, discounts, status histories, delivery events, cash reconciliation events, audit logs, or stock movements. Corrections are compensating records with an audit trail.

## Deterministic delivery pricing

Before pricing, reject inactive, unsupported, or temporarily suspended zones/localities. Check blackout dates, available days, time-window capacity, minimum order, maximum COD, and pickup availability. If an area has no valid rule, block checkout unless the explicitly disabled-by-default manual quote workflow is authorized.

For active rates at checkout time, resolve one base geographic fee in this specificity order:

1. locality;
2. delegation;
3. governorate;
4. delivery zone;
5. global base rate.

Within equal specificity, the greater `priority` wins; a remaining tie is a configuration error and blocks checkout. Apply at most one matching rate for each independently configured surcharge class (remote, weight, oversize, express), again using priority. Apply a valid free-delivery threshold last, without bypassing minimum-order or maximum-COD rules. Persist the selected IDs and full rule/result snapshot on the order. Never accept a fee calculated by the browser.

## COD ledger meaning

`Order.expectedCodMillimes` is an expectation, not collected revenue. A `CashCollection` records the expected and actually collected amounts for a delivery or pickup. `CashRemittanceItem` allocates all or part of collections to a courier remittance, allowing operationally necessary multiple remittances without overwriting history.

A remittance becomes reconciled revenue only after an authorized user verifies it. Any difference creates `CashDiscrepancy` and appends a `CashReconciliationEvent`. Partial collection is disabled by the structural feature flag. Payment status updates and ledger records must occur in one transaction; reports must distinguish expected, collected, held by courier, remitted, discrepant, reconciled, and refunded amounts.

## Production checkout gate

The checkout service evaluates these launch prerequisites from authoritative records on every quote/order attempt:

- environment is valid and secrets/cookies/CORS are safe;
- `StoreSetting['prelaunch.mode']` is false;
- `StoreSetting['maintenance.mode']` is false;
- `StoreSetting['checkout.enabled']` is true;
- `ComplianceSetting['legal_review.completed']` is true;
- `ComplianceSetting['minimum_purchase_age']` is a legally approved positive value;
- store name, phone, email, and address are non-empty;
- at least one currently valid supported delivery or pickup method exists;
- required age and legal consent records are present for this checkout.

Owner instruction records legal approval complete. A fresh structural seed and the environment defaults use `checkout.enabled=true`, `legal_review.completed=true`, and `prelaunch.mode=false`; re-running the seed does not overwrite an existing setting value, and environment overrides can only make the effective policy stricter. `LegalDocumentVersion` publication is not a global readiness prerequisite and no additional document is required. When the client supplies optional terms/privacy version IDs, checkout still requires those referenced records to be published, effective, locale-compatible, and of the correct type before snapshotting them.

The seed still leaves checkout operationally closed because store name, phone, email, and address are empty and it creates no delivery zone/rate or pickup. MySQL, Redis, a fresh worker heartbeat, and the expected migration must also pass readiness before the deployment is operational.

The current coarse policy check considers delivery present when an active pickup exists or when at least one active/supported/non-suspended zone and at least one current active base-geography rate exist. It does not prove that every active zone/locality resolves that rate. Zone activation/configuration checks reduce misconfiguration, and quote/order resolution still fails closed for a missing or ambiguous locality-specific result. Real-database coverage for mismatched legacy data remains required.

## Critical NestJS transactions

### Create an order

The implemented authenticated-customer COD flow uses an interactive `READ COMMITTED` Prisma transaction with a five-second acquisition wait, a 15-second timeout, and at most three recognized `P2034` attempts with bounded delay:

1. Insert or lock `OrderIdempotencyKey` by the SHA-256 hash of the customer audience/operation/key scope. Verify the request fingerprint. A completed matching row replays its order response; the same key with a different request is a conflict and an in-flight equivalent request fails closed.
2. Reload the authoritative policy, active customer/blocklist state, published product/variant records, delivery rules, and any optional consent versions. Order creation currently accepts explicit item lines rather than trusting cart prices or totals.
3. Lock all needed `InventoryItem` rows in a stable ID order with parameterized `SELECT ... FOR UPDATE` through `Prisma.sql`/`$queryRaw`.
4. Sum non-expired active reservations, validate all quantities, and insert reservations with deterministic `activeKey` values.
5. Calculate prices, tax, discounts, and delivery fee using integer arithmetic. Explicitly define rounding when basis points are applied.
6. Atomically increment `SequenceCounter` under a row lock and format the public order number. Never use `MAX(orderNumber) + 1`.
7. Insert the order and every immutable item, address, consent, status, warning, and delivery-fee/rule snapshot.
8. Insert active reservations and zero-physical-delta reservation movements, initial order/delivery histories, an `EXPECTED` COD collection, queued encrypted-recipient notification, and audit record.
9. Link the idempotency row to the order and mark it completed, then commit.

Unique keys protect retries, but overselling prevention depends on the row lock plus transaction. A plain Prisma `findMany` followed by `create` is unsafe.

### Confirm, cancel, or expire inventory

Lock the order, reservation rows, and associated inventory rows in stable order. Administrator confirmation requires `PENDING_CONFIRMATION`, complete unexpired active reservation coverage, matching expected versions, and nonnegative resulting stock; it decrements physical on-hand, appends fulfillment movements, consumes the reservations, and advances order/delivery history exactly once. Customer cancellation is limited to an owned `PENDING_CONFIRMATION` order. Administrator cancellation/rejection follows its explicit early-state policy. Cancellation or worker expiry changes only active reservations to `RELEASED`/`EXPIRED`, clears `activeKey`, writes zero-delta release movements, and never increases physical stock. Order, delivery, COD expectation, history, notification, and audit changes commit atomically where applicable.

### Adjust or transfer inventory

Lock the item(s), require an approved `InventoryAdjustment` when applicable, validate the resulting stock, update `onHandQuantity` and `version`, and append paired transfer-out/transfer-in movements. For multi-location transfers always lock lower inventory IDs first to reduce deadlocks.

### Change order or delivery state

Lock the current record, compare its `version`, validate the explicit transition map and permission, then update the current status and append `OrderStatusHistory`/`DeliveryEvent`. A failed delivery age check cannot transition to delivered. Irreversible overrides require recent authentication, a reason, elevated approval where configured, and an audit record.

### Collect and reconcile cash

Lock the order, delivery, collection, and remittance rows in a stable order. Validate amounts against expected COD and the partial-collection flag. Append collection, allocation, discrepancy, reconciliation, payment-status, and audit records together. Never derive reconciliation merely from the delivery status.

### Dispatch durable work

`OutboxEvent.deterministicKey` is unique. The worker claims bounded ordered `PENDING`/`RETRY` or expired-lease rows under `READ COMMITTED`, increments attempts, and leases them to one instance. BullMQ jobs contain only event identity/type/version and use a deterministic hash-derived job ID. The processor locks the outbox row, reloads and strictly validates the MySQL payload, performs reservation expiry or notification dispatch, and commits domain writes with the `PROCESSED` state. Failures store only an allowlisted error code, use bounded exponential backoff, and end in `DEAD_LETTER`; expired leases are recoverable.

### Publish legal text or change a gate

Insert a new legal version rather than editing a published version. Publish/retire and compliance-setting changes must include authorization, recent authentication, version comparison, and an immutable audit log in the same transaction.

## Optimistic concurrency

Mutable high-contention or safety-relevant records use an update condition equivalent to `WHERE id = ? AND version = ?`, increment the version, and require exactly one affected row where the schema provides `version`. This applies to users, profiles, products, variants, inventory, delivery rates, orders, deliveries, returns, and settings. Delivery zones use `updatedAt`. `PickupLocation` and `DeliveryTimeWindow` currently have neither a version nor modification timestamp, so their admin API derives a SHA-256 state token and combines it with `SELECT ... FOR UPDATE`. A mismatch returns a conflict; it must not be silently overwritten.

## Important indexes

- `User.emailNormalized` and `CustomerProfile.phoneE164` are unique login/deduplication keys; `phoneSearch` supports normalized customer search.
- catalog slug, SKU, and barcode uniqueness prevents ambiguous public and operational identifiers; publication/category/brand indexes serve storefront lists.
- `(variantId, locationId, lotKey)` identifies an inventory bucket; active/expiry reservation indexes serve locked availability and cleanup.
- unique `Order.orderNumber` and `OrderIdempotencyKey.keyHash` prevent ambiguous or duplicate checkout records.
- order customer/status/payment plus creation time serve history, work queues, and bounded reporting.
- unique delivery tracking number and `(courierId, status, createdAt)` serve tracking and courier work queues.
- collection/remittance status and courier/date indexes support held-cash and daily reconciliation queries.
- coupon code is unique; promotion/coupon/customer/time indexes support usage-limit validation.
- audit actor/action/resource/date and security event type/severity/date indexes support incident investigation.
- job and notification `(status, scheduledAt/nextRetryAt)` indexes support bounded worker polling.

Run `EXPLAIN ANALYZE` against representative production-like volumes for catalog search, admin order/customer lists, expired reservation cleanup, courier work lists, cash aging, and every report. Avoid `%term%` scans on large tables; adopt a deliberately reviewed search index if MySQL full-text behavior is insufficient for French and Arabic.

## Prisma and MySQL limitations

- Prisma schema syntax does not declare the database default character set, collation, InnoDB engine, server UTC setting, users, or grants. Provision these outside Prisma and inspect generated migration SQL.
- Prisma has no first-class portable `SELECT ... FOR UPDATE` API. Use a parameterized raw query inside an interactive transaction. Never interpolate IDs into SQL strings.
- MySQL has no partial unique index. Nullable `StockReservation.activeKey` provides uniqueness only while the application maintains the active-key lifecycle transactionally.
- MySQL unique constraints permit multiple `NULL` values. Optional composite keys therefore do not enforce every cross-field invariant.
- `DeliveryZoneLocality` is the only zone-geography join. Administrator governorate/delegation linking expands to active locality rows and is capped at 1,000 resolved localities. There is no separate `DeliveryMethod` model: an active supported zone/current rate or active pickup constitutes an operational method.
- The schema cannot enforce exactly one `DeliveryTimeWindow` owner. The API requires one delivery zone or one pickup, never both. Checkout currently does not persist a selected time-window choice.
- Delivery-rate activation rejects overlapping active rows with the same type, exact scope, and priority. This is deliberately conservative across order/weight bounds. Zone activation requires a current zone-specific base rate even though the checkout resolver can fall back to an eligible global base.
- The schema cannot express “exactly one of product/category/brand,” “exactly one image owner,” “admin profile matches ADMIN audience,” positive money/quantity, or all workflow transitions. Validate these in services and integration tests; reviewed migration SQL may add supported `CHECK` constraints.
- JSON is appropriate for immutable rule/evidence snapshots and provider configuration, not fields used for core joins or money. Validate JSON against versioned application schemas.
- `DateTime @db.Time` values are represented as JavaScript `Date` objects by Prisma; normalize them at the service boundary and never infer a timezone.
- CUID values are stored in bounded `VARCHAR` columns. Do not change ID generation length without a migration review.
- Prisma migrations do not make every DDL operation online. Inspect table rebuild/lock impact and use an expand-contract rollout for risky changes.
- Foreign keys cannot protect append-only behavior. Database credentials, service design, permissions, and tests must prevent destructive updates to ledger/history tables.

## Migrations

Local development, after configuring a disposable MySQL database:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm prisma:validate
pnpm prisma:migrate:dev --name initial_schema
pnpm prisma:seed
```

Controlled staging/production deployment:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm prisma:validate
pnpm prisma:migrate:deploy
```

Never run `prisma migrate dev`, `prisma db push`, or automatic destructive resets in staging/production. Before deployment, review generated SQL, test it against an anonymized production-shaped restore, measure locking, take and verify a restorable backup, deploy compatible application code, apply migrations through the migration identity, and run post-migration health and invariant checks. Rollback is normally a forward corrective migration; restore is the last resort and must follow the documented incident process.

## Structural seed safety

`prisma/seed.ts` is idempotent and contains only:

- nine system roles and granular permissions with role-permission links;
- all 24 Tunisian governorates;
- operational and compliance settings whose launch/legal defaults follow owner approval while missing store/delivery data still fails closed;
- disabled-by-default sensitive feature flags;
- the order-number sequence counter.

It creates no user, administrator, customer, product, variant, stock, delivery rate, pickup, provider credential, or published legal document. On a fresh database it records `legal_review.completed=true`, `checkout.enabled=true`, and `prelaunch.mode=false`; later seed runs preserve existing values. Empty store identity/contact settings and missing delivery configuration continue to block checkout. Never add a default password or production administrator to this seed.

## Backup and restore implementation status

`pnpm backup:mysql` streams a UTC, single-transaction logical dump through AES-256-GCM and writes a sidecar manifest containing the ciphertext checksum, key identifier, database/tool versions, latest migration, selected table counts, and byte counts. Partial outputs are removed on failure. `pnpm restore:mysql` requires a separate restore URL, an explicit disposable-target flag and database-name confirmation, an empty schema, a matching manifest/checksum, and successful GCM authentication before it starts the MySQL restore process. Post-restore verification checks migrations, foreign-key integrity, impossible negative/overflow quantities and broken reservation/order/outbox references.

This tooling is implemented and script-tested, but it is not restore evidence. Logical-backup row counts can change while writes continue and are advisory. A production-shaped isolated restore drill, measured duration/RPO/RTO, key-recovery exercise, and off-site retention/access-control verification remain required.

## Required database tests

At minimum, integration tests against real MySQL must prove:

- a customer session cannot pass the admin audience guard and the reverse is also rejected;
- an admin without verified 2FA cannot access the admin API;
- two concurrent transactions cannot reserve the final unit;
- idempotent retries produce one order and reject a changed payload;
- cancelled/expired reservations become available exactly once;
- archived/soft-deleted products remain visible through order snapshots;
- invalid delivery areas and absent rates block checkout;
- impossible order/delivery transitions fail without a history mutation;
- failed delivery age verification cannot become delivered;
- returned stock is not restored before inspection;
- collection, remittance, discrepancy, and reconciliation totals remain balanced;
- production checkout remains blocked for every missing gate independently;
- published legal versions and audit/ledger records are not mutated through normal repositories.
