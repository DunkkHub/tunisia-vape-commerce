# Deployment guide

## Environment classes

- Local: Docker Compose dependencies and locally built application images; development credentials only.
- Controlled staging: production-shaped networking, TLS, secret manager, isolated data, real monitoring, approved test provider accounts, and manual deployment approval.
- Production: prohibited until the readiness verdict and required human legal/security approval permit it.

Never reuse credentials, customer data, object buckets, Redis prefixes, databases, cookies, or encryption keys across environments.

## Intended topology

Use separate storefront and admin hosts, for example store.example.tn and admin.example.tn. Each host proxies same-origin /api traffic to private API replicas. The storefront host does not serve /admin; the admin host exposes /admin/login and protected admin UI. Host-only cookies then isolate the customer and admin realms in addition to their distinct server-side names/guards.

MySQL, Redis, and worker endpoints have no public ingress. API and web images are immutable. Run at least two API replicas for controlled availability, scale workers by queue class, and use health-aware load balancing. Store media in versioned private object storage and serve approved derivatives through a CDN or signed path.

Docker Compose is a development/staging reference and is not a high-availability production topology.

## Configuration and secrets

Start from .env.example only for the variable inventory. Do not copy placeholder credentials into staging/production. Store secrets in a managed secret store and inject at runtime.

The API and worker must validate configuration before listening. Production startup fails for missing/short secrets, placeholder/default credentials, wildcard credentialed CORS, insecure cookies, debug/auth bypass, unsafe database credentials, realm cookie/session-prefix collision, or a demonstration administrator.

Required secret classes include database runtime/migration credentials, Redis credential/TLS material, session/cookie secrets, field-encryption keys with versions, object-storage keys, provider credentials, monitoring DSN, and backup encryption/key access. Apply least privilege and document rotation.

## Build and artifact promotion

1. CI installs from the frozen pnpm lockfile.
2. Formatting, linting, type checks, unit/integration/security/end-to-end tests, builds, migration validation, dependency/secret/static scans pass.
3. Build multi-stage non-root images once using reviewed source.
4. Scan images, generate an SBOM, and record source revision, image digest, and scan results.
5. Promote the exact digest between environments; do not rebuild for production.
6. A protected GitHub environment requires a human approver and provides only environment-scoped credentials.

Pin base images and CI actions to reviewed versions/digests in a release hardening change. Rebuild promptly for patched base images.

## Database changes

Use expand-contract migrations:

- Add nullable/backward-compatible schema first.
- Deploy code that can read old/new forms and backfill through a bounded job.
- Validate counts, constraints, query plans, and replication/backup impact.
- Enforce/drop old form only in a later release.

Before a risky migration, create and verify a fresh encrypted backup or snapshot. Rehearse against a production-like clone. A dedicated migration job using DATABASE_MIGRATION_URL runs pnpm prisma:migrate:deploy once; API replicas do not run development migrations or seed on startup.

Prisma rollback is usually a forward corrective migration. If an application rollback is needed, confirm its older version remains schema-compatible. Never run migrate reset or destructive development commands outside disposable local databases.

## Controlled staging deployment

1. Confirm CI, review, approved change window, rollback owner, and incident contact.
2. Confirm legal/checkout flags remain closed unless this is an explicitly approved checkout test.
3. Record database backup/snapshot and restore confidence.
4. Apply the reviewed migration job and inspect output.
5. Deploy API/worker/web by immutable digest with rolling readiness gates.
6. Smoke-test liveness, readiness, store page, both separate login pages, admin password-plus-TOTP, catalog, cart, and a controlled COD order.
7. Confirm logs, traces, metrics, queues, provider adapters, security events, and alerts.
8. Observe latency, errors, DB connections/locks, queue depth, login failures, checkout failures, reservation failures, delivery errors, and COD discrepancies.
9. Record evidence in PRODUCTION_READINESS_REPORT.md.

## Production-shaped Compose overlay

`docker-compose.yml` remains the development reference. A stricter single-host operational overlay
is provided for production-shaped rehearsal:

    docker compose -f docker-compose.yml -f docker-compose.production.yml config
    docker compose -f docker-compose.yml -f docker-compose.production.yml up -d

The overlay is not a high-availability claim. It removes host-published MySQL, Redis, MinIO, and
Mailpit ports; requires database, Redis, cookie, field-encryption, and MySQL secret inputs without
placeholder defaults; maps `DATABASE_MIGRATION_URL` explicitly into the migration container's
`DATABASE_URL`; adds authenticated Redis configuration from a mounted secret; switches API health
to readiness; checks worker heartbeat age; and adds bounded graceful-stop periods. Base resource
limits are starting guidance only and must be load-tested on the selected platform.

Run `pnpm verify:db-privileges` with the runtime `DATABASE_URL` after database provisioning. It
performs a randomized, cleaned-up DDL probe and succeeds only when MySQL denies `CREATE` with the
expected permission error. Migration deployment must run under the separate migration URL.

## Health behavior

- Liveness answers only when the process event loop is functioning.
- Readiness fails when mandatory dependencies or configuration prevent safe traffic.
- A worker reports heartbeat/queue connectivity separately.
- Health responses contain no credentials, versions useful to attackers, raw provider errors, or database topology.
- During shutdown, stop accepting traffic, drain bounded in-flight HTTP work, pause new queue claims, finish/return jobs safely, and close pools before the orchestrator deadline.

`/api/v1/health/live` is deliberately process-only. `/api/v1/health/ready` returns only named
`up`/`down` summaries and requires MySQL connectivity, Redis PONG, a recent healthy durable-worker
heartbeat, the configured expected migration, and no unfinished migration. Configure
`EXPECTED_MIGRATION_NAME`, `HEALTHCHECK_TIMEOUT_MS`, and `WORKER_HEARTBEAT_MAX_AGE_SECONDS` with the
deployed image. A dependency's address, version, exception, or credential is never returned.

## Rollback

Application rollback uses the previous known-good image digest only when schema compatibility is confirmed. If a migration changed data semantics, prefer a forward fix. Feature flags may disable a new non-security feature, but cannot bypass authentication, legal gates, stock locks, or audit.

Emergency sequence:

1. Disable checkout or enable maintenance when integrity/customer harm is possible.
2. Stop/scale the affected worker or API component without destroying evidence.
3. Roll back compatible images or deploy the reviewed forward fix.
4. Verify health and invariants, reconcile queued/idempotent work, and run targeted smoke tests.
5. Follow incident response and document all manual data corrections as auditable compensating events.

## Edge requirements

- Modern TLS with automated renewal and alerting
- Explicit storefront/admin host allowlist; reject unknown Host
- HSTS only after HTTPS and subdomain readiness are verified
- CSP, frame-ancestors, nosniff, referrer and permissions policy
- Request/body/upload limits and timeouts
- Correct trusted-proxy count and forwarded-header overwrite
- No public MySQL/Redis/MinIO console/Mailpit/Swagger in production
- Admin network/IP restrictions where the operating model permits
- Static immutable caching only for content-hashed assets; no caching authenticated HTML/API

## Post-deployment verification

Verify customer/admin cookie separation, customer-to-admin denial, password-only admin denial, TOTP success, suspension/revocation, RBAC negative cases, legal/maintenance gates, authoritative delivery fee, idempotent order retry, inventory invariants, worker idempotency, upload safety, and COD role separation.

## First administrator

Create the first admin only from a trusted one-off environment:

    pnpm admin:create

The command prompts securely, validates password strength, assigns Super Administrator, requires first-login TOTP enrollment, and never displays/stores a plaintext password. Do not run it in image build, seed, or unattended startup.

## Production release gate

docs/PRODUCTION_CHECKLIST.md must be complete, backup/restore and load results recorded, legal blockers cleared in writing, security review accepted by a human, and the readiness report must use one permitted verdict. A successful deployment alone does not make the platform production-ready.
