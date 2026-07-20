-- Durable receipts make administrator delivery-status CSV retries idempotent.
CREATE TABLE `DeliveryStatusImport` (
  `id` VARCHAR(30) NOT NULL,
  `importKey` VARCHAR(80) NOT NULL,
  `dryRun` BOOLEAN NOT NULL,
  `payloadHash` CHAR(64) NOT NULL,
  `rowCount` INTEGER NOT NULL,
  `appliedCount` INTEGER NOT NULL DEFAULT 0,
  `result` JSON NOT NULL,
  `createdByUserId` VARCHAR(30) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `DeliveryStatusImport_importKey_dryRun_key`(`importKey`, `dryRun`),
  INDEX `DeliveryStatusImport_createdByUserId_createdAt_idx`(`createdByUserId`, `createdAt`),
  INDEX `DeliveryStatusImport_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
