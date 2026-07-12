# Production readiness report

Review date: 2026-07-12

## Executive assessment

The repository is under active greenfield implementation. Foundational architecture, security, API, deployment, backup, incident, delivery, COD and administration guidance has been established, including an explicit boundary between customer authentication at /api/v1/auth/customer/* and administrator authentication at /api/v1/auth/admin/*, with /admin/login and mandatory administrator TOTP.

No release claim is supported yet. Local builds, automated tests, a development database migration/seed, browser smoke checks, and the hosted CI workflow now pass, but the hosted security workflow remains blocked by confirmed container-image vulnerabilities. Target MySQL 8/Redis/Docker staging, legal review, provider setup, load results, and backup restoration evidence are not complete.

## Passed requirements

- The target modular-monolith and stateless API/worker architecture is documented.
- Customer and administrator authentication routes, cookies, sessions, CSRF, throttles, guards and timeouts are implemented as separate realms.
- Mandatory admin 2FA and password-only pending-challenge denial are implemented and covered by targeted security tests.
- Bounded, no-store administrator reads now cover dashboard, catalog, grouped inventory, orders, customers, deliveries, cash reconciliation summaries, redacted settings, and privacy-minimized audit data with exact seeded permissions.
- The public catalog supports combinable brand, product-type, flavor, and integer-millime price filters plus bounded facets under the age gate.
- Threat, security, deployment, backup/recovery, incident, delivery, COD and admin operational baselines exist.
- The compliance and checkout design is closed by default.

These results include local executable evidence but do not prove production infrastructure, legal approval, capacity, recovery, or independent security review.

## Local implementation verification

On 2026-07-12, a frozen-lockfile install completed and the root formatting, lint, strict type-check, unit/security test, and production build commands passed across the workspace. The latest recorded application suites reported 58 passing API tests and 11 passing web tests, for 69 total, including targeted authentication, permission-denial, catalog-filter/facet, grouped-inventory, redaction, and privacy-minimization coverage. Playwright separately reported four passing desktop/mobile route-separation checks. The integration-test command exited successfully but reported no integration test files.

Hosted CI run 29205303354 also passed formatting, linting, type checking, Prisma validation and migration, unit/integration/security tests, production builds, four Playwright end-to-end tests, and all three multi-stage Docker builds. The Playwright browser installation ran in the `@vape/web` workspace. Checkout and legal-release gates remained disabled during the run.

The initial Prisma migration and structural seed were applied successfully to a local XAMPP MariaDB 10.4 development instance. The seed created nine roles, 41 permissions, and all 24 Tunisian governorates, and deliberately created no customer, administrator, or product. This is useful smoke evidence, but MariaDB 10.4 is not the target MySQL 8.4 runtime and is not a compatibility certification.

The API and web development servers were started and probed successfully. `/api/v1/health/live` and `/api/v1/health/ready` returned healthy responses; the storefront proxy, signed age gate, empty catalog, customer `/login`, and separate administrator `/admin/login` were browser-smoke-tested. Local Redis subsequently answered `PONG`; invalid customer and administrator login probes returned the expected generic `401` rather than an infrastructure error, showing that both realms could use the distributed throttle. The BullMQ worker started and completed a synthetic local notification job. Real session, TOTP, recovery, notification-provider, and failure/retry flows remain unverified.

## Failed or unverified requirements

- Database-backed integration, complete RBAC/security matrices, accessibility and load test results have not been recorded. The new read-route unit and metadata tests do not replace real-database authorization and query-plan verification.
- Migration against target MySQL 8.4 and a representative existing-database upgrade have not been recorded.
- Secure local administrator creation through the interactive CLI passed; TOTP/recovery, session isolation/revocation and recent-auth flows have not been independently verified end to end.
- Database-backed final-stock concurrency, checkout idempotency, delivery/COD transitions, and reconciliation-balance results have not been recorded. Grouped inventory and cash summaries are read projections only.
- Hosted Docker builds, Trivy execution, SARIF upload, and SBOM generation completed. Security run 29205303375 correctly blocked all three runtime images on confirmed HIGH/CRITICAL findings. The current API and worker Dockerfiles narrowly update their bundled npm runtime tool to the first compatible fixed release; the web image remains blocked pending an explicitly reviewed NGINX image-line upgrade. Docker service health and controlled deployment evidence remain absent.
- Backup creation, isolated restore and measured RPO/RTO evidence are absent.

## Known limitations

- Docker Compose is a single-host development reference, not high availability.
- External email, SMS, courier, malware scanning, object storage, monitoring and backup providers remain adapters/placeholders until selected.
- Search, cache, reporting and load capacity have not been measured.
- Operational dual-control thresholds, retention periods and on-call targets are provisional.
- Separate production store/admin DNS and infrastructure are not provisioned.
- The newly exposed administration operations are read-only summaries. Order/customer/delivery/COD workflow mutations, setting publication, exports, and dual-control reconciliation remain incomplete or unverified.
- Grouped inventory is advisory and does not implement checkout reservation, final-unit locking, adjustment approval, or transfer workflows.
- The commerce API currently provides only a non-reserving checkout quote. Atomic idempotent COD order creation, locked inventory reservation, immutable checkout snapshots, and outbox publication remain unimplemented and unverified.

## Open security risks

- Runtime behavior has not yet undergone a human security assessment.
- Provider, network, WAF/egress, key custody and CI trust controls cannot be finalized without the target environment.
- Authentication realm separation, mandatory 2FA, CSRF, and the new read-route permission metadata/denials have targeted local test evidence, but upload handling, runtime log redaction, the complete authorization matrix, queue replay, query plans, and transactional invariants still require broader executable evidence.
- The package audit is clear after the narrow Prisma/Prisma Client 6.19.3 update moved transitive `effect` from 3.18.4 to 3.21.0, addressing GHSA-38f7-945m-qr2g without a major dependency upgrade.
- Trivy run 29205303375 reported 25 unique HIGH/CRITICAL CVEs: CVE-2026-12151 in npm's bundled `undici` for the API and worker images, plus 24 CVEs in the web image's NGINX/Alpine packages. The API and worker runtime stages now pin npm 11.18.0, the first npm 11 release containing fixed `undici` 6.27.0. The existing NGINX 1.28 image line has no published 1.28.3 image tag, so the remaining web remediation requires an explicit image-line compatibility review rather than a silent broad upgrade.
- Third-party actions now use valid stable major release channels, but immutable commit-SHA action and image pinning remains open hardening work.

## Missing infrastructure credentials

- Production MySQL runtime, migration and backup identities
- Production Redis authentication/TLS
- Session, cookie and field-encryption keys with rotation custody
- S3-compatible bucket and least-privilege credentials
- SMTP/email and SMS provider credentials
- Error monitoring and OpenTelemetry endpoints
- Container registry, protected deployment environment and TLS/DNS
- Encrypted immutable backup destination and key access

No credential should be added to the repository.

## Missing courier integrations

Only a manual/adapter architecture can be built without a selected Tunisian courier contract, API/CSV specification, authentication method, webhook signing, SLA, fee model, service coverage, tracking/status mapping, age-verification process and cash-remittance procedure. These require business, legal, privacy and security review.

## Legal blockers

Written confirmation from qualified Tunisian legal/regulatory professionals is missing for the legal/compliance checklist, including sale/import/customs, nicotine/product/label/warning, advertising, tax/invoice, consumer/return, delivery/age/identity, privacy/retention and minimum-age obligations. Approved French/Arabic legal documents and warnings are also missing. Checkout must remain disabled.

## Performance results

No controlled load result is recorded. The targets of 500 concurrent browsing users, 50 concurrent checkout attempts, below 1% error rate, no oversell, no duplicates and no unauthorized access remain unproven.

## Backup and restore results

No successful encrypted production-shaped backup or isolated restoration is recorded. RPO and RTO values in the recovery guide are provisional targets, not measured capability.

## Manual testing required

- French/Arabic and RTL review across storefront/admin
- Keyboard, screen reader, focus, contrast and mobile device flows
- Separate customer login and admin password-plus-TOTP/recovery flows
- Full COD checkout, order, delivery, failed-age, return and cash close
- Role-specific admin workflows and dangerous-action recent authentication
- Legal gate/maintenance/prelaunch behavior
- Restore, failover, provider failure and incident exercises

## Human review required

- Qualified Tunisian legal/regulatory and privacy review
- Independent application/infrastructure security review
- Accounting review of COD custody/reconciliation and tax treatment
- Courier/delivery/age-verification operating approval
- Accessibility/localization review by French and Arabic users
- Production infrastructure, backup, monitoring, incident and release-owner approval

## Final verdict

NOT READY
