-- Link collection-level discrepancies and their append-only reconciliation events to the exact
-- CashCollection they affect. The originally recorded collectedMillimes value remains immutable;
-- a later exact second count is represented by a linked ADJUSTMENT_RECORDED event.
ALTER TABLE `CashDiscrepancy`
  ADD COLUMN `cashCollectionId` VARCHAR(30) NULL;

ALTER TABLE `CashReconciliationEvent`
  ADD COLUMN `cashCollectionId` VARCHAR(30) NULL;

-- Older application versions linked collection discrepancies only through Order. Backfill only
-- an unambiguous amount-matching pair. Ambiguous legacy data remains unlinked and fails closed in
-- the application instead of being guessed during migration.
-- First prefer the server-generated DISCREPANCY_OPENED event coordinates when every event claim
-- for the discrepancy agrees and cross-checks against the immutable collection amounts.
UPDATE `CashDiscrepancy` discrepancy
JOIN (
  SELECT
    legacy_discrepancy.`id` AS `discrepancyId`,
    MIN(collection.`id`) AS `cashCollectionId`
  FROM `CashDiscrepancy` legacy_discrepancy
  JOIN `CashReconciliationEvent` reconciliation_event
    ON reconciliation_event.`type` = 'DISCREPANCY_OPENED'
    AND reconciliation_event.`remittanceId` IS NULL
    AND JSON_UNQUOTE(JSON_EXTRACT(reconciliation_event.`metadata`, '$.discrepancyId')) =
      legacy_discrepancy.`id`
  LEFT JOIN `CashCollection` collection
    ON collection.`id` = JSON_UNQUOTE(
      JSON_EXTRACT(reconciliation_event.`metadata`, '$.cashCollectionId')
    )
    AND collection.`orderId` = legacy_discrepancy.`orderId`
    AND collection.`expectedMillimes` = legacy_discrepancy.`expectedMillimes`
    AND collection.`collectedMillimes` = legacy_discrepancy.`actualMillimes`
    AND legacy_discrepancy.`differenceMillimes` =
      legacy_discrepancy.`actualMillimes` - legacy_discrepancy.`expectedMillimes`
  WHERE legacy_discrepancy.`remittanceId` IS NULL
    AND legacy_discrepancy.`orderId` IS NOT NULL
  GROUP BY legacy_discrepancy.`id`
  HAVING COUNT(*) = COUNT(collection.`id`)
    AND COUNT(DISTINCT collection.`id`) = 1
) event_matched
  ON event_matched.`discrepancyId` = discrepancy.`id`
SET discrepancy.`cashCollectionId` = event_matched.`cashCollectionId`
WHERE discrepancy.`cashCollectionId` IS NULL;

-- A collection is a one-to-one accounting coordinate. Separate, individually valid legacy
-- events can still conflict by pointing two discrepancies at the same collection. Materialize
-- those cross-discrepancy collisions and discard every conflicting claim before the unique index
-- is created; the affected legacy discrepancies remain order-scoped and fail closed for manual
-- review instead of making the migration abort or selecting a winner.
CREATE TEMPORARY TABLE `_migration_collection_discrepancy_conflicts`
SELECT discrepancy.`cashCollectionId`
FROM `CashDiscrepancy` discrepancy
WHERE 1 = 0;

INSERT INTO `_migration_collection_discrepancy_conflicts` (`cashCollectionId`)
SELECT discrepancy.`cashCollectionId`
FROM `CashDiscrepancy` discrepancy
WHERE discrepancy.`cashCollectionId` IS NOT NULL
GROUP BY discrepancy.`cashCollectionId`
HAVING COUNT(*) > 1;

UPDATE `CashDiscrepancy` discrepancy
JOIN `_migration_collection_discrepancy_conflicts` conflict
  ON conflict.`cashCollectionId` = discrepancy.`cashCollectionId`
SET discrepancy.`cashCollectionId` = NULL;

DROP TEMPORARY TABLE `_migration_collection_discrepancy_conflicts`;

-- If no discrepancy event metadata exists, fall back to a unique order-and-amount pair.
UPDATE `CashDiscrepancy` discrepancy
JOIN (
  SELECT candidate.`discrepancyId`, candidate.`cashCollectionId`
  FROM (
    SELECT
      legacy_discrepancy.`id` AS `discrepancyId`,
      MIN(collection.`id`) AS `cashCollectionId`,
      COUNT(*) AS `candidateCount`
    FROM `CashDiscrepancy` legacy_discrepancy
    JOIN `CashCollection` collection
      ON collection.`orderId` = legacy_discrepancy.`orderId`
      AND collection.`expectedMillimes` = legacy_discrepancy.`expectedMillimes`
      AND collection.`collectedMillimes` = legacy_discrepancy.`actualMillimes`
    WHERE legacy_discrepancy.`remittanceId` IS NULL
      AND legacy_discrepancy.`orderId` IS NOT NULL
    GROUP BY legacy_discrepancy.`id`
    HAVING `candidateCount` = 1
  ) candidate
  JOIN (
    SELECT
      collection.`id` AS `cashCollectionId`,
      COUNT(*) AS `discrepancyCount`
    FROM `CashCollection` collection
    JOIN `CashDiscrepancy` legacy_discrepancy
      ON legacy_discrepancy.`orderId` = collection.`orderId`
      AND legacy_discrepancy.`expectedMillimes` = collection.`expectedMillimes`
      AND legacy_discrepancy.`actualMillimes` = collection.`collectedMillimes`
    WHERE legacy_discrepancy.`remittanceId` IS NULL
      AND legacy_discrepancy.`orderId` IS NOT NULL
    GROUP BY collection.`id`
    HAVING `discrepancyCount` = 1
  ) unique_collection
    ON unique_collection.`cashCollectionId` = candidate.`cashCollectionId`
) matched
  ON matched.`discrepancyId` = discrepancy.`id`
SET discrepancy.`cashCollectionId` = matched.`cashCollectionId`
WHERE discrepancy.`cashCollectionId` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `CashReconciliationEvent` reconciliation_event
    WHERE reconciliation_event.`type` = 'DISCREPANCY_OPENED'
      AND JSON_UNQUOTE(JSON_EXTRACT(reconciliation_event.`metadata`, '$.discrepancyId')) =
        discrepancy.`id`
  );

-- Existing collection events already carry this server-generated identifier in bounded JSON.
-- Promote a valid value to a foreign-key coordinate without accepting an arbitrary identifier.
UPDATE `CashReconciliationEvent` reconciliation_event
JOIN `CashCollection` collection
  ON collection.`id` = JSON_UNQUOTE(
    JSON_EXTRACT(reconciliation_event.`metadata`, '$.cashCollectionId')
  )
SET reconciliation_event.`cashCollectionId` = collection.`id`
WHERE reconciliation_event.`cashCollectionId` IS NULL
  AND reconciliation_event.`remittanceId` IS NULL
  AND (
    JSON_EXTRACT(reconciliation_event.`metadata`, '$.discrepancyId') IS NULL OR
    EXISTS (
      SELECT 1
      FROM `CashDiscrepancy` discrepancy
      WHERE discrepancy.`id` = JSON_UNQUOTE(
        JSON_EXTRACT(reconciliation_event.`metadata`, '$.discrepancyId')
      )
        AND discrepancy.`cashCollectionId` = collection.`id`
    )
  );

-- MySQL does not permit a CHECK column to participate in an ON UPDATE CASCADE foreign key.
-- These identifiers are immutable, so replace all scope-related legacy FKs with RESTRICT.
ALTER TABLE `CashDiscrepancy`
  DROP FOREIGN KEY `CashDiscrepancy_remittanceId_fkey`,
  DROP FOREIGN KEY `CashDiscrepancy_orderId_fkey`;

ALTER TABLE `CashReconciliationEvent`
  DROP FOREIGN KEY `CashReconciliationEvent_remittanceId_fkey`;

ALTER TABLE `CashDiscrepancy`
  ADD UNIQUE INDEX `CashDiscrepancy_cashCollectionId_key` (`cashCollectionId`),
  ADD CONSTRAINT `CashDiscrepancy_remittanceId_fkey`
    FOREIGN KEY (`remittanceId`) REFERENCES `CashRemittance` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `CashDiscrepancy_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `Order` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `CashDiscrepancy_cashCollectionId_fkey`
    FOREIGN KEY (`cashCollectionId`) REFERENCES `CashCollection` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `CashDiscrepancy_collection_scope_check` CHECK (
    (`remittanceId` IS NOT NULL AND `orderId` IS NULL AND `cashCollectionId` IS NULL) OR
    (`remittanceId` IS NULL AND `orderId` IS NOT NULL)
  );

ALTER TABLE `CashReconciliationEvent`
  ADD INDEX `CashReconciliationEvent_cashCollectionId_occurredAt_idx`
    (`cashCollectionId`, `occurredAt`),
  ADD CONSTRAINT `CashReconciliationEvent_remittanceId_fkey`
    FOREIGN KEY (`remittanceId`) REFERENCES `CashRemittance` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `CashReconciliationEvent_cashCollectionId_fkey`
    FOREIGN KEY (`cashCollectionId`) REFERENCES `CashCollection` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `CashReconciliationEvent_scope_check` CHECK (
    NOT (`remittanceId` IS NOT NULL AND `cashCollectionId` IS NOT NULL)
  );
