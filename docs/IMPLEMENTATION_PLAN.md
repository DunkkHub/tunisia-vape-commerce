# Implementation plan

Last updated: 2026-07-13

## Delivery policy

Work proceeds in reviewable vertical slices. A phase is complete only when its code, migrations, tests, builds, documentation, and operational checks pass. A green build does not imply legal approval, measured capacity, backup validity, or production readiness.

The exact dependency set is pinned by package.json files and pnpm-lock.yaml. CI installs with the frozen lockfile. Renovation of a dependency requires its changelog, security impact, migration notes, and regression results to be reviewed.

## Selected dependency baseline

The direct dependency baseline selected in the manifests on 2026-07-11 is:

| Area                   | Exact versions                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain              | Node >=22.12.0 (container line 24), pnpm 11.11.0, TypeScript 5.9.3, Prisma/Prisma Client 6.19.3, ESLint 10.7.0, Prettier 3.9.5, tsx 4.23.0                                   |
| API framework/security | NestJS common/core/platform-express 11.1.28, Nest config 4.0.4, Swagger 11.4.5, throttler 6.5.0, Argon2 0.44.0, Helmet 8.2.0, cookie-parser 1.4.7, Zod 4.4.3                 |
| API runtime/telemetry  | ioredis 5.11.1, nestjs-pino 4.6.1, pino-http 11.0.0, otplib 13.4.1, qrcode 1.5.4, RxJS 7.8.2, uuid 14.0.1                                                                    |
| Web                    | React/React DOM 19.2.7, Vite 8.1.4, React Router 7.18.1, TanStack Query 5.101.2, React Hook Form 7.81.0, Zod 4.4.3, i18next 26.3.6, react-i18next 17.0.9, Tailwind CSS 4.3.2 |
| Accessible UI          | Radix Dialog 1.1.19, Radix Slot 1.3.0, Lucide React 1.24.0                                                                                                                   |
| Tests                  | Vitest 4.1.10, Testing Library React 16.3.2/User Event 14.6.1/jest-dom 6.9.1, Playwright 1.61.1, Supertest 7.2.2, jsdom 29.1.1                                               |
| Worker                 | BullMQ 5.80.2, ioredis 5.11.1, Pino 10.3.1, Zod 4.4.3                                                                                                                        |
| Local containers       | MySQL 8.4, Redis 7.4 Alpine, MinIO RELEASE.2025-04-22T22-12-26Z, MinIO client RELEASE.2025-04-16T18-13-26Z, Mailpit v1.27, Nginx unprivileged 1.30.2 Alpine slim             |

The lockfile, not this summary, resolves transitive versions. Before controlled staging, review runtime compatibility and security advisories, pin container digests and CI action commit SHAs, generate an SBOM, and record any approved exception.

## Current status

| Phase                             | Scope                                                                         | Status      | Exit evidence                                                            |
| --------------------------------- | ----------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------ |
| 1. Foundation                     | pnpm workspace, React, NestJS, worker, configuration, Docker, CI              | In progress | Fresh install, all services healthy, configuration rejection tests       |
| 2. Database                       | Complete Prisma model, migration, structural Tunisia/RBAC seed, indexes       | In progress | Empty and existing database migration tests; no default admin            |
| 3. Authentication and RBAC        | Separate customer/admin authentication, sessions, 2FA, permissions, admin CLI | In progress | Realm-separation, session, CSRF, throttling, 2FA, RBAC matrix tests      |
| 4. Catalog                        | Products, variants, taxonomy, suppliers, images, admin CRUD, storefront       | In progress | CRUD, archival/history, uniqueness, upload-security, accessibility tests |
| 5. Inventory                      | Locations, movements, reservations, batch/expiry, concurrency                 | In progress | Final-unit race and reservation-expiry tests; stock never negative       |
| 6. Geography and delivery pricing | Tunisia hierarchy, zones, rates, pickup, deterministic resolver               | In progress | 24 governorates seeded; unsupported/rate-priority tests                  |
| 7. Cart and checkout              | Customer carts, authoritative totals, COD, reservations and idempotency       | In progress | Mandatory checkout scenarios and money/property tests                    |
| 8. Orders and delivery            | State machines, attempts, manual fulfillment and notifications                | In progress | Transition matrix, failed-age-check, return workflow tests               |
| 9. COD reconciliation             | Collection, remittance, discrepancies, reports                                | In progress | Segregation-of-duty and end-to-end reconciliation tests                  |
| 10. Compliance                    | Age gates, consent, delivery verification and operational launch gate         | In progress | Checkout remains closed for every missing operational prerequisite       |
| 11. Reporting/admin               | Dashboards, customer operations, settings, exports and audit views            | In progress | Permission, pagination, privacy, CSV-injection, audit tests              |
| 12. Hardening                     | Security, health, outbox, backup/restore, load and staging deployment         | In progress | All definition-of-done evidence recorded and independently reviewed      |

Do not change a status to complete based on unrecorded local results. Link CI runs, test reports, migration checks, restore evidence, and human sign-offs in this file or the readiness report.

The shared worktree now contains implementation slices for separated authentication and account lifecycle, published catalog and administrator product/variant/taxonomy operations, reservation-aware inventory, Tunisia geography and manual delivery configuration, authenticated customer carts, authoritative quotes, atomic idempotent COD order creation, customer order reads/cancellation, manual order and delivery fulfillment, COD custody/reconciliation, audited operational settings, durable outbox processing, dependency readiness, and encrypted logical backup/restore tooling. These are implementation facts, not completion evidence. Real MySQL/Redis concurrency, migration rehearsal, provider, restore, load, accessibility, security, and full browser evidence remain incomplete or unrecorded, so every affected phase remains **In progress**.

Owner-approved fresh-database defaults are now `checkout.enabled=true`, `legal_review.completed=true`, and `prelaunch.mode=false`, with corresponding environment defaults `CHECKOUT_ENABLED=true`, `LEGAL_REVIEW_COMPLETED=true`, and `PRELAUNCH_MODE=false`. Re-running the structural seed preserves an existing setting value rather than overriding an operator change. `LegalDocumentVersion` publication is not a global runtime checkout prerequisite. Checkout still fails closed for a stricter environment override, maintenance mode, an invalid minimum age, missing store name/phone/email/address, no active pickup or supported zone/current rate, unavailable required services, and request-specific consent, catalog, customer, address, stock, pricing, or COD validation failures. The structural seed creates no administrator, customer, product, stock, rate, pickup, or provider configuration.

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
- A successful admin password check creates only a short-lived pending challenge. Mandatory TOTP promotes it to a full admin session; a recovery endpoint is not currently exposed.
- Keep the admin UI entry at /admin/login and customer entry at /login.
- Implement Argon2id hashing, generic errors, progressive delay, reset/verification token hashing, rotation, idle and absolute expiry, and full revocation.
- Create the first Super Administrator through a secure interactive CLI; never seed one.
- Restrict that interactive CLI to the first administrator only. Subsequent named non-super administrators are created through the exact-super protected API and must enroll TOTP before becoming operational.
- Separate administrator and customer lifecycle commands. Require exact Super Administrator role plus permissions, CSRF, recent authentication, confirmation, reason, optimistic versions, realm-scoped revocation, and audit; forbid self-lifecycle changes and loss of the last operational Super Administrator.
- Enforce permissions on the NestJS API and add a deny-by-default RBAC matrix.

### Phases 4–7 — commerce core

- Continue catalog media/upload quarantine, promotions, supplier/batch operations, and production-scale verification; do not treat the implemented product/variant/taxonomy surfaces as the whole phase.
- The current commerce API exposes bounded published catalog and facet reads; guarded/audited product, variant, brand, and category lifecycle operations; reservation-aware inventory reads and adjustments; bounded geography/delivery-option reads; authenticated customer cart operations; authoritative checkout-policy evaluation; and a non-reserving integer-millime quote.
- `POST /api/v1/checkout/orders` is implemented for authenticated customers and COD only. One bounded `READ COMMITTED` transaction claims a customer-scoped hashed idempotency key, replays a completed identical request, validates authoritative policy/customer/catalog/pricing/delivery data, locks eligible inventory rows in stable order, subtracts active reservations, and creates immutable order/item/address/consent/fee snapshots, active reservations, initial order/delivery/COD records, a queued notification, audit evidence, and the completed idempotency result. Checkout reserves but does not decrement physical on-hand.
- The public home surface uses a responsive French/Arabic dark-neon presentation with API-derived featured products, prices, availability, flavors, and categories. Decorative device artwork is code-native; empty catalogs remain explicit and no demonstration product claims, ratings, nicotine levels, stock, or delivery promises are fabricated.
- A local-only landing-page preview may render that surface during prelaunch only in Vite development, only when explicitly enabled, and only after a configured minimum-age confirmation. It does not change the stored prelaunch, checkout, legal-review, maintenance, API, or production-build gates.
- Resolve delivery rate precedence deterministically: explicit locality rule, delegation rule, governorate rule, zone rule, then eligible store-wide base; apply documented surcharges in stable priority order. A missing or ambiguous result blocks checkout.
- Administrator confirmation locks the order, active reservations, and inventory, requires complete unexpired coverage and expected versions, decrements physical on-hand exactly once, consumes reservations, and advances order/delivery history. Customer or administrator cancellation releases only active reservations, does not increase physical stock, and cancels the COD expectation atomically.
- Delivery configuration supports inactive-by-default zones, locality-expanded governorate/delegation links, rates, pickups, and time windows with deterministic specificity, validity/ambiguity checks, activation readiness, audited lifecycle actions, and optimistic concurrency. There is no separate `DeliveryMethod` table or provider integration.

### Phases 8–11 — operations

- Implemented administrator order intake includes detail/slip, confirm, cancel/reject, prepare, ready-for-pickup, append-only contact attempts, and visibility-scoped notes. Manual delivery includes courier assignment/reassignment, controlled transitions and attempts, exact age/COD completion, and return completion without automatic restock.
- Implemented COD custody separates expected collection, physical cash recording, draft allocation/remittance, submission, verification or discrepancy creation, and reasoned discrepancy resolution/write-off. Recent authentication protects remittance and reconciliation actions; collected cash is not treated as reconciled merely because delivery succeeded.
- Continue enforcing and testing order and delivery transition matrices on the backend and preserve immutable histories.
- Make a failed age-verification result terminal for delivery until a separately authorized return/override workflow.
- Track COD expected, collected, held, remitted, discrepant, and reconciled as separate events and amounts.
- Require recent authentication and elevated permission for reconciliation, inventory corrections, role changes, compliance publication, and other dangerous actions.
- Treat administrator anonymization and customer disabling as distinct suspended-first workflows. Preserve append-only audit and historical commerce references; customer disabling is not a substitute for legally reviewed privacy erasure.
- Bound every list/export; enqueue large exports; minimize personal data and neutralize CSV formulas. Large export execution and provider-backed notification delivery remain incomplete.

### Phase 12 — hardening and release

- The durable worker now leases MySQL `OutboxEvent` rows in bounded batches and uses BullMQ only as transport. Versioned handlers expire reservations or dispatch notifications idempotently; failures use bounded retry and dead-letter states. Only a safe development console notification adapter exists.
- `/api/v1/health/live` is process-only. `/api/v1/health/ready` fails with 503 unless MySQL, Redis, the expected migration, and a fresh durable-worker heartbeat are all available.
- Backup tooling creates an authenticated AES-256-GCM logical MySQL dump plus checksum/migration/count manifest. Restore requires an explicitly confirmed empty disposable target, authenticates before mutation, and runs structural verification. Row counts are advisory for a concurrent logical backup; no production-shaped restore drill or measured RPO/RTO has been recorded.
- Run architecture, security, business-logic, accessibility, and operations reviews.
- Run the documented 500-browser/50-checkout staging workload; record the environment and actual results without extrapolation.
- Execute backup and isolated restore drills and record RPO/RTO measurements.
- Scan dependencies, source, secrets, containers, and SBOMs; resolve or accept findings through time-limited risk records.
- Preserve the recorded legal approval and obtain human security, operations, and release approval before considering any limited production release.

## Mandatory scenario ledger

The following require automated evidence: customer COD checkout and any future guest checkout; invalid and unsupported addresses; exact server delivery fee; final-unit exclusion; idempotent retry; customer-order IDOR denial; RBAC denials; valid delivery transitions; admin-without-2FA denial; archived product behavior; reservation release; refused/failed-age return flows; cash collection/remittance/reconciliation; malicious upload rejection; login throttling; CSV injection protection; and maintenance, checkout-disabled, and legal-review gates.

## Blocking external inputs

Legal approval is recorded complete by owner instruction and no additional legal-document publication is required by the runtime checkout policy. Controlled staging still cannot be treated as releasable without:

- Verified minimum purchasing age and delivery identity/age operating process.
- Verified legal store identity and real store contact information in operational settings.
- Real delivery coverage/rates and an approved pickup/courier operating process.
- Approved courier operating process or credentials.
- Production DNS/TLS, secrets, SMTP/SMS, object-storage, monitoring, and backup destinations.
- Named owners for security, incidents, cash reconciliation, privacy requests, and releases.

## Definition of done

All required root scripts pass; web, API, worker, and Docker production builds pass; migrations succeed from empty and representative existing data; secure admin creation works; authorization and customer isolation are verified; no negative stock, oversell, duplicate order, invalid transition, or unreconciled ledger mutation is possible; backup and restore are proven; the compliance gate works; and all documentation/review evidence is current.
