-- Preserve day-based standard delivery estimates while allowing exact minute-based express estimates.
ALTER TABLE `DeliveryZone`
  ADD COLUMN `estimatedMinMinutes` INTEGER NULL,
  ADD COLUMN `estimatedMaxMinutes` INTEGER NULL,
  ADD COLUMN `paymentMethod` ENUM('CASH_ON_DELIVERY') NULL,
  ADD COLUMN `assignmentMode` ENUM('MANUAL') NULL,
  ADD COLUMN `driverCommunication` ENUM('WHATSAPP', 'PHONE') NULL,
  ADD CONSTRAINT `DeliveryZone_estimated_minutes_bounds` CHECK (
    (`estimatedMinMinutes` IS NULL AND `estimatedMaxMinutes` IS NULL)
    OR (
      `estimatedMinMinutes` BETWEEN 1 AND 10080
      AND `estimatedMaxMinutes` BETWEEN 1 AND 10080
      AND `estimatedMinMinutes` <= `estimatedMaxMinutes`
    )
  ),
  ADD CONSTRAINT `DeliveryZone_estimate_unit` CHECK (
    (`estimatedMinMinutes` IS NULL AND `estimatedMaxMinutes` IS NULL)
    OR (`estimatedMinDays` IS NULL AND `estimatedMaxDays` IS NULL)
  );

-- Keep persisted money in bounded integer millimes. A zero fee is accepted by the database only
-- so the service can allow it for an explicitly configured free-delivery zone.
ALTER TABLE `DeliveryRate`
  ADD CONSTRAINT `DeliveryRate_fee_millimes_bounds` CHECK (
    `feeMillimes` >= 0 AND `feeMillimes` <= 1000000
  );
