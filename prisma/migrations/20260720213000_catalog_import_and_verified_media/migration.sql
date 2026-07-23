-- Expand the catalogue for reviewed imports without changing any existing publication state.
ALTER TABLE `Product`
  ADD COLUMN `family` VARCHAR(120) NULL,
  ADD COLUMN `model` VARCHAR(160) NULL,
  ADD COLUMN `needsMediaReview` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `requiresPricing` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `requiresStock` BOOLEAN NOT NULL DEFAULT false,
  MODIFY `productType` ENUM(
    'DEVICE',
    'E_LIQUID',
    'POD',
    'PREFILLED_POD_KIT',
    'PREFILLED_REPLACEMENT_POD',
    'COIL',
    'DISPOSABLE',
    'ACCESSORY',
    'OTHER'
  ) NOT NULL;

-- Preserve a truthful, sanitized display name for uploaded media. The nullable add/backfill/not-null
-- sequence keeps upgrades safe when an existing installation already has product images.
ALTER TABLE `ProductImage`
  DROP FOREIGN KEY `ProductImage_productId_fkey`,
  DROP FOREIGN KEY `ProductImage_variantId_fkey`,
  ADD COLUMN `originalFilename` VARCHAR(255) NULL,
  ADD COLUMN `updatedAt` DATETIME(3) NULL;

UPDATE `ProductImage`
SET `updatedAt` = `createdAt`
WHERE `updatedAt` IS NULL;

ALTER TABLE `ProductImage`
  MODIFY `updatedAt` DATETIME(3) NOT NULL,
  ADD CONSTRAINT `ProductImage_exactly_one_owner_chk`
    CHECK ((`productId` IS NULL) <> (`variantId` IS NULL));

-- RESTRICT hard deletes so the ownership CHECK remains enforceable on MySQL 8.4. Product and
-- image removal is soft-deletion in the application; this also prevents provenance loss.
ALTER TABLE `ProductImage`
  ADD CONSTRAINT `ProductImage_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ProductImage_variantId_fkey`
    FOREIGN KEY (`variantId`) REFERENCES `ProductVariant` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE `Flavor` (
  `id` VARCHAR(30) NOT NULL,
  `canonicalName` VARCHAR(160) NOT NULL,
  `slug` VARCHAR(180) NOT NULL,
  `nameFr` VARCHAR(160) NOT NULL,
  `nameAr` VARCHAR(160) NOT NULL,
  `category` ENUM(
    'FRUIT',
    'MIXED_FRUIT',
    'MINT',
    'ICE',
    'DRINK',
    'TOBACCO',
    'DESSERT',
    'CANDY',
    'CLEAR',
    'OTHER'
  ) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Flavor_canonicalName_key` (`canonicalName`),
  UNIQUE INDEX `Flavor_slug_key` (`slug`),
  INDEX `Flavor_category_canonicalName_idx` (`category`, `canonicalName`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProductVariant`
  ADD COLUMN `flavorId` VARCHAR(30) NULL,
  ADD COLUMN `nicotineStrengthMg` DECIMAL(8, 3) NULL;

CREATE TABLE `CatalogImportBatch` (
  `id` VARCHAR(30) NOT NULL,
  `importKey` VARCHAR(100) NOT NULL,
  `dryRun` BOOLEAN NOT NULL,
  `payloadHash` CHAR(64) NOT NULL,
  `format` ENUM('CSV', 'JSON', 'WOTOFO') NOT NULL,
  `source` ENUM('ADMIN_UPLOAD', 'WOTOFO_OFFICIAL') NOT NULL,
  `schemaVersion` VARCHAR(20) NOT NULL,
  `status` ENUM(
    'PREVIEW_VALID',
    'PREVIEW_INVALID',
    'APPLYING',
    'APPLIED',
    'APPLIED_WITH_WARNINGS',
    'FAILED',
    'ROLLED_BACK'
  ) NOT NULL,
  `partialMode` BOOLEAN NOT NULL DEFAULT false,
  `overridePrice` BOOLEAN NOT NULL DEFAULT false,
  `overrideStatus` BOOLEAN NOT NULL DEFAULT false,
  `overrideImages` BOOLEAN NOT NULL DEFAULT false,
  `rowCount` INTEGER NOT NULL,
  `appliedCount` INTEGER NOT NULL DEFAULT 0,
  `payload` JSON NULL,
  `result` JSON NOT NULL,
  `previewBatchId` VARCHAR(30) NULL,
  `createdByUserId` VARCHAR(30) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  `rolledBackAt` DATETIME(3) NULL,
  INDEX `CatalogImportBatch_createdByUserId_createdAt_idx` (`createdByUserId`, `createdAt`),
  INDEX `CatalogImportBatch_status_createdAt_idx` (`status`, `createdAt`),
  INDEX `CatalogImportBatch_previewBatchId_idx` (`previewBatchId`),
  UNIQUE INDEX `CatalogImportBatch_importKey_dryRun_key` (`importKey`, `dryRun`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CatalogImportRow` (
  `id` VARCHAR(30) NOT NULL,
  `batchId` VARCHAR(30) NOT NULL,
  `rowNumber` INTEGER NOT NULL,
  `stableIdentity` VARCHAR(320) NOT NULL,
  `payloadHash` CHAR(64) NOT NULL,
  `status` ENUM('VALID', 'INVALID', 'CREATED', 'UPDATED', 'SKIPPED', 'FAILED', 'ROLLED_BACK') NOT NULL,
  `action` VARCHAR(40) NOT NULL,
  `issues` JSON NOT NULL,
  `beforeSnapshot` JSON NULL,
  `afterSnapshot` JSON NULL,
  `productId` VARCHAR(30) NULL,
  `variantId` VARCHAR(30) NULL,
  `productPostVersion` INTEGER NULL,
  `postVersion` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `CatalogImportRow_batchId_status_idx` (`batchId`, `status`),
  INDEX `CatalogImportRow_stableIdentity_idx` (`stableIdentity`),
  INDEX `CatalogImportRow_productId_idx` (`productId`),
  INDEX `CatalogImportRow_variantId_idx` (`variantId`),
  UNIQUE INDEX `CatalogImportRow_batchId_rowNumber_key` (`batchId`, `rowNumber`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CatalogSourceRecord` (
  `id` VARCHAR(30) NOT NULL,
  `source` ENUM('ADMIN_UPLOAD', 'WOTOFO_OFFICIAL') NOT NULL,
  `entityType` ENUM('PRODUCT', 'VARIANT', 'IMAGE') NOT NULL,
  `externalKey` VARCHAR(320) NOT NULL,
  `sourceUrl` VARCHAR(2048) NOT NULL,
  `sourceUrlHash` CHAR(64) NOT NULL,
  `contentHash` CHAR(64) NULL,
  `verifiedAt` DATETIME(3) NOT NULL,
  `metadata` JSON NULL,
  `productId` VARCHAR(30) NULL,
  `variantId` VARCHAR(30) NULL,
  `imageId` VARCHAR(30) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `CatalogSourceRecord_sourceUrlHash_idx` (`sourceUrlHash`),
  INDEX `CatalogSourceRecord_productId_idx` (`productId`),
  INDEX `CatalogSourceRecord_variantId_idx` (`variantId`),
  INDEX `CatalogSourceRecord_imageId_idx` (`imageId`),
  UNIQUE INDEX `CatalogSourceRecord_source_entityType_externalKey_key` (`source`, `entityType`, `externalKey`),
  CONSTRAINT `CatalogSourceRecord_exactly_one_owner_chk`
    CHECK (
      (`productId` IS NOT NULL) + (`variantId` IS NOT NULL) + (`imageId` IS NOT NULL) = 1
    ),
  CONSTRAINT `CatalogSourceRecord_entity_owner_chk`
    CHECK (
      (`entityType` = 'PRODUCT' AND `productId` IS NOT NULL) OR
      (`entityType` = 'VARIANT' AND `variantId` IS NOT NULL) OR
      (`entityType` = 'IMAGE' AND `imageId` IS NOT NULL)
    ),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `Product_puffCount_publicationStatus_idx`
  ON `Product` (`puffCount`, `publicationStatus`);
CREATE INDEX `Product_requiresPricing_requiresStock_needsMediaReview_idx`
  ON `Product` (`requiresPricing`, `requiresStock`, `needsMediaReview`);
CREATE INDEX `ProductImage_checksumSha256_idx`
  ON `ProductImage` (`checksumSha256`);
CREATE INDEX `ProductVariant_flavorId_publicationStatus_idx`
  ON `ProductVariant` (`flavorId`, `publicationStatus`);
CREATE INDEX `ProductVariant_nicotineStrengthMg_publicationStatus_idx`
  ON `ProductVariant` (`nicotineStrengthMg`, `publicationStatus`);

ALTER TABLE `ProductVariant`
  ADD CONSTRAINT `ProductVariant_flavorId_fkey`
    FOREIGN KEY (`flavorId`) REFERENCES `Flavor` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CatalogImportRow`
  ADD CONSTRAINT `CatalogImportRow_batchId_fkey`
    FOREIGN KEY (`batchId`) REFERENCES `CatalogImportBatch` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `CatalogSourceRecord`
  ADD CONSTRAINT `CatalogSourceRecord_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `CatalogSourceRecord_variantId_fkey`
    FOREIGN KEY (`variantId`) REFERENCES `ProductVariant` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `CatalogSourceRecord_imageId_fkey`
    FOREIGN KEY (`imageId`) REFERENCES `ProductImage` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;
