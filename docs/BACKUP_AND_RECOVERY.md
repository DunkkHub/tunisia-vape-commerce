# Backup and recovery

## Policy

A backup is valid only after an isolated restoration verifies data and business invariants. MySQL is the transactional authority. Redis persistence helps recovery but is not a substitute for MySQL backups; loss of Redis should fail safely by signing users out and replaying only jobs backed by durable application records. Object storage requires versioning and separate recovery protection.

Provisional objectives, pending business approval and measured drills:

- RPO: 15 minutes for MySQL through binary-log point-in-time recovery; 24 hours for rebuildable media derivatives; near-zero for versioned originals according to provider replication.
- RTO: 4 hours for the core store in controlled staging/production.

Do not represent these as achieved until a timed restore exercise proves them on the chosen production services.

## Backup sets

### MySQL

- Daily encrypted full physical backup where the provider/tool supports it.
- Continuous encrypted binary-log capture for point-in-time recovery.
- Daily logical schema/data export as an additional portable recovery path.
- Backup before every risky migration and major data repair.
- Include schema/migration table, events/history, audit/security, consent, inventory, orders, delivery, COD, and configuration.
- Use a dedicated read/backup identity; do not reuse the application identity.

### Object storage

- Enable versioning, encryption, object lock/immutability where available, and cross-account or cross-region replication.
- Protect original uploads, approved derivatives, evidence references allowed by retention policy, and export artifacts during their short retention.
- Lifecycle incomplete multipart uploads and expired noncurrent versions only after legal/operations approval.
- Record bucket policy and lifecycle configuration as versioned infrastructure.

### Redis

- Enable provider-appropriate AOF and periodic snapshots for queue/session recovery requirements.
- Back up configuration and queue metadata, but design handlers from MySQL outbox/job records so lost or replayed Redis work is safe.
- Never restore session keys into a different environment or after a credential-compromise incident.

### Configuration and keys

- Back up reviewed infrastructure definitions, migration artifacts, provider configuration, alert rules, and recovery documentation.
- Encryption keys are held in managed key custody with documented escrow/recovery and separation from ciphertext backups.
- Do not put plaintext .env files or secrets into the backup archive.

## Encryption, isolation, and retention

- Encrypt in transit and at rest with managed keys distinct from runtime data keys.
- Backup writers can append but cannot delete retention-protected copies. Runtime service credentials cannot read the backup repository.
- Require MFA and audited break-glass approval for restore/delete.
- Maintain at least one logically isolated copy and regularly test that primary-environment compromise cannot erase it.
- Suggested starting retention: 35 daily, 13 monthly, and legally approved annual records. Tunisian tax, consumer, employment/courier, privacy, and consent requirements must determine the final schedule.
- Maintain a manifest containing environment, UTC range, tool/version, MySQL version, schema migration, file/object sizes, checksums, encryption key version, binlog coordinates, and backup job result.

## Logical backup command

The Node-based command is cross-platform; it requires MySQL 8-compatible `mysql` and `mysqldump`
clients on `PATH` (or explicit `MYSQL_BIN`/`MYSQLDUMP_BIN` paths). Use a dedicated read-capable
backup URL, a 32-byte base64 key, an external key identifier, an environment label, and an approved
retention value:

    DATABASE_BACKUP_URL=mysql://backup_user:...@mysql:3306/vape_store
    BACKUP_ENCRYPTION_KEY_BASE64=<32 random bytes, base64>
    BACKUP_ENCRYPTION_KEY_ID=<managed-key-version>
    BACKUP_ENVIRONMENT=<environment-name>
    BACKUP_DIRECTORY=<dedicated-backup-directory>
    BACKUP_RETENTION_DAYS=35
    BACKUP_ENCRYPTION_MODE=aes-256-gcm
    MYSQL_TLS_MODE=VERIFY_IDENTITY
    MYSQL_TLS_CA_FILE=<absolute-CA-path-if-not-in-system-trust>
    pnpm backup:mysql

The command uses a consistent logical transaction and includes routines, scheduled events, triggers,
all commerce/audit/outbox tables, and `_prisma_migrations`. Version 2 streams SQL through gzip and
then AES-256-GCM, writes through a mode-restricted `.partial` file, deletes incomplete output on
failure, flushes each file, renames the timestamped `.sql.gz.enc` artifact, and publishes its
restricted JSON manifest last as the commit marker. A file without its matching final manifest is
incomplete and must not be selected for restore. The manifest records the artifact SHA-256 and size,
compressed/plaintext sizes, database/dump tool versions, every applied migration name/checksum,
advisory table counts, environment, compression, and encryption key ID. For encrypted format 2, an
HMAC key derived from the backup encryption key authenticates the complete canonical manifest, so
its time, environment, migration and checksum evidence cannot be rewritten independently. Passwords
are passed to MySQL tools through their environment rather than process arguments; a managed
provider or protected option file is still preferred in production.
MySQL subprocesses receive an allowlisted operating-system environment plus `MYSQL_PWD`, not the
application/provider/key environment. Non-local runs fail unless TLS identity verification is
explicitly enabled; local development may use `PREFERRED`.
Restore remains backward-compatible with repository format-1 `.sql.enc` artifacts. New backups use
format 2; format 1 has no authenticated manifest and therefore requires the explicit
`RESTORE_ALLOW_LEGACY_UNSIGNED_MANIFEST=true` exception. Always retain each artifact's matching
manifest and tested key version during rotation.

`BACKUP_DIRECTORY` cannot be a filesystem root, symlink, or junction. Retention pruning considers
only repository-generated artifact names directly inside that directory and never follows links or
deletes unrelated files. `BACKUP_RETENTION_DAYS=0` disables automatic pruning; otherwise completed
artifacts older than the configured age are removed after a new backup and manifest are published.
Object-lock/provider retention remains authoritative because a host process able to delete local
files is not an immutable-backup boundary.

Encryption is enabled by default and is mandatory for staging/production use. A deliberately
unencrypted `.sql.gz` is supported only for disposable local/development/test/CI fixtures and
requires all three of `BACKUP_ENCRYPTION_MODE=none`, `ALLOW_UNENCRYPTED_BACKUP=true`, and a matching
safe `BACKUP_ENVIRONMENT`. Restoring that exception independently requires
`RESTORE_ALLOW_UNENCRYPTED_BACKUP=true`. Never transfer or retain an unencrypted backup containing
real customer or commercial data.

Never commit a backup. Copy the artifact and manifest together to retention-protected storage and
verify the reported checksum after transport. Logical dumps containing customer data are sensitive.

## Isolated restore procedure

1. Declare the restore point, reason, incident/change ID, recovery owner, and required UTC point.
2. Create an isolated network/account with no customer email/SMS/courier egress.
3. Provision the same compatible MySQL major version, InnoDB settings, utf8mb4, and UTC configuration.
4. Retrieve the backup manifest and verify signature/checksum before decrypting.
5. Restore the latest full backup.
6. For PITR, apply binary logs only through the selected transaction/time, never past the destructive event.
7. Run Prisma migration status. Apply only reviewed forward migrations needed by the tested application image.
8. Restore/reconnect a copied versioned object bucket if the scenario requires media; never point the test at the production bucket.
9. Start API/worker with provider adapters disabled or routed to test sinks and with checkout disabled.
10. Run the verification suite below and record actual RPO, RTO, errors, row counts, and evidence.
11. Destroy or retain the isolated copy according to approved sensitive-data handling, with audited deletion.

Repository restore tooling refuses an ordinary target. It requires a fully empty database and all
of these independent confirmations:

    DATABASE_RESTORE_URL=mysql://restore_user:...@mysql:3306/vape_restore_drill
    BACKUP_ENCRYPTION_KEY_BASE64=<matching-key>
    RESTORE_TARGET_IS_DISPOSABLE=true
    RESTORE_CONFIRM_DATABASE=vape_restore_drill
    RESTORE_ALLOW_LEGACY_UNSIGNED_MANIFEST=false
    RESTORE_MAX_PLAINTEXT_BYTES=<approved-capacity-limit>
    EXPECTED_MIGRATION_NAME=<migration-required-by-this-image>
    pnpm restore:mysql <backup.sql.gz.enc> --confirm-empty-disposable-database

Before spawning a mutating MySQL client, restore verifies the manifest checksum/size and fully
authenticates/decrypts AES-GCM, verifies the declared gzip expansion size does not exceed the
operator-approved `RESTORE_MAX_PLAINTEXT_BYTES`, and materializes SQL only
inside a mode-0700 temporary directory. It then proves the target database has zero tables. After
import it checks the manifest and image migration versions, incomplete migrations, key table counts,
known foreign-key orphans, nonnegative inventory, active-reservation coverage, order/line money
equations, and nonnegative cash invariants. Temporary plaintext is removed in `finally`. A failed
logical import can still leave a partially populated target because MySQL DDL is not globally
transactional; discard and recreate that disposable database before retrying. Never import over the
source or production database.

`pnpm verify:restore [manifest]` reruns read-only post-restore verification and also requires
`EXPECTED_MIGRATION_NAME`. Manifest table counts
are advisory when writes occurred between metadata capture and the logical snapshot; invariant and
migration failures are fatal.

## Automated isolated restore drill

The drill command creates a randomly named `vape_restore_drill_<UTC>_<nonce>` database on the
server named by a privileged drill-only URL, invokes the same guarded restore and verification,
writes a mode-restricted JSON evidence report, and drops the drill database by default:

    RESTORE_DRILL_ADMIN_URL=mysql://drill_admin:...@isolated-mysql:3306/mysql
    RESTORE_DRILL_TARGET_IS_ISOLATED=true
    RESTORE_DRILL_CONFIRM_HOST=isolated-mysql
    EXPECTED_MIGRATION_NAME=<migration-required-by-this-image>
    BACKUP_ENCRYPTION_KEY_BASE64=<matching-key>
    RESTORE_DRILL_REPORT_DIRECTORY=backups/restore-drill-reports
    pnpm restore:drill <backup.sql.gz.enc>

The drill refuses to start unless the isolated-target boolean and exact hostname confirmation match
the admin URL. That admin identity creates the generated database and an ephemeral random restore
identity scoped only to that database; the dump and verification never use the server-wide admin
identity. The ephemeral identity is removed on success or failure. The admin identity should still
have permission to create/drop databases and users only on a dedicated isolated drill server or
account. The generated-name guard prevents this command from dropping an ordinary database. Keeping
the restored database requires both `--keep-isolated-database` and
`RESTORE_DRILL_KEEP_DATABASE=true`; destroy retained sensitive copies through the approved process.
Mode `0600`/`0700` is applied where the operating system supports POSIX permissions; on Windows,
also protect backup, temporary, and report directories with a dedicated NTFS ACL.

Each report records the source checksum/migration, target database name, start/end, logical
restore-and-verification duration, cleanup result, and backup age at drill start. Those last two
measurements are evidence inputs: they are not a full-service RTO or transaction-level RPO. The
operator must still record provider snapshot/PITR recovery, object recovery, service startup, smoke
tests, reconciliation, and the latest recoverable transaction in the readiness report. A unit test
or `--help` invocation is not a successful restore drill.

## Restore verification

- MySQL consistency and migration state are healthy.
- Counts and referential checks cover users, products, inventory, orders/items/snapshots, delivery/history, collections/remittances/discrepancies, consent, audit, and outbox/jobs.
- Sample monetary equations balance in integer millimes.
- On-hand quantities are nonnegative and active reservation totals do not exceed allowed stock.
- Order item/address/consent snapshots remain readable for archived catalog/customer records.
- Delivery histories contain valid transitions and failed age checks have no delivered outcome.
- COD expected/collected/remitted/reconciled aggregates match underlying immutable events.
- Object checksums and a sample of approved media/evidence references resolve from the restored bucket.
- Customer and admin authentication realms remain separate; all restored sessions are invalidated.
- A controlled read-only report and safe test order workflow succeed with notifications suppressed.
- Audit/security histories are present and not writable through normal APIs.

## Latest recorded local drill

On 2026-07-20, a fresh MySQL 8.4 source received all six migrations through
`20260720160000_cash_collection_idempotency` and the structural seed. The backup command produced a
gzip plus AES-256-GCM artifact and authenticated manifest. The isolated drill created a generated
database and scoped restore identity, verified all six migration checksums, table counts, foreign
keys/orphans, money equations, inventory/reservation rules and cash invariants, then removed both
the database and identity. Every reported violation count was zero.

The measured artifact sizes were 202,567 plaintext bytes, 26,275 compressed bytes and 26,307
ciphertext bytes. Total drill time was 23.551 seconds, of which restore plus verification was
16.372 seconds; backup age at drill start was 1.203 seconds. This is local logical-database evidence.
It does not replace the purchaser's target object restore, provider snapshot/PITR test, service
startup/reconciliation, protected off-site retention, or accepted full-service RPO/RTO.

## Disaster recovery

1. Invoke docs/INCIDENT_RESPONSE.md, stop unsafe writes, and preserve evidence.
2. Select failover or restore based on corruption scope, not only availability.
3. Rotate credentials if compromise is possible before reconnecting restored services.
4. Restore MySQL/PITR and object data, then deploy a known-good compatible image.
5. Start with maintenance on and checkout off.
6. Run verification, reconcile outbox/queues/idempotency, and inspect COD/inventory cutoffs.
7. Reopen read traffic, then admin operations, then checkout only with incident/legal/business approval.
8. Communicate actual data-loss window and manual reconciliation needs.
9. Run a post-incident review and close recovery gaps.

## Catalog import and media recovery

Before applying a large catalog batch, create a committed MySQL backup artifact/manifest and confirm that the matching object-storage bucket is versioned or copied into the same recovery scope. Record the import key, preview and applied batch IDs, operator, source revision, database backup reference, object-storage recovery point, and verification-report checksum in the change record. Do not put the backup, real catalog export, or credentials in Git.

The reviewed Wotofo workflow writes database records and object data in separate explicit phases. Database apply is atomic; official media download is idempotent per verified source record but necessarily performs external object writes. Recovery therefore has three distinct choices:

1. use the guarded catalog rollback only when the applied batch is create-only and every imported record is still at its recorded version;
2. preserve manually changed records and perform an audited forward correction when rollback reports a version/manual-review conflict; or
3. restore MySQL and the corresponding object-storage point together in an isolated recovery workflow when broader corruption requires it.

Catalog rollback archives products/variants and preserves receipts/provenance; it is not a database restore and does not roll object storage back in time. A database-only restore can leave unreferenced objects, while an object-only restore can leave database references to missing bytes. After any recovery, run `pnpm catalog:verify:wotofo`, verify a sample of stored checksums through the media API, inspect queued media-deletion events, and keep checkout disabled until catalog, inventory, delivery, and order/COD invariants have been reconciled. See [Catalog import and media operations](CATALOG_IMPORT_AND_MEDIA.md).

## Migration rollback

Prisma migrations should use expand-contract and roll forward with a corrective migration. Before a destructive step, retain a tested backup and a compatible prior image. If point-in-time restoration is required, separately reconcile legitimate orders, inventory, delivery, and cash events that occurred after the chosen point; do not silently discard them.

## Drill schedule

- Automated backup job and checksum verification: daily
- Backup freshness alert: continuous
- Isolated logical restore: monthly
- Physical/PITR restore and application verification: quarterly and before production launch
- Object-version recovery: quarterly
- Full incident/DR exercise with measured RPO/RTO: at least twice yearly

Record the latest evidence, date, owner, measured results, and unresolved failures in PRODUCTION_READINESS_REPORT.md.
