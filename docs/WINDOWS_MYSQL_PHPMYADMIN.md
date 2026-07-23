# Windows MySQL, XAMPP, and phpMyAdmin troubleshooting

This guide repairs local connection errors without deleting databases, changing authentication
plugins blindly, or placing credentials in Git. The supported application database is MySQL 8.4.
XAMPP's MariaDB can remain available for unrelated legacy applications, but it is not a release
test target for this repository.

## First identify the server behind each port

A Windows development machine can have three independent database servers at the same time:

| Server                          | Typical listener                              | Intended use                                      |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------- |
| XAMPP MariaDB on Windows        | `127.0.0.1:3306`                              | Legacy/local PHP applications                     |
| Native MySQL inside WSL         | WSL `127.0.0.1:3306`; `33060` is the X plugin | Separate WSL administration or disposable testing |
| Repository MySQL 8.4 in Compose | Windows `127.0.0.1:13306` to container `3306` | This commerce application                         |

Do not infer the server from the port number alone. In particular, port `33060` is normally the
MySQL X protocol, not the classic protocol Prisma and phpMyAdmin use.

Read-only Windows diagnostics:

```powershell
Get-Service | Where-Object {
  $_.Name -match 'mysql|maria' -or $_.DisplayName -match 'mysql|maria'
}
Get-Process | Where-Object { $_.ProcessName -match 'mysql|maria|xampp|wsl' }
Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in 3306, 33060, 13306 }
wsl --list --verbose
wsl -d Ubuntu -u root -- docker ps
```

The development Compose file binds MySQL to loopback only. `.env.example` selects host port
`13306` to avoid XAMPP's common `3306` listener while the container-to-container URL remains
`mysql:3306`.

## Run the repository database doctor

`db:doctor` performs only reads: URL parsing/redaction, DNS resolution, a TCP connection, account
authentication, database selection, a Prisma `SELECT`, MySQL version policy, current identity and
privilege inspection, and comparison of `_prisma_migrations` with `prisma/migrations`.

Never put a populated URL directly on the command line. Use an untracked `.env` or a process
environment variable so the password does not enter shell history or process listings.

For host applications using the Compose MySQL port:

```powershell
$env:DATABASE_URL = 'mysql://app_user:REPLACE_WITH_URL_ENCODED_PASSWORD@127.0.0.1:13306/vape_store'
corepack pnpm db:doctor -- --expect-user app_user

$env:DATABASE_MIGRATION_URL = 'mysql://migration_user:REPLACE_WITH_URL_ENCODED_PASSWORD@127.0.0.1:13306/vape_store'
corepack pnpm db:doctor -- --url-env DATABASE_MIGRATION_URL --role migration --expect-user migration_user
```

Use `corepack pnpm db:doctor -- --help` for all flags. `--json` emits a machine-readable report.
The command exits nonzero for DNS, TCP, authentication, wrong database, unsupported MariaDB,
MySQL older than 8.4, unsafe runtime DDL privileges, missing required privileges, or migration
drift. It never prints a password or authentication hash.

## Configure phpMyAdmin for the Compose database

XAMPP's phpMyAdmin configuration is normally outside this repository at:

```text
C:\xampp\phpMyAdmin\config.inc.php
```

Back up that file before editing it. Do not copy it into the repository. Preserve unrelated server
entries, replace a short/default `blowfish_secret` with a locally generated value of at least 32
random bytes, and add this as a separate server entry:

```php
$i++;
$cfg['Servers'][$i]['verbose'] = 'Tunisia Vape - Docker MySQL 8.4';
$cfg['Servers'][$i]['host'] = '127.0.0.1';
$cfg['Servers'][$i]['port'] = '13306';
$cfg['Servers'][$i]['connect_type'] = 'tcp';
$cfg['Servers'][$i]['auth_type'] = 'cookie';
$cfg['Servers'][$i]['AllowNoPassword'] = false;
```

For this Docker entry, do **not** add any of the following:

```php
// Do not add these for the Docker server:
// $cfg['Servers'][$i]['user'] = ...;
// $cfg['Servers'][$i]['password'] = ...;
// $cfg['Servers'][$i]['controluser'] = 'pma';
// $cfg['Servers'][$i]['controlpass'] = ...;
```

Cookie authentication prompts locally at login time; it does not hard-code a root or application
password in `config.inc.php`. Use the dedicated `app_user` for normal data inspection and routine
application operations. Its intended grants are only `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on
`vape_store.*`. Do not use the MySQL root account for the application. Use the migration identity
only for reviewed Prisma migration operations, not routine browsing.

phpMyAdmin's optional `pma` control account provides advanced configuration-storage features; it is
not needed to manage the application database. If that account does not exist on the selected
server, omitting `controluser` and `controlpass` is the correct configuration. A `pma` account on
XAMPP MariaDB is unrelated to Docker MySQL and cannot authenticate there automatically.

Generate a local blowfish secret without copying the result into Git:

```powershell
C:\xampp\php\php.exe -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
```

Insert the generated value only into the external `config.inc.php`:

```php
$cfg['blowfish_secret'] = 'PASTE_THE_LOCAL_RANDOM_VALUE_HERE';
```

Then open `http://127.0.0.1/phpmyadmin/`, select the Docker MySQL server, and authenticate with the
dedicated account. A successful phpMyAdmin page alone is not proof that the correct server was
selected; verify the server version is MySQL 8.4 and the database is `vape_store`, then run
`pnpm db:doctor` against the same host and port.

## Error-specific repair

### `HY000/1045` or “Access denied”

This means the server rejected the account, host restriction, password, or authentication method.
It does not mean the database should be reinstalled.

1. Confirm whether phpMyAdmin is targeting `3306` (usually XAMPP) or `13306` (Compose).
2. Confirm the username exists on that exact server and is allowed from the connecting host.
3. URL-encode reserved characters in `DATABASE_URL` passwords.
4. Remove hard-coded `user` and `password` from the Docker phpMyAdmin entry and use cookie auth.
5. Do not use XAMPP's empty/root configuration against Docker MySQL; Docker root is a different
   account and must not be used by the application.
6. Run `db:doctor`; its output is redacted and separates TCP failure from authentication failure.

Do not reset the root password until existing XAMPP PHP applications and scheduled jobs have been
audited for dependencies. A password reset can break unrelated legacy sites.

### `HY000/1698` for `root@localhost`

On Ubuntu/WSL, this normally means root uses the `auth_socket` plugin and is intentionally available
only to the matching operating-system administrator. Use an elevated local socket session for
database administration:

```bash
sudo mysql
```

Do not change root from `auth_socket` merely to make phpMyAdmin accept it. Create or use a dedicated
password-authenticated application identity with least privilege, and point Prisma/phpMyAdmin to
that identity instead.

### “phpMyAdmin control-user connection failed”

The selected server either lacks the configured `pma` account or its stored credential does not
match. Remove `controluser` and `controlpass` from that server entry unless a control account and its
phpMyAdmin configuration tables were deliberately provisioned on the same server. Do not create a
privileged `pma` account merely to silence the warning.

## Dedicated standalone MySQL identities

Compose provisions `app_user` and `migration_user` automatically on a fresh MySQL volume. For a
separate MySQL 8.4 development server, use an elevated administrative session once and replace the
password placeholders before executing:

```sql
CREATE DATABASE IF NOT EXISTS vape_store
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'app_user'@'localhost'
  IDENTIFIED BY 'REPLACE_WITH_A_STRONG_APP_PASSWORD';
CREATE USER IF NOT EXISTS 'migration_user'@'localhost'
  IDENTIFIED BY 'REPLACE_WITH_A_DIFFERENT_STRONG_MIGRATION_PASSWORD';

GRANT SELECT, INSERT, UPDATE, DELETE
  ON vape_store.* TO 'app_user'@'localhost';
GRANT ALL PRIVILEGES
  ON vape_store.* TO 'migration_user'@'localhost';
```

Do not put the real values in `.env.example`, documentation, `config.inc.php` committed to another
project, issue text, or terminal screenshots.

## XAMPP MariaDB data-safety warning

MariaDB 10.4 is not interchangeable with the supported MySQL 8.4 release target. Never run release
migrations, concurrency evidence, production-shaped imports, backup certification, or restore
certification against XAMPP MariaDB.

If `C:\xampp\mysql\data\mysql_error.log` contains InnoDB assertions, “log sequence number is in the
future,” crash recovery, `ibdata1` write failures, or unsupported-InnoDB errors:

1. stop making application or schema changes to that server;
2. do not delete `ibdata1`, redo logs, database directories, or the XAMPP installation;
3. take a logical backup while the server is readable;
4. restore and verify that backup on an isolated compatible server;
5. retain the original data directory until recovery is independently verified; and
6. keep the commerce application on its MySQL 8.4 Compose database.

A successful server restart or one successful table check does not erase historical corruption
evidence. Treat the data as unverified until a full backup/restore validation succeeds.

## Safe verification sequence

```powershell
docker compose ps mysql redis

$env:DATABASE_MIGRATION_URL = 'mysql://migration_user:REPLACE_WITH_URL_ENCODED_PASSWORD@127.0.0.1:13306/vape_store'
corepack pnpm db:doctor -- --url-env DATABASE_MIGRATION_URL --role migration --expect-user migration_user
$env:DATABASE_URL = $env:DATABASE_MIGRATION_URL
corepack pnpm prisma:migrate:deploy

$env:DATABASE_URL = 'mysql://app_user:REPLACE_WITH_URL_ENCODED_PASSWORD@127.0.0.1:13306/vape_store'
corepack pnpm db:doctor -- --expect-user app_user
corepack pnpm prisma:seed
Invoke-RestMethod http://127.0.0.1:8080/api/v1/health/ready
```

Never use `prisma db push`, an automatic reset, a database-directory deletion, or a MySQL
reinstallation as an authentication repair.
