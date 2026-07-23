-- An imported supplier cost is unknown until the operator enters a verified commercial value.
-- NULL is distinct from a real zero cost and avoids inventing procurement data.
ALTER TABLE `ProductVariant`
  MODIFY `costMillimes` INTEGER NULL;

UPDATE `ProductVariant` AS `variant`
INNER JOIN `CatalogSourceRecord` AS `sourceRecord`
  ON `sourceRecord`.`variantId` = `variant`.`id`
  AND `sourceRecord`.`source` = 'WOTOFO_OFFICIAL'
  AND `sourceRecord`.`entityType` = 'VARIANT'
SET `variant`.`costMillimes` = NULL
WHERE `variant`.`costMillimes` = 0;
