# Engineering guide

This repository is a production-oriented, age-restricted commerce system for a Tunisian cash-on-delivery retailer. Treat legal approval, customer safety, inventory integrity, and cash custody as hard system boundaries.

## Read first

Before changing behavior, read:

- docs/IMPLEMENTATION_PLAN.md
- docs/ARCHITECTURE.md
- docs/DATABASE.md
- docs/SECURITY.md
- docs/THREAT_MODEL.md
- docs/API.md
- docs/LEGAL_AND_COMPLIANCE_CHECKLIST.md

Package manifests and pnpm-lock.yaml are the authoritative record of exact dependency versions. Do not silently change a major version or weaken a security setting; document the reason and migration impact.

## Repository map

- apps/web: React/Vite storefront and administration UI
- apps/api: NestJS REST API
- apps/worker: BullMQ background workers
- packages: shared types, validation, UI, and build configuration
- prisma: MySQL schema, migrations, and structural seed
- tests: cross-application integration, security, end-to-end, and load tests
- docker: container, proxy, and local infrastructure assets
- docs: architecture, operations, security, and delivery records

## Non-negotiable invariants

- The browser never talks directly to MySQL, Redis, or object storage credentials.
- The API recalculates prices, discounts, tax, delivery fees, availability, and totals.
- Money is integer millimes in TND. Never use floating point for monetary values.
- Timestamps are stored in UTC and rendered in Africa/Tunis.
- MySQL writes affecting orders, inventory, delivery, or COD use explicit transactions.
- The last available unit cannot be reserved twice; inventory rows are locked during checkout.
- Order creation is idempotent and preserves immutable commercial, address, warning, and consent snapshots.
- Historical records are not destroyed by catalog archival or customer anonymization.
- Audit and security records are append-only through normal application APIs.
- No administrator, product, order, or credential is created as demonstration production data.
  .

## Authentication boundary

Customer and administrator authentication are separate security realms.

- Customer API authentication: /api/v1/auth/customer/*
- Administrator API authentication: /api/v1/auth/admin/*
- Customer UI login: /login
- Administrator UI login: /admin/login
- Use different cookie names, session key prefixes, CSRF tokens, rate-limit buckets, guards, idle/absolute timeouts, and logout/revocation flows.
- An administrator credential is never accepted by the customer controller and a customer session is never accepted by an admin guard.
- Administrator TOTP is mandatory. A password-only or pending-2FA session cannot access protected admin APIs.
- Recovery codes are one-time values and are stored as hashes.
- Sensitive admin actions require a recent-authentication assertion as well as the relevant permission.
- Prefer separate storefront and admin hostnames in controlled staging and production so host-only cookies provide an additional browser boundary.

Do not merge these flows for convenience, infer roles from client input, store tokens in localStorage, or create a default administrator. The first administrator is created only through the interactive pnpm admin:create command.

## Change workflow

1. Identify affected invariants and update the implementation plan.
2. Make a small, reviewable change.
3. Add unit and integration coverage, including negative authorization cases.
4. Run formatting, linting, type checking, tests, and relevant production builds.
5. Update OpenAPI and operational documentation with behavior changes.
6. Record incomplete verification honestly in PRODUCTION_READINESS_REPORT.md.

Required checks are exposed as root pnpm scripts. At minimum run:

    pnpm format:check
    pnpm lint
    pnpm typecheck
    pnpm test:unit
    pnpm test:integration
    pnpm build

Run end-to-end, security, load, migration, Docker, backup, and restore checks when the affected surface warrants them.

## API and data rules

- All HTTP APIs are under /api/v1 and have validated request DTOs and explicit response DTOs.
- Errors use a stable code, safe message, request ID, and field errors where relevant. Never expose stack traces or database errors.
- Every protected endpoint declares authentication, permissions, rate limiting, and audit behavior.
- List endpoints are bounded and paginated. CSV exports neutralize formula prefixes and are audited.
- Use Prisma parameterization. Raw SQL requires a written reason, placeholders, tests, and review.
- Normalize Tunisian phone numbers before uniqueness or search comparisons.
- Avoid N+1 queries and analyze plans for major lists and reports.

## Security and privacy

- Never log passwords, session IDs, cookies, TOTP material, recovery codes, encryption keys, or unnecessary customer data.
- Validate MIME type, file signature, size, dimensions, and decoded content for uploads; reject SVG and executable content by default.
- Protect mutations with CSRF controls where cookie authentication is used.
- Keep CORS to an explicit allowlist and set CSP, HSTS, clickjacking, MIME-sniffing, and referrer protections at the edge.
- Use least-privilege database and object-storage credentials per environment.
- A security-relevant exception requires a tracked owner, expiry date, compensating control, and entry in the readiness report.

## Testing expectations

Tests must include successful behavior and denied behavior. Do not mock away the database transaction or authorization rule under test. Mandatory suites cover RBAC, authentication realm separation, admin 2FA, IDOR, checkout idempotency, final-stock concurrency, delivery transitions, configured age/consent failure, maintenance/prelaunch gates, upload security, and COD reconciliation.

The repository must not be described as production-ready merely because it builds. Only the verdict vocabulary in PRODUCTION_READINESS_REPORT.md is permitted.
