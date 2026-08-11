# Local and Docker setup

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

This guide covers development and buyer evaluation. Neither path is production-readiness evidence. Use Node.js 22.22 or newer and the repository-declared pnpm 11.11.0 through Corepack.

## Common preparation

```powershell
corepack enable
corepack pnpm --version
corepack pnpm install --frozen-lockfile
Copy-Item .env.example .env
corepack pnpm prisma:generate
```

The pnpm version must print `11.11.0`. If Windows cannot create the global Corepack shim, keep using `corepack pnpm` explicitly.

Never reuse the `.env.example` passwords, cookie secrets, field-encryption key, or local service exposure outside development. Do not commit `.env` or secret files.

## Option A: Docker dependencies, host applications

Start the dependencies only:

```powershell
docker compose up -d mysql redis minio mailpit
docker compose ps
```

The `.env.example` URLs contain Docker service names. Compose publishes MySQL on loopback port
`13306` by default so it does not collide with a common XAMPP listener on `3306`. Host processes
must use loopback addresses in the current PowerShell session:

```powershell
$env:DATABASE_MIGRATION_URL = 'mysql://migration_user:change_me@127.0.0.1:13306/vape_store'
corepack pnpm db:doctor -- --url-env DATABASE_MIGRATION_URL --role migration --expect-user migration_user
$env:DATABASE_URL = $env:DATABASE_MIGRATION_URL
$env:REDIS_URL = 'redis://127.0.0.1:6379'
$env:MEDIA_STORAGE_DRIVER = 's3'
$env:S3_ENDPOINT = 'http://127.0.0.1:9000'
$env:SMTP_HOST = '127.0.0.1'
corepack pnpm prisma:migrate:dev

$env:DATABASE_URL = 'mysql://app_user:change_me@127.0.0.1:13306/vape_store'
corepack pnpm db:doctor -- --expect-user app_user
corepack pnpm prisma:seed
corepack pnpm admin:create
corepack pnpm dev
```

Run `admin:create` interactively once. It creates no default password, refuses when an administrator already exists, and requires TOTP enrollment at first login.

Google customer login is optional and remains hidden with `GOOGLE_OAUTH_ENABLED=false`. For a local provider test, create a Google Web application client, register the exact callback for the origin you actually open (for example `http://localhost:8080/api/v1/auth/customer/google/callback` for full Compose), and set all four values before starting the API:

```powershell
$env:GOOGLE_OAUTH_ENABLED = 'true'
$env:GOOGLE_CLIENT_ID = '<local-web-client>.apps.googleusercontent.com'
$env:GOOGLE_CLIENT_SECRET = '<local-secret>'
$env:GOOGLE_CALLBACK_URL = 'http://localhost:8080/api/v1/auth/customer/google/callback'
```

`GOOGLE_CALLBACK_URL` must share the exact `WEB_URL` origin. Never register `/admin`, expose the secret through `VITE_*`, or commit a populated value. Leaving the feature disabled requires no Google credential and does not affect password login.

## Option B: Windows without Docker

Install and start:

- MySQL 8.4 with InnoDB, `utf8mb4`, and UTC;
- a Redis-compatible service reachable by `redis://` or `rediss://`; and
- Node.js/Corepack as above.

The supported database target is MySQL 8.4. XAMPP normally ships MariaDB; it can be useful for informal development but is not equivalent to the supported engine and cannot provide release migration, locking, query-plan, backup, or restore evidence. If XAMPP, WSL MySQL, and Docker MySQL coexist, follow [Windows MySQL and phpMyAdmin troubleshooting](WINDOWS_MYSQL_PHPMYADMIN.md) before changing a password, port, authentication plugin, or phpMyAdmin control user.

From an elevated MySQL session, create a disposable local database and separate identities. Replace the example passwords before executing:

```sql
CREATE DATABASE vape_store
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'migration_user'@'localhost' IDENTIFIED BY 'replace_migration_password';
CREATE USER 'app_user'@'localhost' IDENTIFIED BY 'replace_app_password';
GRANT ALL PRIVILEGES ON vape_store.* TO 'migration_user'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON vape_store.* TO 'app_user'@'localhost';
FLUSH PRIVILEGES;
```

Configure and initialize from PowerShell:

```powershell
$env:DATABASE_MIGRATION_URL = 'mysql://migration_user:replace_migration_password@localhost:3306/vape_store'
$env:DATABASE_URL = $env:DATABASE_MIGRATION_URL
$env:REDIS_URL = 'redis://localhost:6379'
$env:MEDIA_STORAGE_DRIVER = 'local'
$env:MEDIA_LOCAL_ROOT = 'uploads/media'
corepack pnpm prisma:migrate:dev

$env:DATABASE_URL = 'mysql://app_user:replace_app_password@localhost:3306/vape_store'
corepack pnpm prisma:seed
corepack pnpm admin:create
corepack pnpm dev
```

Local media storage requires no external service and writes only beneath `MEDIA_LOCAL_ROOT`, which is Git-ignored. Docker development uses the same secure media abstraction with MinIO. Uploaded JPEG, PNG and WebP files are decoded and signature/size/dimension checked by the API; the browser never receives storage credentials. Mailpit captures development SMTP messages, while production SMTP and SMS webhook providers remain deployment configuration.

## Option C: full development Compose stack

Keep the container-host URLs from `.env.example`, then run:

```powershell
docker compose config
docker compose up -d --build
docker compose ps
docker compose run --rm migrate pnpm prisma:seed
docker compose run --rm migrate pnpm admin:create
```

The gateway is at `http://localhost:8080`. MySQL, Redis, MinIO, and Mailpit are bound to loopback only in the development file. The seed and first-administrator commands are intentionally separate from unattended startup.

The container-to-container database URL remains `mysql:3306`; Windows database clients and Prisma
commands running on the host use `127.0.0.1:13306`. Run `pnpm db:doctor` with the corresponding host
URL before applying migrations.

## Migration state

The latest expected migration is `20260811170000_product_image_renditions`. It records immutable versioned rendition checksums, sizes, and dimensions; existing image bytes are not rewritten and legacy approved images are backfilled on a bounded verified first read. The preceding migrations link collection-level COD discrepancies to exact collections and add optional manual-courier operations without changing customer delivery prices. The earlier identity migration adds customer-only provider binding without creating users, credentials, or an administrator or weakening administrator password-plus-TOTP authentication.

For controlled staging or production, set `DATABASE_URL` to the least-privilege runtime identity and apply migrations only with the migration identity:

```powershell
$env:DATABASE_URL = $env:DATABASE_MIGRATION_URL
corepack pnpm prisma:migrate:deploy
```

Never run `prisma migrate dev`, `prisma db push`, or reset commands against staging or production.

## Optional reviewed Wotofo catalog

After migrations, seed, backup, and creation of a named administrator with `catalog.import`, the reviewed catalog can be previewed without mutation:

```powershell
corepack pnpm catalog:import:wotofo -- --actor-email <authorized-admin@example.tld> --import-key wotofo-2026-07-20-catalog-v1 --json
```

Apply only after reviewing the persisted receipt, then import media and verify the stored result:

```powershell
corepack pnpm catalog:import:wotofo -- --actor-email <authorized-admin@example.tld> --import-key wotofo-2026-07-20-catalog-v1 --apply --json
corepack pnpm catalog:media:wotofo -- --batch-id <applied-batch-id> --actor-email <authorized-admin@example.tld> --json
corepack pnpm catalog:verify:wotofo -- --output outputs/catalog/wotofo-verification.json
```

The recorded local run produced 19 draft products, 321 variants, and 145 stored images. A fresh seed still has none. Prices, supplier costs, inventory, and publication are not inferred; follow [Catalog import and media operations](CATALOG_IMPORT_AND_MEDIA.md) before using these commands.

## Verify the running system

```powershell
Invoke-WebRequest http://localhost:3000/api/v1/health/live
Invoke-WebRequest http://localhost:3000/api/v1/health/ready
```

Liveness proves only that the API process responds. Readiness also requires MySQL, Redis, the expected migration, and a fresh worker heartbeat. A fresh seed still reports checkout blockers until [store information and delivery](STORE_CONFIGURATION.md) are configured.

For full release verification, use isolated test infrastructure and run `corepack pnpm verify:release`. The non-mocked browser path additionally requires `TEST_E2E_REDIS_URL` to select disposable Redis database 14 and runs with `corepack pnpm test:e2e:operational`; it creates and removes its own generated MySQL database and test-only commerce fixture. See [Release verification](RELEASE_VERIFICATION.md) and [Deployment](DEPLOYMENT.md).
