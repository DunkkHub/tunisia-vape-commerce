-- Operator-supplied URLs are metadata, not evidence that an external source was independently verified.
ALTER TABLE `CatalogSourceRecord`
  MODIFY `verifiedAt` DATETIME(3) NULL;

UPDATE `CatalogSourceRecord`
SET
  `verifiedAt` = NULL,
  `metadata` = JSON_SET(
    COALESCE(`metadata`, JSON_OBJECT()),
    '$.verificationStatus',
    'OPERATOR_SUPPLIED_UNVERIFIED'
  )
WHERE `source` = 'ADMIN_UPLOAD';

UPDATE `CatalogSourceRecord`
SET `metadata` = JSON_SET(
  COALESCE(`metadata`, JSON_OBJECT()),
  '$.verificationStatus',
  'OFFICIAL_SOURCE_VERIFIED'
)
WHERE `source` = 'WOTOFO_OFFICIAL';
