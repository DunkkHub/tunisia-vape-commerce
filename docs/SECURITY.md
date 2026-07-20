# Security controls

## Security baseline

Security is deny-by-default and layered across Nginx, NestJS guards/validation, domain services, MySQL constraints/transactions, Redis coordination, CI, and operational review. Frontend route guards are usability controls only.

## Customer and administrator login separation

- Customer endpoints: /api/v1/auth/customer/register, login, logout, reset, verify, sessions, and revoke.
- Administrator endpoints: /api/v1/auth/admin/login, totp/verify, recovery/verify, logout, sessions, revoke, and recent-auth.
- Customer UI: /login. Administrator UI: /admin/login.
- Cookie names, signing/encryption context, Redis prefixes, CSRF state, rate limits, timeouts, and guards must differ.
- Startup validation must reject identical cookie names or session prefixes.
- Admin password success never creates an authorized admin session. Mandatory TOTP or a one-time recovery code completes authentication.
- A customer principal can never be upgraded to an admin principal based on a role field from the browser.

Production cookies are host-only, Secure, HttpOnly, SameSite=Lax unless a documented flow requires stricter behavior, and narrowly scoped to the serving host. Production requires distinct storefront and administrator origins/hosts; local development may deliberately use one origin. Mutation requests also require a session-bound CSRF token and valid Origin. Session identifiers are opaque 256-bit random values and only their keyed hash is persisted where practical.

## Passwords, MFA, and tokens

- Hash passwords with Argon2id using parameters benchmarked on the production class and reviewed annually; keep a pepper in the secret manager if adopted.
- Enforce length and breached/common-password checks for admins; do not use composition rules that encourage predictable passwords.
- Normalize email/phone for lookup but preserve display values separately.
- Verification, invitation, reset, and pending-2FA tokens are high entropy, short lived, single use, and stored as hashes. Completing a customer password reset atomically consumes every outstanding customer reset token for that account before revoking its customer sessions.
- Encrypt TOTP seeds with the field-encryption key and bind associated data to the admin ID/purpose.
- Generate enrollment QR codes locally from the server-issued `otpauth://` URI. Keep an encrypted, unverified seed stable across password retries so a scanned enrollment cannot be invalidated implicitly; replace it only after verification or through an authorized reset flow.
- Hash individual recovery codes, show them once, consume atomically, and notify/log their use.
- Rotate the session on login, MFA completion, password change, privilege change, and recent-auth completion.

## Authorization

Every protected controller declares an authenticated principal type and permission. Services re-check ownership and state invariants at the data query, preventing IDOR if a controller changes. Admin permissions are server-derived from active role assignments; suspension and a global session-version check apply immediately.

Dangerous actions require permission plus recent authentication, explicit confirmation input, reason, and audit. Cash reconciliation and the most sensitive role/compliance changes should support separate approver policy. Super Administrator does not bypass domain state machines or immutable history.

### Exact Super Administrator account lifecycle boundary

The account-lifecycle controllers use an exact server-derived `super-administrator` role guard in addition to normal permission checks. Possessing `users.manage`, `customers.suspend`, or `system.manage`, or sending a role name from the browser, never satisfies this role gate. Mutations add administrator CSRF and recent-authentication guards, and the service revalidates that the actor is an active, non-suspended administrator with verified TOTP and the exact role inside the database transaction.

Role-row locking serializes the super-administrator availability decision. An administrator cannot change their own lifecycle state, and a super-administrator cannot be suspended or anonymized unless another active, non-suspended, TOTP-enrolled super-administrator remains. Expected user/profile versions prevent stale confirmations from overwriting a concurrent account change. Creation through the management API cannot assign `super-administrator`; that escalation requires a separate approved workflow.

Suspending an administrator revokes only active `ADMIN` sessions for that user. Suspending, disabling, or explicitly revoking sessions for a customer affects only the `CUSTOMER` realm. Reactivation never issues a session. Administrator anonymization is suspended-first and removes role assignments, MFA/recovery/reset material and direct identifiers while retaining stable audit references. Customer disable is access control only. The distinct customer anonymization action requires an exact Super Administrator, recent authentication, expected versions, explicit confirmation, no non-terminal orders, and an audit record; it removes direct account/address/credential data and encrypted notification recipients while preserving immutable commercial, consent, internal-note, security, and audit history.

The first administrator remains a bootstrap exception performed only with `pnpm admin:create` in an interactive trusted TTY. The command refuses to run once any administrator exists, locks the Super Administrator role row, assigns the seeded exact role, requires TOTP enrollment at first login, and appends a system audit event. It has no default password, command-line password, or seeded account.

## Request and response safety

- Globally reject unknown fields, transform only declared types, and cap nesting, array length, text size, and request body.
- Parse money only as integer millimes or validated decimal input converted exactly at the boundary.
- Use response DTO allowlists; never serialize Prisma records directly.
- Use stable safe errors with requestId. Production does not expose causes, SQL, paths, or stack traces.
- Allow credentialed CORS only from the exact `WEB_URL` and `ADMIN_WEB_URL` origins. Production validates that both are HTTPS origin-only URLs and distinct, and that their hostnames match `STOREFRONT_HOST` and `ADMIN_HOST`. Never combine credentials with a wildcard origin or an independently configured catch-all list.
- Enforce JSON/content types and reject ambiguous duplicate parameters.
- Configure request, upstream, database, Redis, and provider timeouts.

## Browser and edge protections

Nginx sets CSP, HSTS after verified TLS deployment, frame-ancestors, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy. HTML/admin responses are not publicly cached. Static hashed assets may be immutable. Do not publish source maps unless access-controlled.

React does not render untrusted HTML. If business-approved rich content is introduced, sanitize it on write and render with an allowlist sanitizer. Product links, redirects, and media sources are validated. Arabic RTL support must not rely on unsafe inline markup.

## CSRF and CORS

Cookie SameSite is defense in depth, not the only CSRF control. The API issues a realm-specific synchronizer token bound to the server session. `TrustedOriginGuard` applies globally: storefront/customer routes accept only `WEB_URL`, administrator routes and optional OpenAPI docs accept only `ADMIN_WEB_URL`, cross-site Fetch Metadata is denied, and requests carrying an unconfigured Origin are denied. POST, PUT, PATCH, and DELETE additionally require the realm-specific token in a custom header. Tokens rotate on authentication transitions. Login CSRF is considered and the admin/customer login buckets and tokens are separate.

The production edge repeats this boundary before NestJS. The storefront virtual host never serves `/admin`, forwards `/api/v1/admin` or `/api/v1/auth/admin`, or exposes any `/api/docs*` OpenAPI UI/schema route; the administrator virtual host does not forward customer authentication; unknown hosts are dropped. OpenAPI UI is absent by default in production and exists only after the explicit validated `OPENAPI_ENABLED=true` opt-in, on the protected admin host.

## Sessions and Redis

Redis keys contain no raw session ID in logs. Session records include principal/realm, authentication assurance, created/last-used/absolute expiry, session version, hashed user agent where useful, and revocation metadata. Reads refresh idle expiry only within a bounded cadence. Redis loss signs users out safely; MySQL remains authoritative for account suspension and role state.

Production Redis uses authentication, TLS/private networking, eviction policy that does not silently evict critical queues, memory alerts, and key namespaces per environment and realm.

## Data and database

- Runtime and migration database users are separate; runtime has only required DML.
- MySQL is private, uses InnoDB/utf8mb4/UTC, encrypted transport/storage, query timeouts, slow-query monitoring, and tested backups.
- Prisma parameters are standard. Any raw query uses placeholders and focused review.
- Critical inventory/order/COD changes use transactions, row locks, unique constraints, and append-only event records.
- Encrypt selected high-risk fields at the application layer; manage keys outside the database and plan rotation/version metadata.
- Avoid storing identity documents. Minimize PII in audit before/after summaries.

## Uploads and object storage

Uploads land in a private quarantine prefix using random server keys. Validate declared MIME, signature, decoded format, dimensions/pixel count, size, and allowed extensions; strip path data/metadata; reject SVG and executables. Scan before promotion, re-encode images, create bounded responsive variants, and record uploader/time/hash. Downloads use short-lived scoped URLs or an authenticated proxy. Bucket versioning and lifecycle rules are enabled.

## Checkout, inventory, delivery, and COD

- Never accept browser prices, discount eligibility, tax, delivery fee, stock, role, state, or totals as authoritative.
- Scope and uniquely constrain checkout idempotency; lock inventory in stable order; calculate available stock from authoritative state.
- Persist commercial/consent/address/warning snapshots with the order.
- Enforce delivery state transitions and assignments server-side. A failed age check cannot become delivered.
- COD collection and remittance are distinct. Reconciliation requires elevated permission, recent auth, evidence/reason, audit, and ideally separate approver.

## Logging and detection

Use structured JSON with UTC time, severity, service, environment, request/correlation ID, safe actor/resource IDs, action and result. Central redaction removes authorization, cookies, passwords, tokens, TOTP/recovery material, encryption keys, database URLs, provider credentials, and unnecessary address/phone/email content.

Security events include login failures/throttling, MFA/recovery use, session revocation, unusual admin login, permission change, export, compliance change, upload rejection, checkout abuse, invalid transitions, and reconciliation discrepancy. Alert thresholds and on-call routes are environment-specific and tested.

## Secrets and CI/CD

Use a managed secret store in controlled staging/production. Secrets are per environment, least privilege, never committed or printed, and rotated with dual-key or coordinated procedures. CI uses protected environments, minimal token permissions, reviewed actions, frozen dependencies, secret/SAST/dependency/container scans, SBOMs, and immutable image identifiers.

Production changes require passing CI and manual environment approval. A dedicated job applies reviewed migrations after backup/rehearsal; application startup does not opportunistically mutate schema.

## Vulnerability reporting and response

Do not file real secrets or exploitable customer details in public issues. Notify the named security owner through the private organizational channel, preserve evidence, and follow docs/INCIDENT_RESPONSE.md. Rotate exposed credentials immediately; do not wait for root-cause completion.

## Review cadence

Review this baseline and docs/THREAT_MODEL.md for every authentication, integration, upload, export, cash, deployment, or legal-gate change; quarterly in operation; and after every security incident. Exceptions are time-limited, owned, documented with compensating controls, and included in the readiness report.
