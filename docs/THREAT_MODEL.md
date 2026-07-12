# Threat model

Last reviewed: 2026-07-11

## Scope and method

This model covers the storefront, administration UI, REST API, worker, MySQL, Redis, S3-compatible storage, Nginx, CI/CD, backups, and integrations. It uses trust-boundary and misuse-case analysis informed by STRIDE. It must be updated when a new provider, data class, privileged action, or deployment path is added.

This is an engineering risk model, not a Tunisian legal opinion.

## Assets

- Customer account, address, phone, consent, order, and privacy-request data
- Administrator credentials, TOTP secrets, recovery codes, roles, and sessions
- Product price/publication/warning and compliance configuration
- Inventory quantities, reservations, movements, and cost data
- Delivery tracking, age-verification outcome, and proof references
- COD collection, remittance, discrepancy, and reconciliation records
- Session, CSRF, reset, verification, API, encryption, and signing secrets
- Audit/security histories, telemetry, backups, object versions, and CI artifacts
- Service availability and the business's reputation

## Adversaries and misuse

- Anonymous attackers testing accounts, injection, upload, denial-of-service, and checkout abuse
- Customers attempting IDOR, price/delivery manipulation, coupon abuse, duplicate orders, or false delivery claims
- Compromised customer devices and stolen sessions
- Malicious or compromised administrators abusing permissions or exports
- Couriers falsifying status, age checks, cash collection, or remittance
- Supply-chain attackers compromising packages, images, CI actions, or build artifacts
- Network/provider attackers returning malicious content or intercepting weak connections
- Accidental operators causing destructive migration, inventory, compliance, or cash errors

## Trust boundaries

- Internet to Nginx
- Storefront browser to customer authentication/API
- Admin browser to the distinct admin authentication/API realm
- API/worker to MySQL and Redis
- API/worker to object storage, email, SMS, courier, and observability providers
- CI runners to registries, deployment credentials, and runtime environments
- Primary environment to encrypted backup storage and isolated restore environment

## Threat and control register

| Threat                                  | Example impact                                                 | Required controls                                                                                                                                            | Verification                                     |
| --------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Broken access control / IDOR            | Read or mutate another customer's order                        | Server-derived principal, ownership predicates, response DTO allowlists, deny-by-default guards                                                              | Cross-customer integration tests                 |
| Auth realm confusion                    | Customer cookie accepted as admin, or admin login bypasses 2FA | Separate controller prefixes, cookie names, Redis namespaces, credential extractors, guards and CSRF; pending admin challenge has no privileges              | Realm-confusion and 2FA-negative tests           |
| Brute force / enumeration               | Account discovery and takeover                                 | Generic responses/timing, Redis rate limits by IP and normalized identity, progressive delay, security events, optional admin IP policy                      | Threshold and timing tests                       |
| Session fixation/theft/replay           | Account takeover                                               | Opaque high-entropy IDs, rotation on login/2FA/privilege change, Secure HttpOnly cookies, CSRF, idle/absolute expiry, revocation, no URL/localStorage tokens | Rotation, expiry, replay and logout tests        |
| TOTP/recovery compromise                | Privileged takeover                                            | Encrypted TOTP seed, one-way recovery-code hashes, one-time consumption transaction, bounded TOTP window/replay defense, recent auth                         | Enrollment/recovery/reuse tests                  |
| SQL/NoSQL/command injection             | Data theft or host compromise                                  | DTO validation, Prisma parameters, restricted raw SQL, no shell interpolation of request data, least privilege                                               | Static and malicious-input tests                 |
| XSS / content injection                 | Session-riding or defacement                                   | React escaping, sanitized rich text, no unsafe HTML, CSP, safe URLs, reject active SVG, HttpOnly cookies                                                     | Component/security tests and CSP scan            |
| CSRF                                    | Unwanted mutation using cookies                                | SameSite plus synchronizer token bound to the realm/session, Origin validation, mutation-only custom header, token rotation                                  | Cross-origin mutation tests                      |
| SSRF                                    | Reach metadata/internal services                               | Strict scheme/host allowlists, DNS/IP revalidation, block private/link-local ranges, no arbitrary URL fetch, egress policy                                   | Redirect/DNS-rebinding tests                     |
| Malicious upload                        | Stored XSS, malware, parser abuse                              | Size/count limit, magic-byte and decoded-image validation, pixel limit, metadata strip, quarantine/scan, random object keys, private bucket                  | Polyglot, SVG, traversal and decompression tests |
| Path/open redirect/header/log injection | Redirect phishing or record corruption                         | Enum/relative redirect allowlist, framework header APIs, CR/LF rejection, structured logs with redaction                                                     | Payload regression suite                         |
| Mass assignment                         | Role, price, state or ownership changes                        | Purpose-specific DTOs and explicit mapping; server-owned fields omitted                                                                                      | Unknown/privileged-field tests                   |
| Price/delivery manipulation             | Revenue loss                                                   | Server-side catalog, promotion, tax, weight, address and rate calculation; integer millimes; immutable snapshots                                             | Tampered-request tests                           |
| Overselling/race                        | Negative stock or duplicate final-unit orders                  | MySQL row locks, deterministic lock order, reservations, constraints/versioning, idempotency key                                                             | Parallel final-unit tests                        |
| Duplicate/replayed checkout             | Multiple COD orders                                            | Scoped unique idempotency key and stored result in same transaction                                                                                          | Concurrent retry tests                           |
| Invalid delivery transition             | Fake delivery or bypassed age check                            | Explicit server state machine, role/assignment checks, immutable event history, failed age check blocks delivered                                            | Transition matrix tests                          |
| COD fraud                               | Cash theft or false reconciliation                             | Separate event amounts, courier custody balance, evidence, permission plus recent auth, segregation of duties, immutable audit                               | Reconciliation and double-approval tests         |
| CSV formula injection                   | Code execution on analyst machine                              | Prefix dangerous leading characters, UTF-8 export rules, minimal columns, audit and warning                                                                  | Spreadsheet payload tests                        |
| Sensitive response/log exposure         | Customer or secret disclosure                                  | Response DTOs, centralized redaction, safe errors, no production stack traces/source maps, log retention/access control                                      | Schema snapshots and log scan                    |
| Cache poisoning/staleness               | Wrong availability or authorization                            | Never authorize/calculate checkout from cache; typed versioned keys; explicit invalidation                                                                   | Mutation/cache tests                             |
| Queue replay/poisoning                  | Duplicate notifications or stuck work                          | Deterministic job keys, idempotent handler ledger, bounded retry, DLQ, payload validation                                                                    | Replay and DLQ tests                             |
| Supply-chain compromise                 | Malicious build/runtime                                        | Frozen lockfile, trusted pinned actions/images, review dependency changes, SCA, secret scan, CodeQL, Trivy, SBOM and signed provenance target                | CI evidence                                      |
| Destructive migration                   | Outage/data loss                                               | Expand-contract, backup before risky changes, dry run on clone, dedicated migration identity, controlled job and rollback plan                               | Existing-data migration rehearsal                |
| Backup compromise/failure               | Data breach or unrecoverable loss                              | Encryption, isolated access, immutable retention, restore drill, key escrow/rotation                                                                         | Recorded isolated restore                        |
| DoS/resource exhaustion                 | Store unavailable                                              | Edge/body limits, distributed throttles, pagination, DB/query timeouts, queue backpressure, autoscaling and alerts                                           | Load/abuse tests                                 |

## Authentication boundary detail

The customer realm lives at /api/v1/auth/customer/* and the administrator realm at /api/v1/auth/admin/*. The UI routes are /login and /admin/login. Each realm has an explicit credential extractor that reads only its configured cookie. Startup fails if the cookie names or Redis prefixes collide.

An admin password success produces a pending challenge containing only admin ID, challenge ID, expiry, attempt counter, and allowed action. It cannot satisfy the admin session guard. TOTP or an unused recovery code is verified, the challenge is atomically consumed, and a new full session identifier is issued. Every full admin request verifies admin status, 2FA level, expiry, session version, and permissions.

Separate admin and storefront hostnames are required for the intended controlled staging/production topology. Host-only cookies and explicit Nginx virtual hosts add defense in depth. API authorization remains decisive if the proxy is bypassed or misconfigured.

## Privacy and legal-risk controls

- Collect only data needed for fulfillment, consent evidence, fraud prevention, treasury, and legal obligations.
- Do not store national identity-document images by default.
- Store delivery age result and minimal evidence reference, not excessive identity data.
- Restrict, audit, and asynchronously prepare customer exports; anonymization preserves lawful financial/history integrity.
- Retention periods require Tunisian legal/privacy approval and must be configurable.
- Age confirmation is not asserted to equal legally sufficient age verification; the legal checklist controls launch.

## Residual and open risks

- Tunisian sales/import/customs/advertising/age/privacy legality is unconfirmed until qualified written review.
- TOTP does not prevent a fully compromised admin browser; phishing-resistant MFA should be evaluated after baseline delivery.
- Provider and courier security cannot be assessed until integrations are selected.
- Self-hosted Compose lacks production high availability and managed key custody.
- Capacity, RPO, and RTO are claims only after controlled load and restore tests.
- Malware scanning, WAF policy, SIEM routing, and immutable audit export need production provider decisions.

All open risks must have an owner and disposition before the readiness verdict can advance.
