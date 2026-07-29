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
bounded exponential backoff. Exhausted events become `DEAD_LETTER`. Database-only domain work and
the `PROCESSED` ledger transition commit in one transaction. External notification/media adapters
use a short claim transaction, perform I/O outside database locks, then finalize in a second short
transaction with deterministic provider/object identity for safe retry.

Supported version-1 event contracts are deliberately small:

- `inventory.reservations.expire.requested`: UTC cutoff and bounded batch size.
- `notification.dispatch.requested`: notification record ID only.
- `media.object.delete.requested`: soft-deleted image ID and committed storage driver/key only.

The source scheduler creates one deterministic reservation-expiry event per time bucket and bridges
due `Notification` rows using one deterministic event per notification. Payloads containing unknown
fields are rejected, so customer contact details cannot be copied into outbox or Redis payloads.

## Reservation expiry

The handler locks expired `ACTIVE` reservations in deterministic inventory/reservation order, then
locks the corresponding inventory rows. A still-active expired reservation becomes `EXPIRED`, its
active key is cleared, and it receives a zero-delta `RESERVATION_RELEASE` stock movement and a
`SYSTEM` audit record. Physical on-hand quantity never changes during reservation release. The
outbox processed transition is part of the same transaction.

## Product-media cleanup

Product image replacement/deletion writes the cleanup event transactionally with soft-deleted
metadata. The worker claims the event in a short transaction, deletes outside the transaction, and
then marks the event processed in a second short transaction. A missing object is a successful
idempotent cleanup. Local keys must resolve beneath `MEDIA_LOCAL_ROOT`; S3 events must match the
configured bucket and use the worker's scoped server credential. Unsafe driver, bucket, or path
data fails closed and follows the normal retry/dead-letter policy.

## Notifications

The API creates each `Notification` and its deterministic `notification.dispatch.requested` outbox
event atomically. The source bridge is a legacy recovery path. The worker claims notification work
in a short transaction, decrypts recipient/reset-token fields only in memory, performs the provider
call outside the database transaction, then records the attempt, notification, and outbox result in
a short transaction.

`smtp` mode sends development email through SMTP/Mailpit and labels non-email simulation as
`console-development`. Production accepts only `smtp-webhook`: email uses authenticated TLS SMTP,
and, when `SMS_ENABLED=true`, SMS uses an authenticated HTTPS webhook with provider
idempotency/message IDs. A queued SMS is recorded as cancelled, not retried or dead-lettered, when
SMS is disabled. `CONSOLE` is rejected and `disabled` fails production configuration instead of
claiming readiness. See
`docs/NOTIFICATIONS.md` for the provider contract, configuration, templates, and acceptance checks.

## Required environment

- `DATABASE_URL`: MySQL worker identity; required.
- `REDIS_URL`: `redis://` or `rediss://`; defaults locally to `redis://localhost:6379`.
- `FIELD_ENCRYPTION_KEY`: must match the API key for decrypting notification fields in memory.
- `NOTIFICATION_ADAPTER`: `console`, `smtp`, `smtp-webhook`, or `disabled`; production requires
  `smtp-webhook`.
- SMTP: host/port/sender plus credentials and mandatory TLS in production.
- SMS: `SMS_ENABLED=false` requires no SMS credential. When enabled, an HTTPS webhook URL,
  bearer credential, and sender are required in production.
- Provider connect/request timeouts are bounded and must fit inside the outbox processing lease.
- Media storage: `MEDIA_STORAGE_DRIVER`, `MEDIA_LOCAL_ROOT`, and the same server-side `S3_*`
  configuration used by the API. No media credential is copied into an outbox or BullMQ payload.

Polling, leases, attempts, retry bounds, concurrency, heartbeat cadence, reservation scan cadence,
and batch sizes have validated `OUTBOX_*`, `WORKER_*`, and `RESERVATION_*` variables in
`src/environment.ts`. Each running instance appends safe `SystemHealthRecord` heartbeats.

## Operations and limitations

Apply every migration through `pnpm prisma:migrate:deploy` before starting this worker. The API
readiness check expects `20260727090000_delivery_zone_operational_metadata` by default.
Monitor `RETRY`, expired leases, oldest available event age, `DEAD_LETTER`, and heartbeat age. This
foundation has no dead-letter replay UI or health-record retention job, and it has no proof of
multi-instance/final-unit/provider behavior against production-shaped MySQL, Redis, SMTP, and SMS
services. Those remain required staging verification; a green unit build is not a
production-readiness verdict.
