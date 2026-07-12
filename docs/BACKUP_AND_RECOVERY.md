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

## Local logical backup example

For disposable local verification only:

    docker compose exec -T mysql sh -c 'exec mysqldump --single-transaction --quick --routines --events --triggers --set-gtid-purged=OFF -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' > local-backup.sql

This local command exposes the password to a process argument inside the isolated development container. Production must use the provider's authenticated backup mechanism or a protected client option file and a dedicated backup identity.

Check the output is nonempty, capture a SHA-256 checksum, encrypt it before transport, and never commit it. Logical dumps containing customer data are sensitive.

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

Local import into a newly created disposable database:

    docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < local-backup.sql

Never import over the original local database when testing a restore.

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
