ALTER TABLE `CashCollection`
    ADD COLUMN `recordIdempotencyKeyHash` CHAR(64) NULL,
    ADD COLUMN `recordRequestHash` CHAR(64) NULL,
    ADD UNIQUE INDEX `CashCollection_recordIdempotencyKeyHash_key` (`recordIdempotencyKeyHash`);

ALTER TABLE `Notification`
    MODIFY COLUMN `event` ENUM(
        'REGISTRATION',
        'EMAIL_VERIFICATION',
        'PASSWORD_RESET',
        'ORDER_RECEIVED',
        'ORDER_CONFIRMED',
        'ORDER_ON_HOLD',
        'ORDER_PREPARING',
        'HANDED_TO_COURIER',
        'OUT_FOR_DELIVERY',
        'DELIVERY_ATTEMPTED',
        'DELIVERY_RESCHEDULED',
        'ORDER_DELIVERED',
        'DELIVERY_REFUSED',
        'DELIVERY_FAILED',
        'ORDER_CANCELLED',
        'RETURN_UPDATE',
        'SECURITY_ALERT',
        'LOW_STOCK_ALERT',
        'ADMIN_ORDER_CREATED'
    ) NOT NULL;

-- Backfill cleanup work for media that was soft-deleted before durable deletion events existed.
INSERT IGNORE INTO `OutboxEvent` (
    `id`,
    `deterministicKey`,
    `aggregateType`,
    `aggregateId`,
    `eventType`,
    `eventVersion`,
    `payload`,
    `status`,
    `availableAt`,
    `attemptCount`,
    `maxAttempts`,
    `createdAt`,
    `updatedAt`
)
SELECT
    CONCAT('meddel_', LEFT(REPLACE(UUID(), '-', ''), 23)),
    CONCAT('media-object-delete:v1:', `id`),
    'ProductImage',
    `id`,
    'media.object.delete.requested',
    1,
    JSON_OBJECT('objectKey', `objectKey`, 'bucket', `bucket`),
    'PENDING',
    CURRENT_TIMESTAMP(3),
    0,
    8,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM `ProductImage`
WHERE `deletedAt` IS NOT NULL;
