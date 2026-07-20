# Production checklist

No box may be checked without linked evidence, owner, date, and environment. Not applicable requires written justification and approval. This is an engineering and operational readiness checklist; it does not replace an independent human security review.

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

The optional [legal and compliance checklist](LEGAL_AND_COMPLIANCE_CHECKLIST.md) is maintained separately by the purchaser/operator. Its completion, legal approval metadata, and document publication are not executable software-readiness or checkout gates.

## Store and checkout operations

- [ ] Store name, phone, email, and address are configured with production values.
- [ ] At least one active supported delivery zone/current rate or active pickup is configured.
- [ ] Every configured delivery area resolves one valid, unambiguous price.
- [ ] `CHECKOUT_ENABLED=true`, `checkout.enabled=true`, maintenance is false, and prelaunch is false for the release environment.
- [ ] Every checkout policy blocker is exercised independently and the result is recorded.
- [ ] Database, Redis, worker heartbeat, and expected migration readiness pass.

## Build and supply chain

- [ ] pnpm frozen-lockfile installation passes from a clean checkout.
- [ ] Exact dependency versions and base-image digests are reviewed.
- [ ] Format, lint, strict type checking and all production builds pass.
- [ ] Dependency audit, secret scan, SAST and license review pass/are accepted.
- [ ] Web, API and worker images build multi-stage and run non-root.
- [ ] Container scan meets policy and SBOM/provenance are retained.
- [ ] CI actions are reviewed/pinned with minimal permissions.
- [ ] No secrets, fake products, demonstration accounts or default admin exist.

## Configuration and secrets

- [ ] Environment validation rejects missing/short/default secrets and debug/auth bypass.
- [ ] Customer/admin cookie names, session prefixes, CSRF contexts and hosts are distinct.
- [ ] Field/session/cookie keys are high entropy, managed, versioned and rotatable.
- [ ] Database migration/runtime/backup users are separate and least privilege.
- [ ] Redis, S3, provider, monitoring and backup credentials are least privilege.
- [ ] CORS is an exact allowlist and credentialed wildcard is impossible.
- [ ] Secure cookies and TLS are mandatory; proxy/Host trust is correct.
- [ ] Rotation and break-glass procedures are tested.

## Authentication and authorization

- [ ] Customer endpoints exist only under /api/v1/auth/customer/*.
- [ ] Admin endpoints exist only under /api/v1/auth/admin/* and UI login is /admin/login.
- [ ] A customer cookie/principal is rejected by every admin endpoint.
- [ ] Admin password-only/pending challenge cannot call protected admin APIs.
- [ ] Mandatory TOTP, recovery one-time use, reset and replay defenses pass.
- [ ] Session rotation, idle/absolute expiry, listing and revocation pass.
- [ ] Password/reset/verification storage and Argon2id parameters are reviewed.
- [ ] Enumeration resistance, progressive delay and Redis throttling pass.
- [ ] CSRF and Origin/Fetch Metadata negative tests pass in both realms.
- [ ] RBAC deny-by-default matrix and ownership/IDOR tests pass.
- [ ] Recent-auth/confirmation/audit protects every dangerous action.
- [ ] First-admin interactive CLI works and seed creates no admin.

## Database and migrations

- [ ] Complete Prisma schema and structural seed are reviewed.
- [ ] Empty-database migration and representative existing-data upgrade pass.
- [ ] Foreign keys, uniqueness, referential actions and archive/history behavior pass.
- [ ] MySQL uses InnoDB, utf8mb4, UTC, TLS, private ingress and monitored pool limits.
- [ ] Major list/report query plans and indexes meet measured targets.
- [ ] Expand-contract/rollback compatibility and risky-migration backup are rehearsed.
- [ ] No Float is used for monetary storage/calculation.
- [ ] Normalized Tunisia phone uniqueness/search behavior passes.

## Commerce and configurable customer requirements

- [ ] Server recalculates all prices, promotion, tax, delivery fee and totals.
- [ ] Integer-millime unit/property tests pass.
- [ ] Guest and customer server-backed cart/checkout pass.
- [ ] Invalid and unsupported addresses are rejected; deterministic delivery fee is correct.
- [ ] Checkout idempotency returns one order under retry/concurrency.
- [ ] Inventory row-lock/final-unit test proves no oversell/negative stock.
- [ ] Reservation expiry/cancel/release and return inspection pass.
- [ ] Archived/unpublished product cannot be purchased and remains in history.
- [ ] Order/address/item/warning/promotion/consent/age snapshots are complete.
- [ ] Maintenance, checkout-disabled, prelaunch, required minimum-age, missing-store, and missing-delivery gates block order creation.
- [ ] Missing legal approval metadata and unpublished legal documents do not block checkout.
- [ ] Entry/checkout age, terms, privacy, recording, and delivery-age controls are each tested enabled and disabled without bypassing unrelated controls.
- [ ] Enabled age entry/checkout confirmation and delivery-required results are preserved.
- [ ] Failed delivery age verification can never become delivered.

## Catalog, upload and frontend

- [ ] SKU/barcode uniqueness, archive/restore and historical references pass.
- [ ] Upload MIME/signature/decode/dimension/size/path/SVG/malware tests pass.
- [ ] Object bucket is private/versioned and approved derivatives use safe delivery.
- [ ] French and Arabic content is complete; RTL and logical layout are reviewed.
- [ ] Responsive mobile/desktop, keyboard, screen-reader, focus and error states pass.
- [ ] Automated accessibility checks and manual critical-flow audit pass.
- [ ] No localStorage authentication or authorization-critical client state exists.
- [ ] Unpublished/archived data is absent from APIs, direct URLs, sitemap and structured data.
- [ ] Production source maps are disabled or protected.

## Delivery and COD

- [ ] Complete delivery transition matrix and unauthorized/invalid cases pass.
- [ ] Assignment, attempt, reschedule, refusal/failure/return and manifest tests pass.
- [ ] Courier callback/import is authenticated, idempotent, validated and replay-safe.
- [ ] Collection is separate from delivery; partial collection is disabled by default.
- [ ] Duplicate collection/allocation and concurrent remittance are prevented.
- [ ] Cash custody, remittance, discrepancy, reversal and reconciliation equations pass.
- [ ] cash.reconcile requires permission, recent auth and configured dual control.
- [ ] Reports distinguish expected/collected/held/remitted/discrepant/reconciled.
- [ ] CSV exports/imports are bounded, PII-minimal, formula-safe and audited.

## Security and privacy

- [ ] Threat model/security review covers implemented architecture and providers.
- [ ] SQL/XSS/CSRF/SSRF/IDOR/mass-assignment/upload/path/redirect/header/log/CSV tests pass.
- [ ] Request/response limits, DTO allowlists, safe errors and timeouts pass.
- [ ] CSP/HSTS/nosniff/frame/referrer/permissions policies are verified over TLS.
- [ ] Structured logs redact every required secret/PII class and production stacks.
- [ ] Audit/security histories are complete and immutable through normal APIs.
- [ ] Customer export/deletion/anonymization and operator retention procedures are tested.
- [ ] No national identity-document photos are stored by default.
- [ ] Independent human application/infrastructure security review is accepted.

## Queues, observability and performance

- [ ] Outbox/commit-safe publication and idempotent worker replay tests pass.
- [ ] Retry, backoff, dead-letter, recovery and queue-loss procedures pass.
- [ ] Logs, request/correlation IDs, traces and metrics join across API/worker.
- [ ] Dashboards cover latency/error, DB, queue, auth, checkout, inventory, delivery and COD.
- [ ] Alerts page the correct owner and a test alert is acknowledged.
- [ ] Graceful shutdown, liveness/readiness and dependency-failure behavior pass.
- [ ] Recorded staging load reaches 500 browsing users and 50 checkouts in the documented environment.
- [ ] Error rate is measured below 1% with no oversell, duplicates or unauthorized access.

## Backup, recovery and incidents

- [ ] Encrypted MySQL full plus PITR/binlog policy is active and monitored.
- [ ] Object versioning/replication and Redis persistence/rebuild are configured.
- [ ] Backup deletion is isolated from runtime credentials; retention is approved.
- [ ] Isolated restore verifies checksums, application and business invariants.
- [ ] Actual RPO/RTO are measured and accepted.
- [ ] Incident contacts, private channel, provider escalation and legal notification process are current.
- [ ] Admin compromise, data exposure, integrity, COD and DR tabletop exercises pass.

## Deployment and operations

- [ ] Store/admin DNS, TLS, host separation and unknown-Host rejection pass.
- [ ] MySQL, Redis, MinIO console, Mailpit, Swagger and admin are not publicly exposed incorrectly.
- [ ] Protected environment requires passing CI and manual human approval.
- [ ] Migration job, immutable image promotion, health rollout and rollback are rehearsed.
- [ ] Storefront/admin smoke tests and monitoring verification are scripted.
- [ ] Checkout/maintenance/prelaunch settings and stricter environment overrides cannot be bypassed by deployment.
- [ ] Operator/admin/delivery/COD guides are trained and owners are named.
- [ ] Support, privacy, cash, inventory, security and release handoffs are staffed.

## Final evidence

- [ ] Architecture review has no unresolved release blocker.
- [ ] Security review has no unresolved release blocker.
- [ ] Business-logic review has no unresolved release blocker.
- [ ] Production-readiness review lists every failure, limitation, risk and credential.
- [ ] Human security approver signs.
- [ ] Business owner accepts measured operational, RPO/RTO and residual risks.
