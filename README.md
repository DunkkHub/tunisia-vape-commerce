# Tunisia Vape Commerce

Production-oriented React, NestJS, BullMQ, MySQL, and Redis commerce software for an age-restricted Tunisian cash-on-delivery retailer. The storefront and administration UI are bilingual (French/Arabic with RTL), money is stored as integer TND millimes, and customer and administrator authentication are separate security realms.

The current engineering verdict is **NOT READY**. See [PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md) for verified evidence and remaining technical and operational blockers.

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

## Authentication separation

| Realm         | Browser route  | API namespace             | Session cookie          | Policy                                                                                           |
| ------------- | -------------- | ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| Customer      | `/login`       | `/api/v1/auth/customer/*` | `vape_customer_session` | Customer-only session                                                                            |
| Administrator | `/admin/login` | `/api/v1/auth/admin/*`    | `vape_admin_session`    | Password creates a five-minute challenge; verified TOTP is mandatory before a full admin session |

The realms use separate providers, API clients, cookies, CSRF contexts, rate-limit scopes, guards, Redis prefixes, timeouts, and revocation flows. Neither realm accepts the other's credential. Authentication tokens are never stored in browser storage.

## Stack

- React 19, TypeScript 5.9, Vite 8, React Router 8, TanStack Query, React Hook Form, Zod, Tailwind CSS, Radix UI, and i18next
- NestJS 11, Prisma 6.19, MySQL 8.4, Redis, BullMQ, Argon2id, opaque server-managed sessions, and TOTP
- Docker Compose with MySQL, Redis, MinIO, Mailpit, API, worker, web, and Nginx
- Vitest, Testing Library, Playwright, Supertest-compatible API tooling, ESLint, and Prettier

Exact dependency versions are recorded in the package manifests and `pnpm-lock.yaml`.

## Start locally

Requirements: Node.js 22.22+, Corepack, and pnpm 11.11.0. The supported dependency path uses Docker Compose:

```bash
corepack enable
corepack pnpm install --frozen-lockfile
copy .env.example .env
docker compose up -d mysql redis minio mailpit
corepack pnpm prisma:generate
corepack pnpm prisma:migrate:dev
corepack pnpm prisma:seed
corepack pnpm admin:create
corepack pnpm dev
```

Use `cp .env.example .env` on macOS/Linux. On Windows, `corepack pnpm <command>` avoids requiring a global pnpm shim. Detailed Docker, Dockerless Windows, migration, and start procedures are in [Local setup](docs/LOCAL_SETUP.md). Machines running XAMPP or WSL MySQL should also follow [Windows MySQL and phpMyAdmin troubleshooting](docs/WINDOWS_MYSQL_PHPMYADMIN.md); the repository's Docker MySQL uses host port `13306` to avoid the usual XAMPP `3306` listener.

For production-shaped deployment, use `.env.production.example` as the variable contract, replace every placeholder through the operator's secret manager, and keep populated environment and secret files outside Git. See the [Deployment guide](docs/DEPLOYMENT.md).

The structural seed creates roles, permissions, Tunisia's 24 governorates, and settings. It creates no user, administrator, customer, product, stock, delivery method, or provider credential. `pnpm admin:create` is the only first-administrator bootstrap and forces TOTP enrollment.

Default development URLs:

- Storefront: `http://localhost:5173`
- Customer login: `http://localhost:5173/login`
- Administrator login: `http://localhost:5173/admin/login`
- API: `http://localhost:3000/api/v1`
- OpenAPI: `http://localhost:3000/api/docs`
- Docker gateway: `http://localhost:8080`

## Checkout configuration

The fresh configuration has `CHECKOUT_ENABLED=true`, `checkout.enabled=true`, `PRELAUNCH_MODE=false`, and `prelaunch.mode=false`. That does not make a fresh install sellable: the seed intentionally leaves store identity/contact values empty and creates no delivery method, so the API reports `STORE_INFORMATION_MISSING` and `DELIVERY_METHOD_MISSING` until an operator configures them.

Legal approval and legal-document publication are not executable checkout prerequisites. The API continues to fail closed for operational conditions, request validation, authorization, server-authoritative pricing, delivery resolution, stock, idempotency, and database/service failures.

The configurable age, consent, and delivery controls are:

- `age_gate.entry.enabled`
- `age_gate.checkout.enabled`
- `consent.terms.required`
- `consent.privacy.required`
- `consent.recording.enabled`
- `delivery.age_verification_required`

All six default to `true` in a fresh structural seed and can be changed only through the typed, permission-protected, recent-authenticated, audited settings API. See [Store configuration](docs/STORE_CONFIGURATION.md).

## Catalog and administration

The public catalog supports combined search, category, brand, product type, flavor, puff-count, nicotine-strength, featured, price-range, and allowlisted sort filters. Prices cross the API boundary as integer millimes. Public facets are bounded and follow the same publication and restriction policy as product reads.

The guarded catalog-import workflow supports versioned CSV/JSON previews, explicit field overrides, allowlisted operator-media acquisition, and a reviewed official Wotofo path. Generic URLs are disabled by default, remain unverified, and require manual review even after transport and raster validation. The recorded local Wotofo run created 19 draft products, 321 deterministic variants, and 145 approved stored images without inventing prices, costs, suppliers, or stock. Real price and inventory entry plus the normal media/delivery/publication checks remain mandatory. See [Catalog import and media operations](docs/CATALOG_IMPORT_AND_MEDIA.md).

Administrator surfaces include writable product/variant and taxonomy operations, secure product media, batch inventory receipt and dual-controlled adjustments, transfers and movement history, orders, manual courier/manifests/status CSV operations, COD reconciliation and discrepancy resolution, customer lifecycle actions, settings transfer, access control, and audit/security reads. Capabilities that still lack complete production evidence are listed in the readiness report; documentation does not imply that an unfinished external provider is configured.

## Verification

For a complete release gate, provide isolated test MySQL/Redis URLs and run:

```bash
corepack pnpm verify:release
```

The gate performs frozen installation, Prisma generation and validation, formatting, linting, type checking, unit/integration/security/operations tests, production builds, dependency audit, fast Playwright regressions, and a disposable non-mocked MySQL/Redis/Chromium commerce/TOTP/RBAC path. CI additionally owns container builds/scans, CodeQL, secret scanning, Trivy, and SBOM evidence. See [Release verification](docs/RELEASE_VERIFICATION.md).

## Buyer and operator documentation

- [Buyer handoff](docs/BUYER_HANDOFF.md)
- [Local and Docker setup](docs/LOCAL_SETUP.md)
- [Windows MySQL and phpMyAdmin troubleshooting](docs/WINDOWS_MYSQL_PHPMYADMIN.md)
- [Catalog import and media operations](docs/CATALOG_IMPORT_AND_MEDIA.md)
- [Store configuration](docs/STORE_CONFIGURATION.md)
- [Checkout and order lifecycle](docs/CHECKOUT_AND_ORDER_LIFECYCLE.md)
- [Inventory operations](docs/INVENTORY_OPERATIONS.md)
- [Notifications](docs/NOTIFICATIONS.md)
- [Administrator guide](docs/ADMIN_GUIDE.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Backup and recovery](docs/BACKUP_AND_RECOVERY.md)
- [Production checklist](docs/PRODUCTION_CHECKLIST.md)

The optional [Legal and compliance checklist](docs/LEGAL_AND_COMPLIANCE_CHECKLIST.md) is an operator-owned reference and is not an executable software-readiness gate.
