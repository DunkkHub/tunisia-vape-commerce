# Security controls

## Security baseline

Security is deny-by-default and layered across Nginx, NestJS guards/validation, domain services, MySQL constraints/transactions, Redis coordination, CI, and operational review. Frontend route guards are usability controls only.

## Customer and administrator login separation

- Customer endpoints: /api/v1/auth/customer/register, login, Google start/callback/onboarding/complete, logout, reset, sessions, and revoke.
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

### Customer Google OAuth and recovery

Google sign-in uses the authorization-code flow with PKCE S256, cryptographically random state and nonce, an exact registered callback, and the official Google verification library. Issuer, audience, authorized presenter, expiry, issued-at time, nonce, subject, and verified-email claims are checked before account lookup. State and onboarding records are encrypted in Redis, bound to HttpOnly SameSite=Lax cookies, consumed once, and retained for at most the validated short TTL. OAuth codes, access/refresh tokens, raw provider subjects, PKCE material, state, nonce, and cookies are never persisted or logged; request logging strips all query strings before serialization.

External identities belong to `CustomerProfile`, not `User`, so an administrator cannot acquire Google customer authentication. The callback accepts only the exact customer path and cannot redirect to `/admin`, `/api`, another origin, a protocol-relative URL, or a backslash-normalized URL. Existing verified customer email is linked transactionally; an unverified local-email match requires the existing password. Provider-only customers have no synthetic password. The database still requires every `ADMIN` user to have a password hash, and admin login remains password plus mandatory TOTP.

Password-reset requests always return the same response and execute the same Argon2 timing baseline. Per-IP and per-account Redis buckets are independent and fail closed. Local-password resets use configurable short-lived random tokens stored only as hashes; notifications carry only an encrypted token for worker-side rendering. Google-only accounts receive coalesced provider sign-in guidance instead of a fake reset link. Successful reset atomically consumes all outstanding customer reset tokens and revokes customer sessions only.

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

Uploads use random server keys and a private storage boundary. Validate declared MIME, signature, exact container boundary, decoded format, dimensions/pixel count, size, page count, and allowed extensions; reject SVG, executables, animation, corruption, and appended/polyglot content. Auto-orient and re-encode accepted JPEG, PNG, WebP, or supported AVIF bytes, retain only the color profile needed for fidelity, strip EXIF/XMP/comments and path data, sanitize the original filename for audit display, and record uploader/time/hash. Generate only bounded server-controlled WebP/JPEG storefront renditions from those sanitized pixels. Libvips concurrency/cache and the application media-processing slot bound near-limit upload memory. Each image has exactly one product or variant owner, duplicate checksums are owner-scoped, and replacement/deletion uses optimistic versions plus a bounded versioned outbox media-set cleanup. Downloads use the age-gated media proxy. Originals are checked against persisted byte count and SHA-256. Rendition cache hits require a complete immutable current-profile manifest and are checked directly against persisted byte count, SHA-256, and dimensions. A missing manifest or object fails with the safe public not-found response; the public request path never decodes the original, invokes Sharp, writes storage/metadata, or queues repair. Catalog and administrator DTOs fall back to their checksum-verifying original route unless the full eight-row manifest exists. Random server keys, a strict key grammar, and fixed rendition names prevent client-selected storage paths or traversal. Bucket versioning and lifecycle rules are enabled.

## Catalog import and external-source safety

- Catalog import requires a full TOTP administrator session, `catalog.import`, administrator CSRF, recent authentication, throttling, explicit confirmation, and audit. A browser-supplied role or pending-2FA challenge cannot authorize it.
- CSV/JSON is limited to 2 MiB and 2,000 rows, uses an exact versioned schema, rejects spreadsheet-formula prefixes, validates every typed field, and persists a dry run before mutation.
- Apply binds the canonical payload to an import key/mode fingerprint and revalidates the stored preview. A concurrent unique-key loser is replayed only after loading the committed winner and matching that fingerprint; other unique failures remain failures. Default options preserve manual price, status, stock, and images; import cannot publish or create inventory.
- Official Wotofo fetches use HTTPS and exact `www.wotofo.com` product paths plus the reviewed `cdn.shopify.com` Wotofo asset prefix. Generic image downloads are disabled by default and require an exact operator-configured DNS hostname, HTTPS, public-only DNS answers, and redirect destinations that remain on that allowlist. IP literals are rejected and validated public addresses are pinned into the outbound connection to prevent DNS rebinding. Retries, timeouts, redirects, response sizes and concurrency are bounded, and an official option mismatch fails closed.
- Downloaded media passes through the same raster validator/re-encoder/storage service as a manual upload. Active images are never replaced without the preview's explicit `overrideImages` authorization; source URL hashes, payload/content checksums, verification state, and owner provenance are retained. A changed-source override moves the prior canonical key to a reserved historical key while leaving that source row's provenance and old image link intact, then creates a new canonical record. Audit links both records using safe IDs, hashes, and checksums without copying raw source URLs. Generic media commits as non-primary `PENDING` content with provenance and import-row checkpoints in the same database transaction. It is visible only through the authenticated ownership-checked administrator content route until a CSRF/recent-auth/version/audit protected approve decision. Generic provenance is never promoted to officially verified merely because transport or human visual validation succeeded.
- Renewable token-owned Redis leases serialize the same batch and global catalogue-media capacity across API instances. Work is capped at 30 candidates per product and 150 per batch, with three product groups active. Two attempts, two redirects per attempt, 10-second request timeouts, and a five-second maximum synchronous retry delay bound remote-fetch scheduling to 5,200 seconds; the gateway's 7,200-second read timeout is scoped to the exact media-import administrator route and does not broaden ordinary API timeouts.
- Imported image metadata and checkpoints are transactional in MySQL, but object storage cannot participate in that transaction. Database failures trigger best-effort object deletion. Bucket versioning, lifecycle controls, object inventory, and monitored reconciliation are still required to detect an object orphaned by a process failure after upload and before commit.
- Automatic rollback is all-or-nothing, create-only, version guarded, and archival. It stops rather than overwriting a later manual change. Backup and object-storage recovery remain separate controls.

## Checkout, inventory, delivery, and COD

- Never accept browser prices, discount eligibility, tax, delivery fee, stock, role, state, or totals as authoritative.
- Scope and uniquely constrain checkout idempotency; lock inventory in stable order; calculate available stock from authoritative state.
- Persist commercial/consent/address/warning snapshots with the order.
- Enforce delivery state transitions and assignments server-side. A failed age check cannot become delivered.
- Courier WhatsApp handoff is administrator-only and manual: the API validates the courier's E.164 number, substitutes only allowlisted server snapshots into a bounded template, URL-encodes the message, and returns an HTTPS `wa.me` preview. It never sends automatically or stores rendered customer data in audit metadata. Operators must treat opening WhatsApp as an authorized disclosure to that courier and configure only the minimum template fields required for delivery.
- COD collection and remittance are distinct. Reconciliation requires elevated permission, recent auth, evidence/reason, audit, and a separate approver for discrepancy closure. Collection corrections append a scoped adjustment event; original recorded cash is not overwritten and ambiguous legacy scopes fail closed.

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
