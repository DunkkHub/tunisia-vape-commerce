# Deployment guide

## Environment classes

- Local: Docker Compose dependencies and locally built application images; development credentials only.
- Controlled staging: production-shaped networking, TLS, secret manager, isolated data, real monitoring, approved test provider accounts, and manual deployment approval.
- Production: prohibited until the engineering readiness verdict and required human security/operations approval permit it.

Never reuse credentials, customer data, object buckets, Redis prefixes, databases, cookies, or encryption keys across environments.

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

## Intended topology

Use separate storefront and admin hosts, for example `store.example.tn` and `admin.example.tn`. Configure `WEB_URL`/`STOREFRONT_HOST` for the storefront and `ADMIN_WEB_URL`/`ADMIN_HOST` for administration. Production validation requires HTTPS origins, origin-only URLs, matching DNS hostnames, and distinct realm hosts. CORS is derived only from those two exact origins; there is no independent wildcard/list override. Local development keeps both origins on `http://localhost:5173`, and local Compose keeps both on `http://localhost:8080` unless `COMPOSE_ADMIN_WEB_URL` is explicitly set.

Each host proxies same-origin `/api` traffic to private API replicas. The production Nginx template returns 404 for `/admin`, `/api/v1/admin/*`, `/api/v1/auth/admin/*`, and every `/api/docs*` OpenAPI UI/schema route on the storefront host; unknown hosts receive 444. The admin host exposes `/admin/login` and protected admin UI and does not forward customer authentication. Host-only cookies then isolate customer and administrator realms in addition to their distinct server-side names, session prefixes, CSRF tokens, and guards. Terminate TLS at the reviewed ingress/load balancer in front of the template's private port, or adapt the same host-routing rules into the operator's TLS edge configuration.

MySQL, Redis, and worker endpoints have no public ingress. API and web images are immutable. Run at least two API replicas for controlled availability, scale workers by queue class, and use health-aware load balancing. Store media in versioned private object storage and serve approved derivatives through a CDN or signed path.

Docker Compose is a development/staging reference and is not a high-availability production topology.

## Configuration and secrets

Use `.env.example` for local development and `.env.production.example` as the production variable contract. The production example contains placeholders only: replace every `REPLACE_*` value, keep secret files outside source control, and inject them from the operator's secret store. Never copy local or example credentials into staging or production.

Product media uses `MEDIA_STORAGE_DRIVER=s3` in the production Compose baseline. Configure an operator-owned S3-compatible endpoint, region, bucket, access key and secret key; set `S3_FORCE_PATH_STYLE=true` only when required by that provider. The API uses the credential for validated writes/reads and the worker uses it for deterministic orphan deletion after replacement or soft deletion. Grant only the bucket/object operations each process needs and keep the API/worker configuration identical for bucket, endpoint, region, and path style. These credentials must never be exposed through Vite variables or browser configuration. Native Windows development may instead use `MEDIA_STORAGE_DRIVER=local` with a private `MEDIA_LOCAL_ROOT`.

`CATALOG_IMPORT_MEDIA_HOSTS` is an optional comma-separated list of exact DNS hostnames permitted for administrator CSV/JSON image URLs. Leave it empty to disable generic remote-media downloads. Do not enter schemes, paths, wildcard domains, IP literals, user information, or secret query parameters. The API still requires HTTPS, public DNS resolution, redirect revalidation, bounded bodies and full product-image validation. These records remain operator-supplied, non-public, and pending until an administrator explicitly approves or rejects each image. Media execution is limited to 30 candidate images per product, 150 per batch, and three active product groups under renewable batch/global Redis leases. Its two attempts, two redirects per attempt, 10-second request timeout, and five-second maximum synchronous retry delay give a conservative 5,200-second remote-fetch scheduling bound. The supplied Nginx gateway scopes a 7,200-second read timeout to `/api/v1/admin/catalog/imports/:id/media/apply`; all ordinary API routes retain the 30-second limit. Because an object store and MySQL cannot share a transaction, configure bucket versioning, incomplete-upload lifecycle cleanup, inventory, and monitored reconciliation for the narrow upload-before-commit crash window.

Customer Google sign-in is disabled by default. Create a Google OAuth client of type Web application, register only the exact storefront callback `https://<storefront-host>/api/v1/auth/customer/google/callback`, and keep the administrator host absent from its redirect list. Inject `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` from the secret manager, then set `GOOGLE_OAUTH_ENABLED=true`; startup rejects a partial tuple, placeholder client ID/secret, a callback with credentials/query/fragment, a callback outside the storefront origin, or non-HTTPS production callback. The flow requests only `openid email profile`, uses no offline access, and stores no provider token. Follow Googleâ€™s [web-server OAuth guidance](https://developers.google.com/identity/protocols/oauth2/web-server) for console setup and credential rotation, but keep this repositoryâ€™s stricter exact callback and realm separation.

The API and worker must validate configuration before listening. Production API startup fails for missing/short secrets, placeholder/default credentials, missing/non-HTTPS/same browser origins, origin/edge-host mismatches, wildcard credentialed CORS, insecure cookies, debug/auth bypass, unsafe database credentials, realm cookie/session-prefix collision, or a demonstration administrator.

Interactive Swagger/OpenAPI UI is enabled by default only in development/test. Production leaves it absent unless an operator deliberately sets the strictly validated `OPENAPI_ENABLED=true`; when enabled, route it only through the protected admin host and an additional operator access control. The storefront Nginx virtual host always returns 404 for `/api/docs`, `/api/docs-json`, `/api/docs-yaml`, and related UI assets. Do not enable it as a substitute for a generated CI contract artifact.

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

Before a risky migration, create and verify a fresh encrypted backup or snapshot. Rehearse against a production-like clone. A dedicated migration job using `DATABASE_MIGRATION_URL` runs `pnpm prisma:migrate:deploy` once; API replicas do not run development migrations or seed on startup.

The current expected migration is `20260804090000_customer_google_identity`. It adds a customer-profile-scoped external identity binding and makes the local customer password nullable for provider-only accounts; it does not alter administrator password or TOTP requirements and stores no OAuth tokens. The preceding delivery and catalog migrations add operational delivery metadata and reviewed import/provenance structures while preserving integer-millime price authority. Rehearse both an empty-database deploy and a representative existing-data upgrade containing existing customers, orders, inventory, delivery/COD, and catalog/media records before promotion.

Prisma rollback is usually a forward corrective migration. If an application rollback is needed, confirm its older version remains schema-compatible. Never run migrate reset or destructive development commands outside disposable local databases.

## Controlled staging deployment

1. Confirm CI, review, approved change window, rollback owner, and incident contact.
2. Confirm checkout, maintenance, and prelaunch values match the intended environment; use a controlled test catalog and delivery method for any checkout smoke test.
3. Record database backup/snapshot and restore confidence.
4. Apply the reviewed migration job and inspect output.
5. Deploy API/worker/web by immutable digest with rolling readiness gates.
6. Smoke-test liveness, readiness, store page, both separate login pages, admin password-plus-TOTP, catalog, cart, and a controlled COD order.
7. Confirm logs, traces, metrics, queues, provider adapters, security events, and alerts.
8. Observe latency, errors, DB connections/locks, queue depth, login failures, checkout failures, reservation failures, delivery errors, and COD discrepancies.
9. Record evidence in PRODUCTION_READINESS_REPORT.md.

### Read-only deployment smoke command

After the rollout and worker heartbeat are healthy, run the cross-platform smoke command from a
network location that can reach both endpoints:

    SMOKE_WEB_URL=https://store.example.tn
    SMOKE_ADMIN_WEB_URL=https://admin.example.tn
    SMOKE_API_URL=https://store.example.tn/api/v1
    SMOKE_EXPECT_CHECKOUT_ENABLED=true
    SMOKE_REQUIRE_CHECKOUT_READY=true
    pnpm smoke:deployment

It fails closed on redirect/non-2xx responses, oversized or invalid contracts, any down readiness
dependency or named readiness check, an unexpected checkout flag, maintenance/prelaunch state, any
authoritative checkout-policy blocker, a broken age-gate cookie flow, an unreadable public catalog,
or missing storefront/customer-login/admin-login HTML. HTTP is accepted automatically only for
loopback; an internal non-loopback rehearsal endpoint requires the explicit
`SMOKE_ALLOW_INSECURE_HTTP=true` exception. The script never accepts embedded URL credentials and
does not print cookies or secrets.

This smoke is intentionally read-only except for issuing a signed age-gate cookie. It does not prove
administrator password-plus-TOTP, cart mutation, COD order creation, notification delivery,
inventory consumption, delivery, or cash reconciliation. Run those controlled scenarios separately
with approved test accounts/data and clean them up without rewriting append-only history.

## Production-shaped Compose overlay

`docker-compose.yml` remains the development reference. A stricter single-host operational overlay
is provided for production-shaped rehearsal:

    docker compose -f docker-compose.yml -f docker-compose.production.yml config
    docker compose -f docker-compose.yml -f docker-compose.production.yml up -d

The overlay is not a high-availability claim. It requires `STOREFRONT_HOST` and `ADMIN_HOST`, renders the host-separated Nginx template, keeps OpenAPI disabled by default, removes host-published MySQL, Redis, MinIO, and
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

Application rollback uses the previous known-good image digest only when schema compatibility is confirmed. If a migration changed data semantics, prefer a forward fix. Feature flags may disable a configurable feature, but cannot bypass authentication, stock locks, delivery pricing, order validation, or audit.

Emergency sequence:

1. Disable checkout or enable maintenance when integrity/customer harm is possible.
2. Stop/scale the affected worker or API component without destroying evidence.
3. Roll back compatible images or deploy the reviewed forward fix.
4. Verify health and invariants, reconcile queued/idempotent work, and run targeted smoke tests.
5. Follow incident response and document all manual data corrections as auditable compensating events.

## Edge requirements

- Modern TLS with automated renewal and alerting
- Exact, distinct `STOREFRONT_HOST`/`ADMIN_HOST` allowlist; reject unknown Host and never forward admin UI/API/docs from the storefront host
- HSTS only after HTTPS and subdomain readiness are verified
- CSP, frame-ancestors, nosniff, referrer and permissions policy
- Request/body/upload limits and timeouts
- Correct trusted-proxy count and forwarded-header overwrite
- No public MySQL/Redis/MinIO console/Mailpit/OpenAPI UI in production; any explicit OpenAPI exception is admin-host-only and separately access-controlled
- Admin network/IP restrictions where the operating model permits
- Static immutable caching only for content-hashed assets; no caching authenticated HTML/API

## Post-deployment verification

Verify customer/admin cookie separation, customer-to-admin denial, password-only admin denial, TOTP success, suspension/revocation, RBAC negative cases, checkout/maintenance/prelaunch gates, authoritative delivery fee, idempotent order retry, inventory invariants, worker idempotency, upload safety, and COD role separation. Verify separately that absence of legal approval metadata or unpublished legal documents does not create an executable checkout blocker.

## First administrator

Create the first admin only from a trusted one-off environment:

    pnpm admin:create

The command prompts securely, validates password strength, assigns Super Administrator, requires first-login TOTP enrollment, and never displays/stores a plaintext password. Do not run it in image build, seed, or unattended startup.

## Production release gate

[PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) must be complete, backup/restore and load results recorded, security review accepted by a human, and the readiness report must use one permitted verdict. A successful deployment alone does not make the platform production-ready. The purchaser/operator may maintain separate legal records, but those records are not inputs to the software readiness verdict or checkout policy.
