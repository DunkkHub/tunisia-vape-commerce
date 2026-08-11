-- Extend credential-free manual courier records with operational availability, capacity,
-- WhatsApp contact configuration, and internal integer-millime cost defaults. Existing courier
-- rows remain active/available and retain their current unrestricted coverage until an operator
-- explicitly links one or more delivery zones.
ALTER TABLE `Courier`
  ADD COLUMN `companyName` VARCHAR(200) NULL,
  ADD COLUMN `availabilityStatus` ENUM('AVAILABLE', 'OFF_DUTY') NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN `whatsappPhoneE164` VARCHAR(16) NULL,
  ADD COLUMN `defaultFeeMillimes` INTEGER NULL,
  ADD COLUMN `maximumActiveDeliveries` INTEGER NULL,
  ADD COLUMN `whatsappTemplate` TEXT NULL,
  ADD CONSTRAINT `Courier_defaultFeeMillimes_check` CHECK (
    `defaultFeeMillimes` IS NULL OR
    (`defaultFeeMillimes` >= 0 AND `defaultFeeMillimes` <= 1000000)
  ),
  ADD CONSTRAINT `Courier_maximumActiveDeliveries_check` CHECK (
    `maximumActiveDeliveries` IS NULL OR
    (`maximumActiveDeliveries` >= 1 AND `maximumActiveDeliveries` <= 10000)
  );

DROP INDEX `Courier_status_name_idx` ON `Courier`;
CREATE INDEX `Courier_status_availabilityStatus_name_idx`
  ON `Courier` (`status`, `availabilityStatus`, `name`);

-- A courier may cover any number of already-configured delivery zones. The optional fee is the
-- operator's internal courier cost for that zone; it never replaces the customer-facing
-- DeliveryRate selected and snapshotted by checkout.
CREATE TABLE `CourierDeliveryZone` (
  `courierId` VARCHAR(30) NOT NULL,
  `deliveryZoneId` VARCHAR(30) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `feeMillimes` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`courierId`, `deliveryZoneId`),
  INDEX `CourierDeliveryZone_deliveryZoneId_active_idx` (`deliveryZoneId`, `active`),
  INDEX `CourierDeliveryZone_courierId_active_idx` (`courierId`, `active`),
  CONSTRAINT `CourierDeliveryZone_feeMillimes_check` CHECK (
    `feeMillimes` IS NULL OR (`feeMillimes` >= 0 AND `feeMillimes` <= 1000000)
  ),
  CONSTRAINT `CourierDeliveryZone_courierId_fkey`
    FOREIGN KEY (`courierId`) REFERENCES `Courier` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CourierDeliveryZone_deliveryZoneId_fkey`
    FOREIGN KEY (`deliveryZoneId`) REFERENCES `DeliveryZone` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
