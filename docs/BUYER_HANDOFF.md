# Buyer handoff

The repository is delivered with an engineering verdict of **NOT READY** until the evidence and blockers in [PRODUCTION_READINESS_REPORT.md](../PRODUCTION_READINESS_REPORT.md) are resolved. A build or local demo is not a production acceptance result.

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

## 1. Verify the delivery

- Obtain the source revision, lockfile, image digests if supplied, SBOM, scan results, and CI run links.
- Confirm no `.env`, secret file, real customer data, default administrator, or provider credential is included.
- Review [Architecture](ARCHITECTURE.md), [Security](SECURITY.md), [Threat model](THREAT_MODEL.md), [Database](DATABASE.md), and [API](API.md).
- Record every accepted limitation with an owner, due date, compensating control, and evidence location. Do not silently convert an unfinished item to “not applicable.”

## 2. Prepare an evaluation environment

Follow [Local and Docker setup](LOCAL_SETUP.md). Supported paths are Docker dependencies with host applications, full development Compose, or Dockerless Windows with MySQL 8.4 and Redis-compatible services.

Use `.env.example` for local development. For a production-shaped environment, copy the variable names from `.env.production.example`, replace every `REPLACE_*` placeholder through the operator's secret manager, and keep the referenced secret files outside source control.

The minimum initialization sequence is:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm prisma:generate
$env:DATABASE_URL = $env:DATABASE_MIGRATION_URL
corepack pnpm prisma:migrate:deploy
$env:DATABASE_URL = '<least-privilege-runtime-url>'
corepack pnpm prisma:seed
corepack pnpm admin:create
```

The latest expected migration is `20260804090000_customer_google_identity`. It adds the customer-only Google identity binding and permits provider-only customers to omit a local password; administrator credentials remain password-plus-TOTP only. Prove clean installation and a representative upgrade containing existing customers, orders, inventory, deliveries, cash records, catalog/media, and an import receipt. The seed creates structure only and preserves existing setting values on rerun.

## 3. Configure the store

Follow [Store configuration](STORE_CONFIGURATION.md):

- replace all placeholder secrets and credentials;
- set store name, phone, email, and address;
- create real products/variants without demonstration production data, or explicitly run and review the optional catalog importer;
- create an inventory location and audited stock buckets;
- configure at least one active pickup or a supported zone with valid, unambiguous rates;
- review the six age/consent/delivery controls and minimum age; and
- confirm `GET /api/v1/checkout/policy` returns the intended requirements and no blockers.

Legal approval and legal-document publication are not checkout or software-readiness inputs. The optional [purchaser/operator checklist](LEGAL_AND_COMPLIANCE_CHECKLIST.md) is separate from this handoff.

If the reviewed Wotofo workflow is in scope, follow [Catalog import and media operations](CATALOG_IMPORT_AND_MEDIA.md). Its recorded local evidence is 19 draft products, 321 variants, and 145 stored approved images. The importer deliberately supplies no real selling prices, supplier costs, inventory, or publication approval. Enter and verify those values through the normal catalog and inventory workflows, rerun the verifier, and publish only after every product passes media, price, stock, and delivery readiness. Back up both MySQL and object storage before apply; catalog rollback is limited to unchanged create-only batches and is not a backup substitute.

## 4. Establish named administration

- Use `pnpm admin:create` exactly once from a trusted one-off environment.
- Complete TOTP enrollment and store recovery codes outside the application.
- Create named least-privilege administrators; do not share the bootstrap account.
- Verify customer credentials fail at `/admin/login` and admin credentials fail at `/login`.
- Exercise suspension, session revocation, recent authentication, permission denial, and the last-super-administrator protections.

Follow [Administrator guide](ADMIN_GUIDE.md).

## 5. Rehearse commerce operations

- Run the complete customer flow in [Checkout and order lifecycle](CHECKOUT_AND_ORDER_LIFECYCLE.md).
- Reconcile physical, reserved, and available stock using [Inventory operations](INVENTORY_OPERATIONS.md).
- Exercise delivery failure, failed age verification when configured, return-to-sender, and no-automatic-restock behavior with [Delivery operations](DELIVERY_OPERATIONS.md).
- Rehearse expected, collected, remitted, discrepant, and reconciled cash separately with [COD reconciliation](COD_RECONCILIATION.md).
- Review [Notifications](NOTIFICATIONS.md). Configure production TLS SMTP. If SMS is enabled,
  configure the authenticated HTTPS SMS adapter as well. Retain delivery, retry, idempotency, and
  dead-letter evidence for every enabled provider before accepting the boundary.

## 6. Run release verification

Provide disposable integration-test MySQL/Redis endpoints, then run:

```powershell
corepack pnpm verify:release
```

This covers frozen install, Prisma generation/validation, formatting, linting, type checking, unit, integration, security and operations tests, production builds, dependency audit, and Playwright. CI must additionally supply container builds and scans, CodeQL, secret scanning, Trivy, and SBOM evidence. See [Release verification](RELEASE_VERIFICATION.md).

Do not use `pnpm audit --fix --force` or broad dependency upgrades. Resolve each advisory with the smallest compatible update and record it separately.

## 7. Prove recovery and operations

- Run an encrypted backup and isolated restore on target MySQL; measure and accept RPO/RTO.
- Prove the runtime database identity cannot create or alter schema.
- Test worker outage/recovery, dead letters, provider failure, graceful shutdown, and dependency loss.
- Configure logs, metrics, traces, dashboards, alerts, incident contacts, secret rotation, DNS/TLS, and provider credentials.
- Run representative browse/checkout load and final-unit/idempotency concurrency on production-shaped infrastructure.

Use [Backup and recovery](BACKUP_AND_RECOVERY.md), [Incident response](INCIDENT_RESPONSE.md), and [Deployment](DEPLOYMENT.md).

## 8. Production acceptance

Complete [Production checklist](PRODUCTION_CHECKLIST.md) with linked environment-specific evidence. The accepting owner should sign only the engineering, security, availability, recovery, data-integrity, and operational evidence actually observed.

Do not change the readiness verdict until every listed technical/operational blocker has evidence. Keep purchaser/operator legal records outside that verdict and outside executable checkout policy.
