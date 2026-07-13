# Durable outbox worker

The worker bridges committed MySQL `OutboxEvent` rows to BullMQ. MySQL remains the durable
authority; Redis is delivery coordination only. Queue jobs contain only the outbox event ID, event
type, and version. Handlers reload and strictly validate the minimal JSON payload from MySQL.

## State and retry model

`PENDING`/`RETRY` events are claimed in bounded batches with a deterministic MySQL `FOR UPDATE`
lock. Independent instances serialize only the short claim transaction and observe disjoint leases
under `READ COMMITTED`. Expired `LEASED`, `PUBLISHED`, or `PROCESSING` leases are recoverable.
Claims increment `attemptCount`; publication and processing use a BullMQ-safe job ID derived from
the event's unique deterministic key. Failures store only an allowlisted safe error code and use
bounded exponential backoff. Exhausted events become `DEAD_LETTER`. Successful domain work and the
`PROCESSED` ledger transition commit in one database transaction.

Supported version-1 event contracts are deliberately small:

- `inventory.reservations.expire.requested`: UTC cutoff and bounded batch size.
- `notification.dispatch.requested`: notification record ID only.

The source scheduler creates one deterministic reservation-expiry event per time bucket and bridges
due `Notification` rows using one deterministic event per notification. Payloads containing unknown
fields are rejected, so customer contact details cannot be copied into outbox or Redis payloads.

## Reservation expiry

The handler locks expired `ACTIVE` reservations in deterministic inventory/reservation order, then
locks the corresponding inventory rows. A still-active expired reservation becomes `EXPIRED`, its
active key is cleared, and it receives a zero-delta `RESERVATION_RELEASE` stock movement and a
`SYSTEM` audit record. Physical on-hand quantity never changes during reservation release. The
outbox processed transition is part of the same transaction.

## Notifications

Only the `CONSOLE` channel has a development adapter. It logs safe notification metadata without a
recipient or message payload. The adapter is rejected by environment validation in production.
Email, SMS, and courier delivery are not claimed or emulated; without an approved provider they
retry and eventually dead-letter with `NOTIFICATION_PROVIDER_NOT_CONFIGURED`.

## Required environment

- `DATABASE_URL`: MySQL worker identity; required.
- `REDIS_URL`: `redis://` or `rediss://`; defaults locally to `redis://localhost:6379`.
- `NOTIFICATION_ADAPTER`: `console` for development or `disabled`; production rejects `console`.

Polling, leases, attempts, retry bounds, concurrency, heartbeat cadence, reservation scan cadence,
and batch sizes have validated `OUTBOX_*`, `WORKER_*`, and `RESERVATION_*` variables in
`src/environment.ts`. Each running instance appends safe `SystemHealthRecord` heartbeats.

## Operations and limitations

Apply `prisma/migrations/20260713010000_durable_outbox/migration.sql` before starting this worker.
Monitor `RETRY`, expired leases, oldest available event age, `DEAD_LETTER`, and heartbeat age. This
foundation has no dead-letter replay UI, health-record retention job, real notification provider,
or proof of multi-instance/final-unit behavior against production-shaped MySQL and Redis. Those
remain required staging verification; a green unit build is not a production-readiness verdict.
