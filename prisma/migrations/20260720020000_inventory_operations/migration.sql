-- Make movement-producing inventory operations safely replayable without storing raw keys.
ALTER TABLE `StockMovement`
    ADD COLUMN `idempotencyKeyHash` CHAR(64) NULL,
    ADD COLUMN `requestFingerprint` CHAR(64) NULL;

CREATE UNIQUE INDEX `StockMovement_idempotencyKeyHash_key`
    ON `StockMovement`(`idempotencyKeyHash`);

-- Persist the stock/version snapshot used by dual-control adjustment approval.
ALTER TABLE `InventoryAdjustment`
    ADD COLUMN `expectedVersion` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `onHandBefore` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `decisionReason` VARCHAR(500) NULL,
    ADD COLUMN `expiresAt` DATETIME(3) NULL,
    MODIFY `status` ENUM(
        'PENDING_APPROVAL',
        'APPROVED',
        'REJECTED',
        'APPLIED',
        'EXPIRED'
    ) NOT NULL DEFAULT 'PENDING_APPROVAL';

-- Legacy builds never persisted a version/on-hand approval snapshot. Close any
-- non-final legacy request rather than allowing the new approval route to apply
-- a fabricated default snapshot.
UPDATE `InventoryAdjustment`
SET
    `status` = 'EXPIRED',
    `expiresAt` = CURRENT_TIMESTAMP(3),
    `decisionReason` = 'LEGACY_SNAPSHOT_UNAVAILABLE'
WHERE `status` IN ('PENDING_APPROVAL', 'APPROVED');

-- A transfer owns exactly one immutable outbound movement and one immutable inbound movement.
CREATE TABLE `InventoryTransfer` (
    `id` VARCHAR(30) NOT NULL,
    `sourceInventoryItemId` VARCHAR(30) NOT NULL,
    `destinationInventoryItemId` VARCHAR(30) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `idempotencyKeyHash` CHAR(64) NOT NULL,
    `requestFingerprint` CHAR(64) NOT NULL,
    `requestedBy` VARCHAR(30) NOT NULL,
    `note` VARCHAR(1000) NULL,
    `sourceMovementId` VARCHAR(30) NOT NULL,
    `destinationMovementId` VARCHAR(30) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `InventoryTransfer_idempotencyKeyHash_key`(`idempotencyKeyHash`),
    UNIQUE INDEX `InventoryTransfer_sourceMovementId_key`(`sourceMovementId`),
    UNIQUE INDEX `InventoryTransfer_destinationMovementId_key`(`destinationMovementId`),
    INDEX `InventoryTransfer_sourceInventoryItemId_occurredAt_idx`(`sourceInventoryItemId`, `occurredAt`),
    INDEX `InventoryTransfer_destinationInventoryItemId_occurredAt_idx`(`destinationInventoryItemId`, `occurredAt`),
    INDEX `InventoryTransfer_occurredAt_id_idx`(`occurredAt`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `InventoryTransfer`
    ADD CONSTRAINT `InventoryTransfer_sourceInventoryItemId_fkey`
    FOREIGN KEY (`sourceInventoryItemId`) REFERENCES `InventoryItem`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `InventoryTransfer`
    ADD CONSTRAINT `InventoryTransfer_destinationInventoryItemId_fkey`
    FOREIGN KEY (`destinationInventoryItemId`) REFERENCES `InventoryItem`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `InventoryTransfer`
    ADD CONSTRAINT `InventoryTransfer_sourceMovementId_fkey`
    FOREIGN KEY (`sourceMovementId`) REFERENCES `StockMovement`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `InventoryTransfer`
    ADD CONSTRAINT `InventoryTransfer_destinationMovementId_fkey`
    FOREIGN KEY (`destinationMovementId`) REFERENCES `StockMovement`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
