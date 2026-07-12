# Implementation plan

Last updated: 2026-07-11

## Delivery policy

Work proceeds in reviewable vertical slices. A phase is complete only when its code, migrations, tests, builds, documentation, and operational checks pass. A green build does not imply legal approval, measured capacity, backup validity, or production readiness.

The exact dependency set is pinned by package.json files and pnpm-lock.yaml. CI installs with the frozen lockfile. Renovation of a dependency requires its changelog, security impact, migration notes, and regression results to be reviewed.

## Selected dependency baseline

The direct dependency baseline selected in the manifests on 2026-07-11 is:

| Area                   | Exact versions                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain              | Node >=22.12.0 (container line 24), pnpm 11.11.0, TypeScript 5.9.3, Prisma/Prisma Client 6.19.2, ESLint 10.7.0, Prettier 3.9.5, tsx 4.23.0                                   |
| API framework/security | NestJS common/core/platform-express 11.1.28, Nest config 4.0.4, Swagger 11.4.5, throttler 6.5.0, Argon2 0.44.0, Helmet 8.2.0, cookie-parser 1.4.7, Zod 4.4.3                 |
| API runtime/telemetry  | ioredis 5.11.1, nestjs-pino 4.6.1, pino-http 11.0.0, otplib 13.4.1, qrcode 1.5.4, RxJS 7.8.2, uuid 14.0.1                                                                    |
| Web                    | React/React DOM 19.2.7, Vite 8.1.4, React Router 7.18.1, TanStack Query 5.101.2, React Hook Form 7.81.0, Zod 4.4.3, i18next 26.3.6, react-i18next 17.0.9, Tailwind CSS 4.3.2 |
| Accessible UI          | Radix Dialog 1.1.19, Radix Slot 1.3.0, Lucide React 1.24.0                                                                                                                   |
| Tests                  | Vitest 4.1.10, Testing Library React 16.3.2/User Event 14.6.1/jest-dom 6.9.1, Playwright 1.61.1, Supertest 7.2.2, jsdom 29.1.1                                               |
| Worker                 | BullMQ 5.80.2, ioredis 5.11.1, Pino 10.3.1, Zod 4.4.3                                                                                                                        |
| Local containers       | MySQL 8.4, Redis 7.4 Alpine, MinIO RELEASE.2025-04-22T22-12-26Z, MinIO client RELEASE.2025-04-16T18-13-26Z, Mailpit v1.27, Nginx unprivileged 1.28 Alpine                    |

The lockfile, not this summary, resolves transitive versions. Before controlled staging, review runtime compatibility and security advisories, pin container digests and CI action commit SHAs, generate an SBOM, and record any approved exception.

## Current status

| Phase                             | Scope                                                                         | Status      | Exit evidence                                                            |
| --------------------------------- | ----------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------ |
| 1. Foundation                     | pnpm workspace, React, NestJS, worker, configuration, Docker, CI              | In progress | Fresh install, all services healthy, configuration rejection tests       |
| 2. Database                       | Complete Prisma model, migration, structural Tunisia/RBAC seed, indexes       | In progress | Empty and existing database migration tests; no default admin            |
| 3. Authentication and RBAC        | Separate customer/admin authentication, sessions, 2FA, permissions, admin CLI | In progress | Realm-separation, session, CSRF, throttling, 2FA, RBAC matrix tests      |
| 4. Catalog                        | Products, variants, taxonomy, suppliers, images, admin CRUD, storefront       | Planned     | CRUD, archival/history, uniqueness, upload-security, accessibility tests |
| 5. Inventory                      | Locations, movements, reservations, batch/expiry, concurrency                 | Planned     | Final-unit race and reservation-expiry tests; stock never negative       |
| 6. Geography and delivery pricing | Tunisia hierarchy, zones, rates, pickup, deterministic resolver               | Planned     | 24 governorates seeded; unsupported/rate-priority tests                  |
| 7. Cart and checkout              | Guest/customer carts, promotions, authoritative totals, COD, idempotency      | Planned     | Mandatory checkout scenarios and money/property tests                    |
| 8. Orders and delivery            | State machines, attempts, manifests, courier adapters, notifications          | Planned     | Transition matrix, failed-age-check, return workflow tests               |
| 9. COD reconciliation             | Collection, remittance, discrepancies, reports                                | Planned     | Segregation-of-duty and end-to-end reconciliation tests                  |
| 10. Compliance                    | Age gates, legal versions, consent, delivery verification, launch gate        | Planned     | Checkout remains closed for every missing prerequisite                   |
| 11. Reporting/admin               | Dashboards, customer operations, exports, audit/security/job views            | Planned     | Permission, pagination, privacy, CSV-injection, audit tests              |
| 12. Hardening                     | Security, accessibility, load, backup/restore, staging deployment             | Planned     | All definition-of-done evidence recorded and independently reviewed      |

Do not change a status to complete based on unrecorded local results. Link CI runs, test reports, migration checks, restore evidence, and human sign-offs in this file or the readiness report.

## Phase details

### Phase 1 — foundation

- Establish strict TypeScript across the workspace.
- Validate every environment variable at API and worker startup.
- Keep API instances stateless; put sessions, distributed throttles, cache coordination, and queues in Redis.
- Provide MySQL 8.4, Redis, MinIO, Mailpit, API, worker, web, and Nginx containers with health checks and persistent development volumes.
- Use multi-stage images and non-root runtime users.
- Establish formatting, lint, type, unit, integration, build, dependency, secret, static, image, and SBOM CI gates.
- Exit only after docker compose up -d reaches healthy state from a clean machine.

### Phase 2 — database

- Model all required domains with foreign keys, uniqueness, referential behavior, immutable snapshots, archive fields, and UTC timestamps.
- Keep physical on-hand quantity authoritative. Derive available quantity as on-hand minus active reservations; do not persist a conflicting available value.
- Use a structural seed only: roles, permissions, role mappings, 24 governorates, secure settings, and feature flags.
- Validate query plans for catalog, inventory, order, delivery, COD, audit, and reporting access paths.
- Test an empty migration and a representative prior-version upgrade.

### Phase 3 — authentication and authorization

- Implement customer endpoints only under /api/v1/auth/customer/* and admin endpoints only under /api/v1/auth/admin/*.
- Use distinct cookie names, Redis session prefixes, CSRF tokens, throttles, guards, login audit events, revocation, and timeouts.
- A successful admin password check creates only a short-lived pending challenge. Mandatory TOTP or a one-time recovery code promotes it to a full admin session.
- Keep the admin UI entry at /admin/login and customer entry at /login.
- Implement Argon2id hashing, generic errors, progressive delay, reset/verification token hashing, rotation, idle and absolute expiry, and full revocation.
- Create the first Super Administrator through a secure interactive CLI; never seed one.
- Enforce permissions on the NestJS API and add a deny-by-default RBAC matrix.

### Phases 4–7 — commerce core

- Complete catalog, upload quarantine, inventory, Tunisia geography/rates, cart, promotion, and checkout slices.
- The current commerce API slice exposes bounded published catalog reads, guarded/audited product create-update-archive-restore operations, authoritative checkout-policy evaluation, and a non-reserving integer-millime quote. Atomic idempotent order creation remains planned and must not be represented by the quote endpoint.
- Resolve delivery rate precedence deterministically: explicit locality rule, delegation rule, governorate rule, zone rule, then eligible store-wide base; apply documented surcharges in stable priority order. A missing or ambiguous result blocks checkout.
- In one transaction, claim idempotency, lock inventory, validate publication/age/quantity, calculate promotions/delivery/totals, create snapshots/reservations/order/history, then commit.
- Publish notification jobs through an outbox or equivalent commit-safe mechanism; workers are idempotent.

### Phases 8–11 — operations

- Enforce order and delivery transition matrices on the backend and preserve immutable histories.
- Make a failed age-verification result terminal for delivery until a separately authorized return/override workflow.
- Track COD expected, collected, held, remitted, discrepant, and reconciled as separate events and amounts.
- Require recent authentication and elevated permission for reconciliation, inventory corrections, role changes, compliance publication, and other dangerous actions.
- Bound every list/export; enqueue large exports; minimize personal data and neutralize CSV formulas.

### Phase 12 — hardening and release

- Run architecture, security, business-logic, accessibility, and operations reviews.
- Run the documented 500-browser/50-checkout staging workload; record the environment and actual results without extrapolation.
- Execute backup and isolated restore drills and record RPO/RTO measurements.
- Scan dependencies, source, secrets, containers, and SBOMs; resolve or accept findings through time-limited risk records.
- Obtain Tunisian legal/regulatory and human security approval before considering any limited production release.

## Mandatory scenario ledger

The following require automated evidence: guest and customer COD checkout; invalid and unsupported addresses; exact server delivery fee; final-unit exclusion; idempotent retry; customer-order IDOR denial; RBAC denials; valid delivery transitions; admin-without-2FA denial; archived product behavior; reservation release; refused/failed-age return flows; cash collection/remittance/reconciliation; malicious upload rejection; login throttling; CSV injection protection; and maintenance, checkout-disabled, and legal-review gates.

## Blocking external inputs

Implementation can use closed-by-default placeholders, but controlled staging cannot open checkout without:

- Written qualified Tunisian legal and regulatory confirmation.
- Minimum purchasing age and approved delivery identity/age process.
- Published legal document content and product warnings.
- Legal store identity, tax/invoice policy, and return/refund policy.
- Real store contact details and delivery coverage/rates.
- Approved courier operating process or credentials.
- Production DNS/TLS, secrets, SMTP/SMS, object-storage, monitoring, and backup destinations.
- Named owners for security, incidents, cash reconciliation, privacy requests, and releases.

## Definition of done

All required root scripts pass; web, API, worker, and Docker production builds pass; migrations succeed from empty and representative existing data; secure admin creation works; authorization and customer isolation are verified; no negative stock, oversell, duplicate order, invalid transition, or unreconciled ledger mutation is possible; backup and restore are proven; the compliance gate works; and all documentation/review evidence is current.
