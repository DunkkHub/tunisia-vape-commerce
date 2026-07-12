# Tunisia Vape Commerce

Production-oriented React + NestJS modular-monolith foundation for an age-restricted Tunisian retailer. The store is cash-on-delivery only, bilingual (French/Arabic with RTL), stores money as integer millimes, and starts with checkout disabled.

> This repository is **not approved for production use**. Tunisian legal review, real infrastructure credentials, live migration/restore exercises, courier integrations, payment/COD operating procedures, security review, and measured load tests are still external launch gates. See `PRODUCTION_READINESS_REPORT.md`.

## Authentication separation

Customer and administrator authentication are intentionally different security realms:

| Realm         | Browser route  | API namespace             | Session cookie          | Policy                                                                                          |
| ------------- | -------------- | ------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| Customer      | `/login`       | `/api/v1/auth/customer/*` | `vape_customer_session` | Standard customer session; optional 2FA architecture                                            |
| Administrator | `/admin/login` | `/api/v1/auth/admin/*`    | `vape_admin_session`    | Password creates only a five-minute challenge; verified TOTP is mandatory before a full session |

The realms use separate React providers, query keys, API clients, cookies, CSRF cookies, rate-limit scopes, guards, session audiences, and idle timeouts. An admin session is never accepted by a customer guard, and a customer session is never accepted by an admin guard. No authentication token is stored in browser storage.

## Stack

- React 19, TypeScript 5.9, Vite 8, React Router 7, TanStack Query, React Hook Form, Zod, Tailwind CSS, Radix UI, i18next
- NestJS 11, Prisma 6.19, MySQL 8, Redis, BullMQ, Argon2id, opaque server-managed sessions, TOTP
- Docker Compose with MySQL, Redis, MinIO, Mailpit, API, worker, web, and Nginx
- Vitest, Testing Library, Playwright, Supertest-compatible API tooling, ESLint, Prettier

All dependency versions are pinned exactly in the package manifests and lockfile.

## Local setup

Requirements: Node.js 22.12+, Corepack, Docker Compose, and pnpm 11.11.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d mysql redis minio mailpit
pnpm prisma:generate
pnpm prisma:migrate:dev
pnpm prisma:seed
pnpm admin:create
pnpm dev
```

On a locked-down Windows installation where Corepack cannot install its global shim, run `corepack pnpm <command>`; the repository also contains `pnpm.cmd` for package subprocesses.

The structural seed creates roles, permissions, Tunisia's 24 governorates, and fail-closed settings. It creates no users, administrator, products, or default credentials. `pnpm admin:create` prompts securely and forces first-login TOTP enrollment.

Default development URLs:

- Storefront: `http://localhost:5173`
- Customer login: `http://localhost:5173/login`
- Admin login: `http://localhost:5173/admin/login`
- API: `http://localhost:3000/api/v1`
- OpenAPI: `http://localhost:3000/api/docs`

## Implemented catalog and administration reads

The public catalog can combine text/category, brand, product type, flavor, and inclusive minimum/maximum effective-price filters. Prices cross the API boundary as integer millimes; the storefront converts user-entered TND values before requesting the API. `GET /api/v1/catalog/facets` returns bounded public brand, product-type, flavor-count, and effective-price-range values after the age gate.

The administration UI now has read-only API support for dashboard, products, inventory, orders, customers, deliveries, cash reconciliations, settings, and audit pages. These routes require a full TOTP-verified administrator session plus the exact seeded permission for the resource. List responses are no-store, deterministically ordered, and capped at 50 records per page. Setting secrets are redacted and audit responses use a privacy-minimized allowlist.

Inventory rows represent product variants. Their displayed remaining quantity is calculated at an `asOf` time as eligible physical on-hand minus active, unexpired reservations. Archived or expired batches are excluded. The response also provides full-filter totals by brand, product type, flavor, and brand-plus-flavor; these totals cover the complete filtered result, not only the current page. This is an operational read projection, not an authoritative checkout reservation: checkout must still recalculate stock under database locks.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:security
pnpm test:load
```

Prisma validation needs a syntactically valid `DATABASE_URL`; it does not require a live database unless a migration or integration test is executed.

The latest recorded local application test run on 2026-07-12 reported 58 passing API tests and 11 passing web tests, for 69 total. The four Playwright route-separation checks are recorded separately. These local results do not establish production readiness.

## Safety and compliance defaults

- `CHECKOUT_ENABLED=false`, `LEGAL_REVIEW_COMPLETED=false`, and `PRELAUNCH_MODE=true`
- Mandatory store-entry and checkout age confirmation architecture
- Required legal-document and delivery-method gates before checkout
- TND values stored as integer millimes; delivery fees and prices are server-authoritative
- No identity-document photographs stored by default
- No default administrator and no hardcoded password
- Opaque session tokens are hashed at rest; TOTP secrets and notification recipients are encrypted
- Immutable order snapshots, audited inventory movements, delivery histories, and COD reconciliation records

Start with `docs/IMPLEMENTATION_PLAN.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, and `docs/LEGAL_AND_COMPLIANCE_CHECKLIST.md`.
