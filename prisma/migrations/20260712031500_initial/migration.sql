-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(30) NOT NULL,
    `audience` ENUM('CUSTOMER', 'ADMIN') NOT NULL,
    `email` VARCHAR(320) NULL,
    `emailNormalized` VARCHAR(320) NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `status` ENUM('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DISABLED', 'ANONYMIZED') NOT NULL DEFAULT 'PENDING_VERIFICATION',
    `emailVerifiedAt` DATETIME(3) NULL,
    `phoneVerifiedAt` DATETIME(3) NULL,
    `passwordChangedAt` DATETIME(3) NULL,
    `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `User_emailNormalized_key`(`emailNormalized`),
    INDEX `User_audience_status_idx`(`audience`, `status`),
    INDEX `User_emailNormalized_audience_idx`(`emailNormalized`, `audience`),
    INDEX `User_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerProfile` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `firstName` VARCHAR(100) NOT NULL,
    `lastName` VARCHAR(100) NOT NULL,
    `phoneE164` VARCHAR(16) NOT NULL,
    `phoneSearch` VARCHAR(16) NOT NULL,
    `locale` VARCHAR(10) NOT NULL DEFAULT 'fr',
    `dateOfBirth` DATE NULL,
    `marketingConsent` BOOLEAN NOT NULL DEFAULT false,
    `suspendedAt` DATETIME(3) NULL,
    `suspensionReason` VARCHAR(500) NULL,
    `anonymizedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerProfile_userId_key`(`userId`),
    UNIQUE INDEX `CustomerProfile_phoneE164_key`(`phoneE164`),
    INDEX `CustomerProfile_phoneSearch_idx`(`phoneSearch`),
    INDEX `CustomerProfile_lastName_firstName_idx`(`lastName`, `firstName`),
    INDEX `CustomerProfile_suspendedAt_idx`(`suspendedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminProfile` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `displayName` VARCHAR(200) NOT NULL,
    `employeeCode` VARCHAR(50) NULL,
    `jobTitle` VARCHAR(120) NULL,
    `mustEnrollTwoFactor` BOOLEAN NOT NULL DEFAULT true,
    `twoFactorEnforcedAt` DATETIME(3) NULL,
    `lastStepUpAt` DATETIME(3) NULL,
    `allowedIpCidrs` JSON NULL,
    `suspendedAt` DATETIME(3) NULL,
    `suspensionReason` VARCHAR(500) NULL,
    `invitationAcceptedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AdminProfile_userId_key`(`userId`),
    UNIQUE INDEX `AdminProfile_employeeCode_key`(`employeeCode`),
    INDEX `AdminProfile_suspendedAt_idx`(`suspendedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `audience` ENUM('CUSTOMER', 'ADMIN') NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `csrfTokenHash` CHAR(64) NULL,
    `status` ENUM('ACTIVE', 'REVOKED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `authenticatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `twoFactorVerified` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `idleExpiresAt` DATETIME(3) NOT NULL,
    `absoluteExpiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedReason` VARCHAR(255) NULL,
    `rotatedFromId` VARCHAR(30) NULL,

    UNIQUE INDEX `Session_tokenHash_key`(`tokenHash`),
    UNIQUE INDEX `Session_rotatedFromId_key`(`rotatedFromId`),
    INDEX `Session_userId_audience_status_idx`(`userId`, `audience`, `status`),
    INDEX `Session_status_idleExpiresAt_idx`(`status`, `idleExpiresAt`),
    INDEX `Session_status_absoluteExpiresAt_idx`(`status`, `absoluteExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VerificationToken` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `audience` ENUM('CUSTOMER', 'ADMIN') NOT NULL,
    `channel` ENUM('EMAIL', 'SMS') NOT NULL,
    `purpose` ENUM('EMAIL_VERIFICATION', 'PHONE_VERIFICATION', 'ADMIN_INVITATION', 'TWO_FACTOR_ENROLLMENT') NOT NULL,
    `destinationHash` CHAR(64) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `VerificationToken_tokenHash_key`(`tokenHash`),
    INDEX `VerificationToken_userId_purpose_consumedAt_idx`(`userId`, `purpose`, `consumedAt`),
    INDEX `VerificationToken_expiresAt_consumedAt_idx`(`expiresAt`, `consumedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordResetToken` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `audience` ENUM('CUSTOMER', 'ADMIN') NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `requestedIp` VARCHAR(45) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PasswordResetToken_tokenHash_key`(`tokenHash`),
    INDEX `PasswordResetToken_userId_consumedAt_idx`(`userId`, `consumedAt`),
    INDEX `PasswordResetToken_expiresAt_consumedAt_idx`(`expiresAt`, `consumedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TwoFactorSecret` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `encryptedSecret` TEXT NOT NULL,
    `encryptionKeyId` VARCHAR(100) NOT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `lastUsedStep` BIGINT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TwoFactorSecret_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecoveryCode` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `usedAt` DATETIME(3) NULL,

    UNIQUE INDEX `RecoveryCode_codeHash_key`(`codeHash`),
    INDEX `RecoveryCode_userId_usedAt_idx`(`userId`, `usedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `id` VARCHAR(30) NOT NULL,
    `key` VARCHAR(80) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Role_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `id` VARCHAR(30) NOT NULL,
    `key` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Permission_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserRole` (
    `userId` VARCHAR(30) NOT NULL,
    `roleId` VARCHAR(30) NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `assignedBy` VARCHAR(30) NULL,

    INDEX `UserRole_roleId_idx`(`roleId`),
    PRIMARY KEY (`userId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `roleId` VARCHAR(30) NOT NULL,
    `permissionId` VARCHAR(30) NOT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RolePermission_permissionId_idx`(`permissionId`),
    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Address` (
    `id` VARCHAR(30) NOT NULL,
    `customerId` VARCHAR(30) NOT NULL,
    `type` ENUM('HOME', 'WORK', 'OTHER') NOT NULL DEFAULT 'HOME',
    `label` VARCHAR(100) NULL,
    `fullName` VARCHAR(200) NOT NULL,
    `phoneE164` VARCHAR(16) NOT NULL,
    `governorateId` VARCHAR(30) NOT NULL,
    `delegationId` VARCHAR(30) NOT NULL,
    `localityId` VARCHAR(30) NULL,
    `postalCode` VARCHAR(10) NULL,
    `street` VARCHAR(255) NOT NULL,
    `building` VARCHAR(100) NULL,
    `floor` VARCHAR(30) NULL,
    `apartment` VARCHAR(30) NULL,
    `landmark` VARCHAR(255) NULL,
    `deliveryInstructions` VARCHAR(1000) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Address_customerId_deletedAt_idx`(`customerId`, `deletedAt`),
    INDEX `Address_phoneE164_idx`(`phoneE164`),
    INDEX `Address_governorateId_delegationId_localityId_idx`(`governorateId`, `delegationId`, `localityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerTag` (
    `id` VARCHAR(30) NOT NULL,
    `key` VARCHAR(80) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `color` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CustomerTag_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerTagAssignment` (
    `customerId` VARCHAR(30) NOT NULL,
    `tagId` VARCHAR(30) NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `assignedBy` VARCHAR(30) NULL,

    INDEX `CustomerTagAssignment_tagId_idx`(`tagId`),
    PRIMARY KEY (`customerId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerNote` (
    `id` VARCHAR(30) NOT NULL,
    `customerId` VARCHAR(30) NOT NULL,
    `authorId` VARCHAR(30) NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CustomerNote_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `CustomerNote_authorId_createdAt_idx`(`authorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerRiskEvent` (
    `id` VARCHAR(30) NOT NULL,
    `customerId` VARCHAR(30) NOT NULL,
    `type` ENUM('COD_REFUSAL', 'FAILED_DELIVERY', 'DUPLICATE_ACCOUNT', 'FRAUD_INDICATOR', 'CHARGEBACK_OR_REFUND_ABUSE', 'MANUAL_REVIEW') NOT NULL,
    `scoreDelta` INTEGER NOT NULL DEFAULT 0,
    `sourceType` VARCHAR(80) NOT NULL,
    `sourceId` VARCHAR(30) NULL,
    `summary` VARCHAR(500) NOT NULL,
    `metadata` JSON NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewedBy` VARCHAR(30) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CustomerRiskEvent_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `CustomerRiskEvent_type_createdAt_idx`(`type`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerBlocklistEntry` (
    `id` VARCHAR(30) NOT NULL,
    `customerId` VARCHAR(30) NULL,
    `phoneHash` CHAR(64) NULL,
    `emailHash` CHAR(64) NULL,
    `status` ENUM('ACTIVE', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `permanent` BOOLEAN NOT NULL DEFAULT false,
    `reasonCode` VARCHAR(80) NOT NULL,
    `reasonDetail` VARCHAR(500) NULL,
    `startsAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(30) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedBy` VARCHAR(30) NULL,

    INDEX `CustomerBlocklistEntry_customerId_status_idx`(`customerId`, `status`),
    INDEX `CustomerBlocklistEntry_phoneHash_status_idx`(`phoneHash`, `status`),
    INDEX `CustomerBlocklistEntry_emailHash_status_idx`(`emailHash`, `status`),
    INDEX `CustomerBlocklistEntry_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerDataExportRequest` (
    `id` VARCHAR(30) NOT NULL,
    `customerId` VARCHAR(30) NOT NULL,
    `status` ENUM('REQUESTED', 'IDENTITY_VERIFICATION', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'REQUESTED',
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `processedBy` VARCHAR(30) NULL,
    `objectKey` VARCHAR(1024) NULL,
    `expiresAt` DATETIME(3) NULL,
    `rejectionReason` VARCHAR(500) NULL,

    INDEX `CustomerDataExportRequest_customerId_requestedAt_idx`(`customerId`, `requestedAt`),
    INDEX `CustomerDataExportRequest_status_dueAt_idx`(`status`, `dueAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerDeletionRequest` (
    `id` VARCHAR(30) NOT NULL,
    `customerId` VARCHAR(30) NOT NULL,
    `status` ENUM('REQUESTED', 'IDENTITY_VERIFICATION', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'REQUESTED',
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `processedBy` VARCHAR(30) NULL,
    `retainedFields` JSON NULL,
    `rejectionReason` VARCHAR(500) NULL,

    INDEX `CustomerDeletionRequest_customerId_requestedAt_idx`(`customerId`, `requestedAt`),
    INDEX `CustomerDeletionRequest_status_dueAt_idx`(`status`, `dueAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Brand` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `slug` VARCHAR(180) NOT NULL,
    `descriptionFr` TEXT NULL,
    `descriptionAr` TEXT NULL,
    `publicationStatus` ENUM('DRAFT', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `suspendedAt` DATETIME(3) NULL,
    `archivedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Brand_slug_key`(`slug`),
    INDEX `Brand_publicationStatus_deletedAt_idx`(`publicationStatus`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Category` (
    `id` VARCHAR(30) NOT NULL,
    `parentId` VARCHAR(30) NULL,
    `nameFr` VARCHAR(160) NOT NULL,
    `nameAr` VARCHAR(160) NOT NULL,
    `slug` VARCHAR(180) NOT NULL,
    `descriptionFr` TEXT NULL,
    `descriptionAr` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `publicationStatus` ENUM('DRAFT', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `suspendedAt` DATETIME(3) NULL,
    `archivedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Category_slug_key`(`slug`),
    INDEX `Category_parentId_sortOrder_idx`(`parentId`, `sortOrder`),
    INDEX `Category_publicationStatus_deletedAt_idx`(`publicationStatus`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Product` (
    `id` VARCHAR(30) NOT NULL,
    `brandId` VARCHAR(30) NULL,
    `categoryId` VARCHAR(30) NOT NULL,
    `nameFr` VARCHAR(240) NOT NULL,
    `nameAr` VARCHAR(240) NOT NULL,
    `slug` VARCHAR(260) NOT NULL,
    `sku` VARCHAR(100) NULL,
    `barcode` VARCHAR(100) NULL,
    `productType` ENUM('DEVICE', 'E_LIQUID', 'POD', 'COIL', 'DISPOSABLE', 'ACCESSORY', 'OTHER') NOT NULL,
    `shortDescriptionFr` VARCHAR(1000) NULL,
    `shortDescriptionAr` VARCHAR(1000) NULL,
    `descriptionFr` LONGTEXT NULL,
    `descriptionAr` LONGTEXT NULL,
    `containsNicotine` BOOLEAN NOT NULL DEFAULT false,
    `nicotineStrengthMg` DECIMAL(8, 3) NULL,
    `flavor` VARCHAR(160) NULL,
    `deviceType` VARCHAR(160) NULL,
    `puffCount` INTEGER NULL,
    `coilResistanceOhm` DECIMAL(8, 3) NULL,
    `liquidCapacityMl` DECIMAL(8, 3) NULL,
    `deviceCompatibility` VARCHAR(500) NULL,
    `baseCostMillimes` INTEGER NULL,
    `basePriceMillimes` INTEGER NULL,
    `promotionalPriceMillimes` INTEGER NULL,
    `taxCategory` VARCHAR(80) NULL,
    `taxRateBps` INTEGER NOT NULL DEFAULT 0,
    `warningFr` TEXT NULL,
    `warningAr` TEXT NULL,
    `minimumAge` INTEGER NULL,
    `publicationStatus` ENUM('DRAFT', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `seoTitleFr` VARCHAR(255) NULL,
    `seoTitleAr` VARCHAR(255) NULL,
    `seoDescriptionFr` VARCHAR(500) NULL,
    `seoDescriptionAr` VARCHAR(500) NULL,
    `publishedAt` DATETIME(3) NULL,
    `suspendedAt` DATETIME(3) NULL,
    `archivedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Product_slug_key`(`slug`),
    UNIQUE INDEX `Product_sku_key`(`sku`),
    UNIQUE INDEX `Product_barcode_key`(`barcode`),
    INDEX `Product_publicationStatus_publishedAt_idx`(`publicationStatus`, `publishedAt`),
    INDEX `Product_categoryId_publicationStatus_idx`(`categoryId`, `publicationStatus`),
    INDEX `Product_brandId_publicationStatus_idx`(`brandId`, `publicationStatus`),
    INDEX `Product_featured_publicationStatus_idx`(`featured`, `publicationStatus`),
    INDEX `Product_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductVariant` (
    `id` VARCHAR(30) NOT NULL,
    `productId` VARCHAR(30) NOT NULL,
    `nameFr` VARCHAR(200) NOT NULL,
    `nameAr` VARCHAR(200) NOT NULL,
    `sku` VARCHAR(100) NOT NULL,
    `barcode` VARCHAR(100) NULL,
    `color` VARCHAR(100) NULL,
    `costMillimes` INTEGER NOT NULL,
    `priceMillimes` INTEGER NOT NULL,
    `promotionalPriceMillimes` INTEGER NULL,
    `taxRateBps` INTEGER NOT NULL DEFAULT 0,
    `weightGrams` INTEGER NOT NULL DEFAULT 0,
    `lengthMm` INTEGER NULL,
    `widthMm` INTEGER NULL,
    `heightMm` INTEGER NULL,
    `lowStockThreshold` INTEGER NOT NULL DEFAULT 0,
    `publicationStatus` ENUM('DRAFT', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `archivedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProductVariant_sku_key`(`sku`),
    UNIQUE INDEX `ProductVariant_barcode_key`(`barcode`),
    INDEX `ProductVariant_productId_publicationStatus_sortOrder_idx`(`productId`, `publicationStatus`, `sortOrder`),
    INDEX `ProductVariant_publicationStatus_deletedAt_idx`(`publicationStatus`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductImage` (
    `id` VARCHAR(30) NOT NULL,
    `productId` VARCHAR(30) NULL,
    `variantId` VARCHAR(30) NULL,
    `objectKey` VARCHAR(1024) NOT NULL,
    `objectKeyHash` CHAR(64) NOT NULL,
    `bucket` VARCHAR(120) NOT NULL,
    `contentType` VARCHAR(100) NOT NULL,
    `byteSize` INTEGER NOT NULL,
    `checksumSha256` CHAR(64) NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `altTextFr` VARCHAR(300) NOT NULL,
    `altTextAr` VARCHAR(300) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `moderationStatus` ENUM('PENDING', 'APPROVED', 'REJECTED', 'QUARANTINED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ProductImage_objectKeyHash_key`(`objectKeyHash`),
    INDEX `ProductImage_productId_sortOrder_idx`(`productId`, `sortOrder`),
    INDEX `ProductImage_variantId_sortOrder_idx`(`variantId`, `sortOrder`),
    INDEX `ProductImage_moderationStatus_createdAt_idx`(`moderationStatus`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductAttribute` (
    `id` VARCHAR(30) NOT NULL,
    `productId` VARCHAR(30) NOT NULL,
    `key` VARCHAR(80) NOT NULL,
    `nameFr` VARCHAR(120) NOT NULL,
    `nameAr` VARCHAR(120) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `ProductAttribute_productId_sortOrder_idx`(`productId`, `sortOrder`),
    UNIQUE INDEX `ProductAttribute_productId_key_key`(`productId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductAttributeValue` (
    `id` VARCHAR(30) NOT NULL,
    `attributeId` VARCHAR(30) NOT NULL,
    `valueFr` VARCHAR(160) NOT NULL,
    `valueAr` VARCHAR(160) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `ProductAttributeValue_attributeId_sortOrder_idx`(`attributeId`, `sortOrder`),
    UNIQUE INDEX `ProductAttributeValue_attributeId_valueFr_key`(`attributeId`, `valueFr`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductVariantAttribute` (
    `variantId` VARCHAR(30) NOT NULL,
    `attributeValueId` VARCHAR(30) NOT NULL,

    INDEX `ProductVariantAttribute_attributeValueId_idx`(`attributeValueId`),
    PRIMARY KEY (`variantId`, `attributeValueId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Supplier` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `code` VARCHAR(80) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `contactName` VARCHAR(160) NULL,
    `phoneE164` VARCHAR(16) NULL,
    `email` VARCHAR(320) NULL,
    `taxIdentifier` VARCHAR(100) NULL,
    `address` VARCHAR(500) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Supplier_code_key`(`code`),
    INDEX `Supplier_status_name_idx`(`status`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductSupplier` (
    `productId` VARCHAR(30) NOT NULL,
    `supplierId` VARCHAR(30) NOT NULL,
    `supplierReference` VARCHAR(160) NULL,
    `supplierCostMillimes` INTEGER NULL,
    `preferred` BOOLEAN NOT NULL DEFAULT false,
    `leadTimeDays` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProductSupplier_supplierId_preferred_idx`(`supplierId`, `preferred`),
    PRIMARY KEY (`productId`, `supplierId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductBatch` (
    `id` VARCHAR(30) NOT NULL,
    `variantId` VARCHAR(30) NOT NULL,
    `supplierId` VARCHAR(30) NULL,
    `batchNumber` VARCHAR(120) NOT NULL,
    `supplierReference` VARCHAR(160) NULL,
    `manufacturedAt` DATE NULL,
    `expiryDate` DATE NULL,
    `receivedAt` DATETIME(3) NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProductBatch_expiryDate_archivedAt_idx`(`expiryDate`, `archivedAt`),
    INDEX `ProductBatch_supplierId_supplierReference_idx`(`supplierId`, `supplierReference`),
    UNIQUE INDEX `ProductBatch_variantId_batchNumber_key`(`variantId`, `batchNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryLocation` (
    `id` VARCHAR(30) NOT NULL,
    `code` VARCHAR(80) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `address` VARCHAR(500) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `fulfillsOrders` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InventoryLocation_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryItem` (
    `id` VARCHAR(30) NOT NULL,
    `variantId` VARCHAR(30) NOT NULL,
    `locationId` VARCHAR(30) NOT NULL,
    `batchId` VARCHAR(30) NULL,
    `lotKey` VARCHAR(120) NOT NULL DEFAULT 'UNBATCHED',
    `onHandQuantity` INTEGER NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `InventoryItem_variantId_locationId_idx`(`variantId`, `locationId`),
    INDEX `InventoryItem_locationId_onHandQuantity_idx`(`locationId`, `onHandQuantity`),
    INDEX `InventoryItem_batchId_idx`(`batchId`),
    UNIQUE INDEX `InventoryItem_variantId_locationId_lotKey_key`(`variantId`, `locationId`, `lotKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockMovement` (
    `id` VARCHAR(30) NOT NULL,
    `inventoryItemId` VARCHAR(30) NOT NULL,
    `locationId` VARCHAR(30) NOT NULL,
    `batchId` VARCHAR(30) NULL,
    `type` ENUM('INITIAL_STOCK', 'PURCHASE_RECEIPT', 'MANUAL_ADJUSTMENT', 'RESERVATION', 'RESERVATION_RELEASE', 'ORDER_CONFIRMED', 'ORDER_CANCELLED', 'DELIVERY_REFUSED_RETURN', 'DELIVERY_FAILED_RETURN', 'CUSTOMER_RETURN', 'DAMAGE', 'EXPIRY', 'TRANSFER_IN', 'TRANSFER_OUT') NOT NULL,
    `quantityDelta` INTEGER NOT NULL,
    `onHandAfter` INTEGER NOT NULL,
    `referenceType` VARCHAR(80) NULL,
    `referenceId` VARCHAR(30) NULL,
    `reasonCode` VARCHAR(80) NULL,
    `note` VARCHAR(1000) NULL,
    `actorUserId` VARCHAR(30) NULL,
    `requestId` VARCHAR(100) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StockMovement_inventoryItemId_occurredAt_idx`(`inventoryItemId`, `occurredAt`),
    INDEX `StockMovement_type_occurredAt_idx`(`type`, `occurredAt`),
    INDEX `StockMovement_referenceType_referenceId_idx`(`referenceType`, `referenceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockReservation` (
    `id` VARCHAR(30) NOT NULL,
    `inventoryItemId` VARCHAR(30) NOT NULL,
    `sourceType` ENUM('CART', 'CHECKOUT', 'ORDER') NOT NULL,
    `sourceId` VARCHAR(30) NOT NULL,
    `activeKey` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `state` ENUM('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `orderId` VARCHAR(30) NULL,
    `orderItemId` VARCHAR(30) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,
    `releaseReason` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StockReservation_activeKey_key`(`activeKey`),
    INDEX `StockReservation_inventoryItemId_state_expiresAt_idx`(`inventoryItemId`, `state`, `expiresAt`),
    INDEX `StockReservation_state_expiresAt_idx`(`state`, `expiresAt`),
    INDEX `StockReservation_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    INDEX `StockReservation_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryAdjustment` (
    `id` VARCHAR(30) NOT NULL,
    `inventoryItemId` VARCHAR(30) NOT NULL,
    `quantityDelta` INTEGER NOT NULL,
    `reasonCode` VARCHAR(80) NOT NULL,
    `note` VARCHAR(1000) NULL,
    `status` ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'APPLIED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    `requestedBy` VARCHAR(30) NOT NULL,
    `approvedBy` VARCHAR(30) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decidedAt` DATETIME(3) NULL,
    `appliedAt` DATETIME(3) NULL,
    `stockMovementId` VARCHAR(30) NULL,

    UNIQUE INDEX `InventoryAdjustment_stockMovementId_key`(`stockMovementId`),
    INDEX `InventoryAdjustment_status_requestedAt_idx`(`status`, `requestedAt`),
    INDEX `InventoryAdjustment_inventoryItemId_requestedAt_idx`(`inventoryItemId`, `requestedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Cart` (
    `id` VARCHAR(30) NOT NULL,
    `customerId` VARCHAR(30) NULL,
    `guestTokenHash` CHAR(64) NULL,
    `status` ENUM('ACTIVE', 'CONVERTED', 'ABANDONED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `currency` CHAR(3) NOT NULL DEFAULT 'TND',
    `expiresAt` DATETIME(3) NULL,
    `convertedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Cart_guestTokenHash_key`(`guestTokenHash`),
    INDEX `Cart_customerId_status_idx`(`customerId`, `status`),
    INDEX `Cart_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CartItem` (
    `id` VARCHAR(30) NOT NULL,
    `cartId` VARCHAR(30) NOT NULL,
    `variantId` VARCHAR(30) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CartItem_variantId_idx`(`variantId`),
    UNIQUE INDEX `CartItem_cartId_variantId_key`(`cartId`, `variantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Wishlist` (
    `id` VARCHAR(30) NOT NULL,
    `customerId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL DEFAULT 'default',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Wishlist_customerId_name_key`(`customerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WishlistItem` (
    `wishlistId` VARCHAR(30) NOT NULL,
    `variantId` VARCHAR(30) NOT NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WishlistItem_variantId_idx`(`variantId`),
    PRIMARY KEY (`wishlistId`, `variantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Promotion` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `type` ENUM('FIXED_AMOUNT', 'PERCENTAGE', 'FREE_DELIVERY') NOT NULL,
    `amountMillimes` INTEGER NULL,
    `percentageBps` INTEGER NULL,
    `minimumOrderMillimes` INTEGER NULL,
    `maximumDiscountMillimes` INTEGER NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NULL,
    `globalUsageLimit` INTEGER NULL,
    `perCustomerUsageLimit` INTEGER NULL,
    `automatic` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `stackingRule` ENUM('EXCLUSIVE', 'STACKABLE', 'BEST_VALUE_ONLY') NOT NULL DEFAULT 'EXCLUSIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Promotion_active_startsAt_endsAt_idx`(`active`, `startsAt`, `endsAt`),
    INDEX `Promotion_automatic_priority_idx`(`automatic`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Coupon` (
    `id` VARCHAR(30) NOT NULL,
    `promotionId` VARCHAR(30) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `globalUsageLimit` INTEGER NULL,
    `perCustomerUsageLimit` INTEGER NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Coupon_code_key`(`code`),
    INDEX `Coupon_status_startsAt_endsAt_idx`(`status`, `startsAt`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromotionProduct` (
    `promotionId` VARCHAR(30) NOT NULL,
    `productId` VARCHAR(30) NOT NULL,
    `excluded` BOOLEAN NOT NULL DEFAULT false,

    INDEX `PromotionProduct_productId_excluded_idx`(`productId`, `excluded`),
    PRIMARY KEY (`promotionId`, `productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromotionCategory` (
    `promotionId` VARCHAR(30) NOT NULL,
    `categoryId` VARCHAR(30) NOT NULL,
    `excluded` BOOLEAN NOT NULL DEFAULT false,

    INDEX `PromotionCategory_categoryId_excluded_idx`(`categoryId`, `excluded`),
    PRIMARY KEY (`promotionId`, `categoryId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromotionBrand` (
    `promotionId` VARCHAR(30) NOT NULL,
    `brandId` VARCHAR(30) NOT NULL,
    `excluded` BOOLEAN NOT NULL DEFAULT false,

    INDEX `PromotionBrand_brandId_excluded_idx`(`brandId`, `excluded`),
    PRIMARY KEY (`promotionId`, `brandId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromotionRedemption` (
    `id` VARCHAR(30) NOT NULL,
    `promotionId` VARCHAR(30) NOT NULL,
    `couponId` VARCHAR(30) NULL,
    `customerId` VARCHAR(30) NULL,
    `orderId` VARCHAR(30) NOT NULL,
    `discountMillimes` INTEGER NOT NULL,
    `redeemedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PromotionRedemption_promotionId_redeemedAt_idx`(`promotionId`, `redeemedAt`),
    INDEX `PromotionRedemption_couponId_customerId_redeemedAt_idx`(`couponId`, `customerId`, `redeemedAt`),
    INDEX `PromotionRedemption_customerId_redeemedAt_idx`(`customerId`, `redeemedAt`),
    UNIQUE INDEX `PromotionRedemption_orderId_promotionId_couponId_key`(`orderId`, `promotionId`, `couponId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Governorate` (
    `id` VARCHAR(30) NOT NULL,
    `code` CHAR(2) NOT NULL,
    `nameFr` VARCHAR(100) NOT NULL,
    `nameAr` VARCHAR(100) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `Governorate_code_key`(`code`),
    UNIQUE INDEX `Governorate_nameFr_key`(`nameFr`),
    INDEX `Governorate_active_nameFr_idx`(`active`, `nameFr`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Delegation` (
    `id` VARCHAR(30) NOT NULL,
    `governorateId` VARCHAR(30) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `nameFr` VARCHAR(120) NOT NULL,
    `nameAr` VARCHAR(120) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `Delegation_governorateId_active_nameFr_idx`(`governorateId`, `active`, `nameFr`),
    UNIQUE INDEX `Delegation_governorateId_code_key`(`governorateId`, `code`),
    UNIQUE INDEX `Delegation_governorateId_nameFr_key`(`governorateId`, `nameFr`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Locality` (
    `id` VARCHAR(30) NOT NULL,
    `delegationId` VARCHAR(30) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `nameFr` VARCHAR(160) NOT NULL,
    `nameAr` VARCHAR(160) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `Locality_delegationId_active_nameFr_idx`(`delegationId`, `active`, `nameFr`),
    UNIQUE INDEX `Locality_delegationId_code_key`(`delegationId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostalCode` (
    `id` VARCHAR(30) NOT NULL,
    `localityId` VARCHAR(30) NOT NULL,
    `code` CHAR(4) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `PostalCode_code_active_idx`(`code`, `active`),
    UNIQUE INDEX `PostalCode_localityId_code_key`(`localityId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryZone` (
    `id` VARCHAR(30) NOT NULL,
    `code` VARCHAR(80) NOT NULL,
    `nameFr` VARCHAR(160) NOT NULL,
    `nameAr` VARCHAR(160) NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `supported` BOOLEAN NOT NULL DEFAULT true,
    `temporarilySuspended` BOOLEAN NOT NULL DEFAULT false,
    `phoneConfirmationRequired` BOOLEAN NOT NULL DEFAULT false,
    `manualReviewRequired` BOOLEAN NOT NULL DEFAULT false,
    `manualQuoteAllowed` BOOLEAN NOT NULL DEFAULT false,
    `minOrderMillimes` INTEGER NULL,
    `maxCodMillimes` INTEGER NULL,
    `freeDeliveryThresholdMillimes` INTEGER NULL,
    `estimatedMinDays` INTEGER NULL,
    `estimatedMaxDays` INTEGER NULL,
    `availableDays` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DeliveryZone_code_key`(`code`),
    INDEX `DeliveryZone_active_supported_priority_idx`(`active`, `supported`, `priority`),
    INDEX `DeliveryZone_temporarilySuspended_idx`(`temporarilySuspended`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryZoneLocality` (
    `deliveryZoneId` VARCHAR(30) NOT NULL,
    `localityId` VARCHAR(30) NOT NULL,
    `priorityOverride` INTEGER NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `DeliveryZoneLocality_localityId_active_idx`(`localityId`, `active`),
    PRIMARY KEY (`deliveryZoneId`, `localityId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryRate` (
    `id` VARCHAR(30) NOT NULL,
    `deliveryZoneId` VARCHAR(30) NULL,
    `governorateId` VARCHAR(30) NULL,
    `delegationId` VARCHAR(30) NULL,
    `localityId` VARCHAR(30) NULL,
    `type` ENUM('BASE', 'GOVERNORATE', 'DELEGATION', 'LOCALITY', 'REMOTE_SURCHARGE', 'WEIGHT_SURCHARGE', 'OVERSIZE_SURCHARGE', 'EXPRESS_SURCHARGE') NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `feeMillimes` INTEGER NOT NULL,
    `minWeightGrams` INTEGER NULL,
    `maxWeightGrams` INTEGER NULL,
    `minOrderMillimes` INTEGER NULL,
    `maxOrderMillimes` INTEGER NULL,
    `maxCodMillimes` INTEGER NULL,
    `express` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `validFrom` DATETIME(3) NULL,
    `validUntil` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DeliveryRate_active_type_priority_idx`(`active`, `type`, `priority`),
    INDEX `DeliveryRate_deliveryZoneId_active_priority_idx`(`deliveryZoneId`, `active`, `priority`),
    INDEX `DeliveryRate_governorateId_delegationId_localityId_active_idx`(`governorateId`, `delegationId`, `localityId`, `active`),
    INDEX `DeliveryRate_validFrom_validUntil_idx`(`validFrom`, `validUntil`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryTimeWindow` (
    `id` VARCHAR(30) NOT NULL,
    `deliveryZoneId` VARCHAR(30) NULL,
    `pickupLocationId` VARCHAR(30) NULL,
    `code` VARCHAR(80) NOT NULL,
    `labelFr` VARCHAR(120) NOT NULL,
    `labelAr` VARCHAR(120) NOT NULL,
    `dayOfWeek` ENUM('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY') NULL,
    `startsAt` TIME(0) NOT NULL,
    `endsAt` TIME(0) NOT NULL,
    `capacity` INTEGER NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `DeliveryTimeWindow_code_key`(`code`),
    INDEX `DeliveryTimeWindow_deliveryZoneId_dayOfWeek_active_idx`(`deliveryZoneId`, `dayOfWeek`, `active`),
    INDEX `DeliveryTimeWindow_pickupLocationId_dayOfWeek_active_idx`(`pickupLocationId`, `dayOfWeek`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryBlackoutDate` (
    `id` VARCHAR(30) NOT NULL,
    `deliveryZoneId` VARCHAR(30) NULL,
    `pickupLocationId` VARCHAR(30) NULL,
    `date` DATE NOT NULL,
    `reason` VARCHAR(255) NULL,

    INDEX `DeliveryBlackoutDate_date_idx`(`date`),
    UNIQUE INDEX `DeliveryBlackoutDate_deliveryZoneId_pickupLocationId_date_key`(`deliveryZoneId`, `pickupLocationId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PickupLocation` (
    `id` VARCHAR(30) NOT NULL,
    `inventoryLocationId` VARCHAR(30) NULL,
    `code` VARCHAR(80) NOT NULL,
    `nameFr` VARCHAR(160) NOT NULL,
    `nameAr` VARCHAR(160) NOT NULL,
    `address` VARCHAR(500) NOT NULL,
    `phoneE164` VARCHAR(16) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `minOrderMillimes` INTEGER NULL,
    `maxCodMillimes` INTEGER NULL,
    `openingHours` JSON NULL,

    UNIQUE INDEX `PickupLocation_code_key`(`code`),
    INDEX `PickupLocation_active_nameFr_idx`(`active`, `nameFr`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(30) NOT NULL,
    `orderNumber` VARCHAR(30) NOT NULL,
    `customerId` VARCHAR(30) NULL,
    `cartId` VARCHAR(30) NULL,
    `customerNameSnapshot` VARCHAR(200) NOT NULL,
    `customerPhoneSnapshot` VARCHAR(16) NOT NULL,
    `customerEmailSnapshot` VARCHAR(320) NULL,
    `status` ENUM('PENDING_CONFIRMATION', 'CONFIRMED', 'ON_HOLD', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_COURIER', 'HANDED_TO_COURIER', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED', 'RESCHEDULED', 'DELIVERED', 'REFUSED', 'FAILED', 'RETURN_TO_SENDER', 'RETURNED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    `paymentStatus` ENUM('PAYMENT_PENDING', 'CASH_EXPECTED', 'CASH_COLLECTED_BY_COURIER', 'CASH_COLLECTED_AT_STORE', 'CASH_PARTIALLY_COLLECTED', 'CASH_REMITTED', 'RECONCILIATION_DISCREPANCY', 'REFUNDED', 'CANCELLED') NOT NULL DEFAULT 'CASH_EXPECTED',
    `currency` CHAR(3) NOT NULL DEFAULT 'TND',
    `subtotalMillimes` INTEGER NOT NULL,
    `discountTotalMillimes` INTEGER NOT NULL DEFAULT 0,
    `deliveryTotalMillimes` INTEGER NOT NULL DEFAULT 0,
    `taxTotalMillimes` INTEGER NOT NULL DEFAULT 0,
    `grandTotalMillimes` INTEGER NOT NULL,
    `expectedCodMillimes` INTEGER NOT NULL,
    `deliveryMethodType` ENUM('COURIER', 'STORE_PICKUP', 'MANUAL_QUOTE') NOT NULL,
    `deliveryMethodSnapshot` VARCHAR(200) NOT NULL,
    `deliveryZoneId` VARCHAR(30) NULL,
    `deliveryRateId` VARCHAR(30) NULL,
    `pickupLocationId` VARCHAR(30) NULL,
    `deliveryTimeWindowId` VARCHAR(30) NULL,
    `deliveryFeeRuleSnapshot` JSON NULL,
    `promotionSnapshot` JSON NULL,
    `preferredDeliveryDate` DATE NULL,
    `deliveryInstructions` VARCHAR(1000) NULL,
    `ageConfirmedAt` DATETIME(3) NOT NULL,
    `minimumAgeSnapshot` INTEGER NOT NULL,
    `ageVerificationAtDeliveryRequired` BOOLEAN NOT NULL DEFAULT false,
    `phoneConfirmationRequired` BOOLEAN NOT NULL DEFAULT false,
    `manualReviewRequired` BOOLEAN NOT NULL DEFAULT false,
    `confirmedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancellationReason` VARCHAR(500) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Order_orderNumber_key`(`orderNumber`),
    INDEX `Order_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `Order_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Order_paymentStatus_createdAt_idx`(`paymentStatus`, `createdAt`),
    INDEX `Order_customerPhoneSnapshot_createdAt_idx`(`customerPhoneSnapshot`, `createdAt`),
    INDEX `Order_deliveryZoneId_createdAt_idx`(`deliveryZoneId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderItem` (
    `id` VARCHAR(30) NOT NULL,
    `orderId` VARCHAR(30) NOT NULL,
    `productId` VARCHAR(30) NULL,
    `variantId` VARCHAR(30) NULL,
    `productNameSnapshot` VARCHAR(240) NOT NULL,
    `variantNameSnapshot` VARCHAR(200) NOT NULL,
    `skuSnapshot` VARCHAR(100) NOT NULL,
    `barcodeSnapshot` VARCHAR(100) NULL,
    `warningSnapshotFr` TEXT NULL,
    `warningSnapshotAr` TEXT NULL,
    `unitPriceMillimes` INTEGER NOT NULL,
    `unitDiscountMillimes` INTEGER NOT NULL DEFAULT 0,
    `taxRateBpsSnapshot` INTEGER NOT NULL DEFAULT 0,
    `unitTaxMillimes` INTEGER NOT NULL DEFAULT 0,
    `quantity` INTEGER NOT NULL,
    `lineSubtotalMillimes` INTEGER NOT NULL,
    `lineDiscountMillimes` INTEGER NOT NULL DEFAULT 0,
    `lineTaxMillimes` INTEGER NOT NULL DEFAULT 0,
    `lineTotalMillimes` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderItem_orderId_idx`(`orderId`),
    INDEX `OrderItem_productId_idx`(`productId`),
    INDEX `OrderItem_variantId_idx`(`variantId`),
    INDEX `OrderItem_skuSnapshot_idx`(`skuSnapshot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderAddressSnapshot` (
    `id` VARCHAR(30) NOT NULL,
    `orderId` VARCHAR(30) NOT NULL,
    `type` ENUM('DELIVERY', 'PICKUP_CONTACT') NOT NULL DEFAULT 'DELIVERY',
    `fullName` VARCHAR(200) NOT NULL,
    `phoneE164` VARCHAR(16) NOT NULL,
    `governorateId` VARCHAR(30) NULL,
    `delegationId` VARCHAR(30) NULL,
    `localityId` VARCHAR(30) NULL,
    `governorateName` VARCHAR(120) NOT NULL,
    `delegationName` VARCHAR(120) NOT NULL,
    `localityName` VARCHAR(160) NULL,
    `postalCode` VARCHAR(10) NULL,
    `street` VARCHAR(255) NOT NULL,
    `building` VARCHAR(100) NULL,
    `floor` VARCHAR(30) NULL,
    `apartment` VARCHAR(30) NULL,
    `landmark` VARCHAR(255) NULL,
    `instructions` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderAddressSnapshot_governorateId_delegationId_localityId_idx`(`governorateId`, `delegationId`, `localityId`),
    UNIQUE INDEX `OrderAddressSnapshot_orderId_type_key`(`orderId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderStatusHistory` (
    `id` VARCHAR(30) NOT NULL,
    `orderId` VARCHAR(30) NOT NULL,
    `fromStatus` ENUM('PENDING_CONFIRMATION', 'CONFIRMED', 'ON_HOLD', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_COURIER', 'HANDED_TO_COURIER', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED', 'RESCHEDULED', 'DELIVERED', 'REFUSED', 'FAILED', 'RETURN_TO_SENDER', 'RETURNED', 'CANCELLED') NULL,
    `toStatus` ENUM('PENDING_CONFIRMATION', 'CONFIRMED', 'ON_HOLD', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_COURIER', 'HANDED_TO_COURIER', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED', 'RESCHEDULED', 'DELIVERED', 'REFUSED', 'FAILED', 'RETURN_TO_SENDER', 'RETURNED', 'CANCELLED') NOT NULL,
    `reasonCode` VARCHAR(80) NULL,
    `note` VARCHAR(1000) NULL,
    `changedByUserId` VARCHAR(30) NULL,
    `requestId` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderStatusHistory_orderId_createdAt_idx`(`orderId`, `createdAt`),
    INDEX `OrderStatusHistory_toStatus_createdAt_idx`(`toStatus`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderNote` (
    `id` VARCHAR(30) NOT NULL,
    `orderId` VARCHAR(30) NOT NULL,
    `authorUserId` VARCHAR(30) NULL,
    `visibility` ENUM('INTERNAL', 'CUSTOMER_VISIBLE', 'COURIER_VISIBLE') NOT NULL DEFAULT 'INTERNAL',
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderNote_orderId_createdAt_idx`(`orderId`, `createdAt`),
    INDEX `OrderNote_authorUserId_createdAt_idx`(`authorUserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderConsentSnapshot` (
    `id` VARCHAR(30) NOT NULL,
    `orderId` VARCHAR(30) NOT NULL,
    `consentType` ENUM('AGE_GATE', 'CHECKOUT_AGE_CONFIRMATION', 'TERMS', 'PRIVACY', 'MARKETING_EMAIL', 'MARKETING_SMS', 'COOKIE_PREFERENCES') NOT NULL,
    `granted` BOOLEAN NOT NULL,
    `legalDocumentVersionId` VARCHAR(30) NULL,
    `documentTitleSnapshot` VARCHAR(255) NULL,
    `documentVersionSnapshot` INTEGER NULL,
    `contentHashSnapshot` CHAR(64) NULL,
    `consentedAt` DATETIME(3) NOT NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,

    INDEX `OrderConsentSnapshot_legalDocumentVersionId_idx`(`legalDocumentVersionId`),
    UNIQUE INDEX `OrderConsentSnapshot_orderId_consentType_key`(`orderId`, `consentType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderDiscount` (
    `id` VARCHAR(30) NOT NULL,
    `orderId` VARCHAR(30) NOT NULL,
    `promotionId` VARCHAR(30) NULL,
    `couponId` VARCHAR(30) NULL,
    `nameSnapshot` VARCHAR(200) NOT NULL,
    `codeSnapshot` VARCHAR(100) NULL,
    `ruleSnapshot` JSON NOT NULL,
    `amountMillimes` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderDiscount_orderId_idx`(`orderId`),
    INDEX `OrderDiscount_promotionId_idx`(`promotionId`),
    INDEX `OrderDiscount_couponId_idx`(`couponId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderIdempotencyKey` (
    `id` VARCHAR(30) NOT NULL,
    `keyHash` CHAR(64) NOT NULL,
    `audienceScope` VARCHAR(100) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `orderId` VARCHAR(30) NULL,
    `lockedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OrderIdempotencyKey_keyHash_key`(`keyHash`),
    UNIQUE INDEX `OrderIdempotencyKey_orderId_key`(`orderId`),
    INDEX `OrderIdempotencyKey_expiresAt_completedAt_idx`(`expiresAt`, `completedAt`),
    INDEX `OrderIdempotencyKey_audienceScope_lockedAt_idx`(`audienceScope`, `lockedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SequenceCounter` (
    `key` VARCHAR(80) NOT NULL,
    `value` BIGINT NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Courier` (
    `id` VARCHAR(30) NOT NULL,
    `code` VARCHAR(80) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `contactName` VARCHAR(160) NULL,
    `phoneE164` VARCHAR(16) NULL,
    `email` VARCHAR(320) NULL,
    `feeRules` JSON NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Courier_code_key`(`code`),
    INDEX `Courier_status_name_idx`(`status`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CourierUser` (
    `courierId` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CourierUser_userId_active_idx`(`userId`, `active`),
    PRIMARY KEY (`courierId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CourierIntegration` (
    `id` VARCHAR(30) NOT NULL,
    `courierId` VARCHAR(30) NOT NULL,
    `type` ENUM('MANUAL', 'API', 'CSV') NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `encryptedCredentials` LONGTEXT NULL,
    `configuration` JSON NULL,
    `lastHealthCheckAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CourierIntegration_courierId_active_idx`(`courierId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Delivery` (
    `id` VARCHAR(30) NOT NULL,
    `orderId` VARCHAR(30) NOT NULL,
    `courierId` VARCHAR(30) NULL,
    `status` ENUM('PENDING_CONFIRMATION', 'CONFIRMED', 'ON_HOLD', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_COURIER', 'HANDED_TO_COURIER', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED', 'RESCHEDULED', 'DELIVERED', 'REFUSED', 'FAILED', 'RETURN_TO_SENDER', 'RETURNED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    `trackingNumber` VARCHAR(120) NULL,
    `courierFeeMillimes` INTEGER NULL,
    `assignedAt` DATETIME(3) NULL,
    `handedToCourierAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `nextAttemptAt` DATETIME(3) NULL,
    `internalNotes` TEXT NULL,
    `customerVisibleNotes` TEXT NULL,
    `ageVerificationRequired` BOOLEAN NOT NULL DEFAULT false,
    `ageVerificationResult` ENUM('NOT_REQUIRED', 'PENDING', 'PASSED', 'FAILED', 'REFUSED', 'UNABLE_TO_VERIFY') NOT NULL DEFAULT 'NOT_REQUIRED',
    `cashCollectedResult` BOOLEAN NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Delivery_orderId_key`(`orderId`),
    UNIQUE INDEX `Delivery_trackingNumber_key`(`trackingNumber`),
    INDEX `Delivery_courierId_status_createdAt_idx`(`courierId`, `status`, `createdAt`),
    INDEX `Delivery_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryAttempt` (
    `id` VARCHAR(30) NOT NULL,
    `deliveryId` VARCHAR(30) NOT NULL,
    `attemptNumber` INTEGER NOT NULL,
    `attemptedAt` DATETIME(3) NOT NULL,
    `outcome` ENUM('DELIVERED', 'CUSTOMER_UNAVAILABLE', 'ADDRESS_NOT_FOUND', 'CUSTOMER_REFUSED', 'FAILED_AGE_VERIFICATION', 'PARTIAL_CASH_NOT_ALLOWED', 'RESCHEDULED', 'OTHER_FAILED') NOT NULL,
    `notes` VARCHAR(1000) NULL,
    `nextAttemptAt` DATETIME(3) NULL,
    `ageVerificationResult` ENUM('NOT_REQUIRED', 'PENDING', 'PASSED', 'FAILED', 'REFUSED', 'UNABLE_TO_VERIFY') NOT NULL DEFAULT 'NOT_REQUIRED',
    `cashExpectedMillimes` INTEGER NULL,
    `cashCollectedMillimes` INTEGER NULL,
    `recordedByUserId` VARCHAR(30) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DeliveryAttempt_outcome_attemptedAt_idx`(`outcome`, `attemptedAt`),
    UNIQUE INDEX `DeliveryAttempt_deliveryId_attemptNumber_key`(`deliveryId`, `attemptNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryEvent` (
    `id` VARCHAR(30) NOT NULL,
    `deliveryId` VARCHAR(30) NOT NULL,
    `fromStatus` ENUM('PENDING_CONFIRMATION', 'CONFIRMED', 'ON_HOLD', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_COURIER', 'HANDED_TO_COURIER', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED', 'RESCHEDULED', 'DELIVERED', 'REFUSED', 'FAILED', 'RETURN_TO_SENDER', 'RETURNED', 'CANCELLED') NULL,
    `toStatus` ENUM('PENDING_CONFIRMATION', 'CONFIRMED', 'ON_HOLD', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_COURIER', 'HANDED_TO_COURIER', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED', 'RESCHEDULED', 'DELIVERED', 'REFUSED', 'FAILED', 'RETURN_TO_SENDER', 'RETURNED', 'CANCELLED') NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actorUserId` VARCHAR(30) NULL,
    `source` VARCHAR(80) NOT NULL,
    `reasonCode` VARCHAR(80) NULL,
    `note` VARCHAR(1000) NULL,
    `payload` JSON NULL,
    `requestId` VARCHAR(100) NULL,

    INDEX `DeliveryEvent_deliveryId_occurredAt_idx`(`deliveryId`, `occurredAt`),
    INDEX `DeliveryEvent_toStatus_occurredAt_idx`(`toStatus`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryManifest` (
    `id` VARCHAR(30) NOT NULL,
    `manifestNumber` VARCHAR(60) NOT NULL,
    `courierId` VARCHAR(30) NOT NULL,
    `status` ENUM('DRAFT', 'SEALED', 'HANDED_OVER', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `manifestDate` DATE NOT NULL,
    `createdBy` VARCHAR(30) NOT NULL,
    `sealedAt` DATETIME(3) NULL,
    `handedOverAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DeliveryManifest_manifestNumber_key`(`manifestNumber`),
    INDEX `DeliveryManifest_courierId_status_manifestDate_idx`(`courierId`, `status`, `manifestDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryManifestItem` (
    `manifestId` VARCHAR(30) NOT NULL,
    `deliveryId` VARCHAR(30) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DeliveryManifestItem_deliveryId_idx`(`deliveryId`),
    UNIQUE INDEX `DeliveryManifestItem_manifestId_sequence_key`(`manifestId`, `sequence`),
    PRIMARY KEY (`manifestId`, `deliveryId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShippingLabel` (
    `id` VARCHAR(30) NOT NULL,
    `deliveryId` VARCHAR(30) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `objectKey` VARCHAR(1024) NOT NULL,
    `objectKeyHash` CHAR(64) NOT NULL,
    `checksumSha256` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `voidedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ShippingLabel_objectKeyHash_key`(`objectKeyHash`),
    INDEX `ShippingLabel_deliveryId_voidedAt_idx`(`deliveryId`, `voidedAt`),
    UNIQUE INDEX `ShippingLabel_deliveryId_version_key`(`deliveryId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProofOfDelivery` (
    `id` VARCHAR(30) NOT NULL,
    `deliveryId` VARCHAR(30) NOT NULL,
    `deliveredAt` DATETIME(3) NOT NULL,
    `recipientName` VARCHAR(200) NULL,
    `recipientRelationship` VARCHAR(100) NULL,
    `signatureObjectKey` VARCHAR(1024) NULL,
    `photoObjectKey` VARCHAR(1024) NULL,
    `geolocation` JSON NULL,
    `ageVerificationResult` ENUM('NOT_REQUIRED', 'PENDING', 'PASSED', 'FAILED', 'REFUSED', 'UNABLE_TO_VERIFY') NOT NULL,
    `cashCollectedMillimes` INTEGER NULL,
    `recordedByUserId` VARCHAR(30) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProofOfDelivery_deliveryId_key`(`deliveryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CashCollection` (
    `id` VARCHAR(30) NOT NULL,
    `orderId` VARCHAR(30) NOT NULL,
    `deliveryId` VARCHAR(30) NULL,
    `courierId` VARCHAR(30) NULL,
    `status` ENUM('EXPECTED', 'COLLECTED', 'PARTIALLY_COLLECTED', 'VOIDED', 'REMITTED') NOT NULL DEFAULT 'EXPECTED',
    `expectedMillimes` INTEGER NOT NULL,
    `collectedMillimes` INTEGER NOT NULL DEFAULT 0,
    `collectedByUserId` VARCHAR(30) NULL,
    `collectedAt` DATETIME(3) NULL,
    `method` VARCHAR(40) NOT NULL DEFAULT 'CASH',
    `evidenceObjectKey` VARCHAR(1024) NULL,
    `note` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CashCollection_orderId_status_idx`(`orderId`, `status`),
    INDEX `CashCollection_courierId_status_collectedAt_idx`(`courierId`, `status`, `collectedAt`),
    INDEX `CashCollection_status_collectedAt_idx`(`status`, `collectedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CashRemittance` (
    `id` VARCHAR(30) NOT NULL,
    `remittanceNumber` VARCHAR(60) NOT NULL,
    `courierId` VARCHAR(30) NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'VERIFIED', 'DISCREPANCY', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `declaredMillimes` INTEGER NOT NULL,
    `verifiedMillimes` INTEGER NULL,
    `differenceMillimes` INTEGER NULL,
    `submittedAt` DATETIME(3) NULL,
    `remittedAt` DATETIME(3) NULL,
    `receivedByUserId` VARCHAR(30) NULL,
    `verifiedByUserId` VARCHAR(30) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `evidenceObjectKey` VARCHAR(1024) NULL,
    `note` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CashRemittance_remittanceNumber_key`(`remittanceNumber`),
    INDEX `CashRemittance_courierId_status_createdAt_idx`(`courierId`, `status`, `createdAt`),
    INDEX `CashRemittance_status_remittedAt_idx`(`status`, `remittedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CashRemittanceItem` (
    `id` VARCHAR(30) NOT NULL,
    `remittanceId` VARCHAR(30) NOT NULL,
    `cashCollectionId` VARCHAR(30) NOT NULL,
    `amountMillimes` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CashRemittanceItem_cashCollectionId_idx`(`cashCollectionId`),
    UNIQUE INDEX `CashRemittanceItem_remittanceId_cashCollectionId_key`(`remittanceId`, `cashCollectionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CashDiscrepancy` (
    `id` VARCHAR(30) NOT NULL,
    `remittanceId` VARCHAR(30) NULL,
    `orderId` VARCHAR(30) NULL,
    `status` ENUM('OPEN', 'INVESTIGATING', 'RESOLVED', 'WRITTEN_OFF') NOT NULL DEFAULT 'OPEN',
    `expectedMillimes` INTEGER NOT NULL,
    `actualMillimes` INTEGER NOT NULL,
    `differenceMillimes` INTEGER NOT NULL,
    `reasonCode` VARCHAR(80) NULL,
    `reasonDetail` VARCHAR(1000) NULL,
    `openedByUserId` VARCHAR(30) NOT NULL,
    `resolvedByUserId` VARCHAR(30) NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,
    `evidenceObjectKey` VARCHAR(1024) NULL,

    INDEX `CashDiscrepancy_status_openedAt_idx`(`status`, `openedAt`),
    INDEX `CashDiscrepancy_remittanceId_status_idx`(`remittanceId`, `status`),
    INDEX `CashDiscrepancy_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CashReconciliationEvent` (
    `id` VARCHAR(30) NOT NULL,
    `remittanceId` VARCHAR(30) NULL,
    `type` ENUM('COLLECTION_RECORDED', 'REMITTANCE_SUBMITTED', 'REMITTANCE_VERIFIED', 'DISCREPANCY_OPENED', 'DISCREPANCY_RESOLVED', 'REFUND_RECORDED', 'ADJUSTMENT_RECORDED') NOT NULL,
    `amountMillimes` INTEGER NULL,
    `actorUserId` VARCHAR(30) NOT NULL,
    `summary` VARCHAR(500) NOT NULL,
    `metadata` JSON NULL,
    `requestId` VARCHAR(100) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CashReconciliationEvent_remittanceId_occurredAt_idx`(`remittanceId`, `occurredAt`),
    INDEX `CashReconciliationEvent_type_occurredAt_idx`(`type`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReturnRequest` (
    `id` VARCHAR(30) NOT NULL,
    `returnNumber` VARCHAR(60) NOT NULL,
    `orderId` VARCHAR(30) NOT NULL,
    `customerId` VARCHAR(30) NULL,
    `deliveryId` VARCHAR(30) NULL,
    `createdByUserId` VARCHAR(30) NULL,
    `reason` ENUM('CUSTOMER_REQUEST', 'REFUSED_DELIVERY', 'FAILED_DELIVERY', 'DAMAGED_PARCEL', 'WRONG_PRODUCT', 'DEFECTIVE_PRODUCT', 'RETURN_TO_SENDER', 'OTHER') NOT NULL,
    `reasonDetail` VARCHAR(1000) NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'RECEIVED', 'INSPECTION_REQUIRED', 'INSPECTED', 'PARTIALLY_RESTOCKED', 'RESTOCKED', 'NOT_RESTOCKED', 'REFUND_RECORDED', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'REQUESTED',
    `refundMethod` ENUM('NONE', 'CASH', 'STORE_CREDIT', 'OTHER') NOT NULL DEFAULT 'NONE',
    `refundAmountMillimes` INTEGER NOT NULL DEFAULT 0,
    `refundRecordedAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReturnRequest_returnNumber_key`(`returnNumber`),
    INDEX `ReturnRequest_orderId_createdAt_idx`(`orderId`, `createdAt`),
    INDEX `ReturnRequest_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `ReturnRequest_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReturnItem` (
    `id` VARCHAR(30) NOT NULL,
    `returnRequestId` VARCHAR(30) NOT NULL,
    `orderItemId` VARCHAR(30) NOT NULL,
    `quantityRequested` INTEGER NOT NULL,
    `quantityReceived` INTEGER NOT NULL DEFAULT 0,
    `quantityRestocked` INTEGER NOT NULL DEFAULT 0,
    `restockDecision` ENUM('PENDING_INSPECTION', 'RESTOCK', 'DO_NOT_RESTOCK', 'PARTIAL_RESTOCK') NOT NULL DEFAULT 'PENDING_INSPECTION',
    `inspectionNotes` VARCHAR(1000) NULL,
    `inspectedByUserId` VARCHAR(30) NULL,
    `inspectedAt` DATETIME(3) NULL,
    `inventoryMovementId` VARCHAR(30) NULL,

    INDEX `ReturnItem_orderItemId_idx`(`orderItemId`),
    INDEX `ReturnItem_restockDecision_inspectedAt_idx`(`restockDecision`, `inspectedAt`),
    UNIQUE INDEX `ReturnItem_returnRequestId_orderItemId_key`(`returnRequestId`, `orderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReturnStatusHistory` (
    `id` VARCHAR(30) NOT NULL,
    `returnRequestId` VARCHAR(30) NOT NULL,
    `fromStatus` ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'RECEIVED', 'INSPECTION_REQUIRED', 'INSPECTED', 'PARTIALLY_RESTOCKED', 'RESTOCKED', 'NOT_RESTOCKED', 'REFUND_RECORDED', 'CLOSED', 'CANCELLED') NULL,
    `toStatus` ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'RECEIVED', 'INSPECTION_REQUIRED', 'INSPECTED', 'PARTIALLY_RESTOCKED', 'RESTOCKED', 'NOT_RESTOCKED', 'REFUND_RECORDED', 'CLOSED', 'CANCELLED') NOT NULL,
    `actorUserId` VARCHAR(30) NULL,
    `reason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReturnStatusHistory_returnRequestId_createdAt_idx`(`returnRequestId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComplianceSetting` (
    `id` VARCHAR(30) NOT NULL,
    `key` VARCHAR(120) NOT NULL,
    `valueType` ENUM('BOOLEAN', 'INTEGER', 'STRING', 'JSON') NOT NULL,
    `value` JSON NOT NULL,
    `description` VARCHAR(500) NULL,
    `legallyReviewed` BOOLEAN NOT NULL DEFAULT false,
    `reviewedBy` VARCHAR(30) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ComplianceSetting_key_key`(`key`),
    INDEX `ComplianceSetting_legallyReviewed_updatedAt_idx`(`legallyReviewed`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LegalDocument` (
    `id` VARCHAR(30) NOT NULL,
    `type` ENUM('TERMS_AND_CONDITIONS', 'PRIVACY_POLICY', 'RETURN_POLICY', 'LEGAL_WARNING', 'AGE_RESTRICTION_POLICY', 'DELIVERY_POLICY', 'COOKIE_POLICY', 'OTHER') NOT NULL,
    `slug` VARCHAR(180) NOT NULL,
    `locale` VARCHAR(10) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `requiredForCheckout` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LegalDocument_type_locale_idx`(`type`, `locale`),
    INDEX `LegalDocument_requiredForCheckout_idx`(`requiredForCheckout`),
    UNIQUE INDEX `LegalDocument_slug_locale_key`(`slug`, `locale`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LegalDocumentVersion` (
    `id` VARCHAR(30) NOT NULL,
    `legalDocumentId` VARCHAR(30) NOT NULL,
    `version` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
    `title` VARCHAR(255) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `effectiveAt` DATETIME(3) NULL,
    `publishedAt` DATETIME(3) NULL,
    `publishedBy` VARCHAR(30) NULL,
    `retiredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LegalDocumentVersion_status_effectiveAt_idx`(`status`, `effectiveAt`),
    INDEX `LegalDocumentVersion_publishedAt_idx`(`publishedAt`),
    UNIQUE INDEX `LegalDocumentVersion_legalDocumentId_version_key`(`legalDocumentId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsentRecord` (
    `id` VARCHAR(30) NOT NULL,
    `customerId` VARCHAR(30) NULL,
    `orderId` VARCHAR(30) NULL,
    `legalDocumentVersionId` VARCHAR(30) NULL,
    `anonymousSubjectHash` CHAR(64) NULL,
    `type` ENUM('AGE_GATE', 'CHECKOUT_AGE_CONFIRMATION', 'TERMS', 'PRIVACY', 'MARKETING_EMAIL', 'MARKETING_SMS', 'COOKIE_PREFERENCES') NOT NULL,
    `granted` BOOLEAN NOT NULL,
    `consentedAt` DATETIME(3) NOT NULL,
    `withdrawnAt` DATETIME(3) NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `locale` VARCHAR(10) NOT NULL,
    `source` VARCHAR(80) NOT NULL,

    INDEX `ConsentRecord_customerId_type_consentedAt_idx`(`customerId`, `type`, `consentedAt`),
    INDEX `ConsentRecord_orderId_type_idx`(`orderId`, `type`),
    INDEX `ConsentRecord_anonymousSubjectHash_type_consentedAt_idx`(`anonymousSubjectHash`, `type`, `consentedAt`),
    INDEX `ConsentRecord_legalDocumentVersionId_consentedAt_idx`(`legalDocumentVersionId`, `consentedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AgeVerificationEvent` (
    `id` VARCHAR(30) NOT NULL,
    `customerId` VARCHAR(30) NULL,
    `orderId` VARCHAR(30) NULL,
    `deliveryId` VARCHAR(30) NULL,
    `phase` ENUM('STORE_ENTRY', 'CHECKOUT', 'DELIVERY', 'CUSTOMER_SUPPORT') NOT NULL,
    `result` ENUM('NOT_REQUIRED', 'PENDING', 'PASSED', 'FAILED', 'REFUSED', 'UNABLE_TO_VERIFY') NOT NULL,
    `minimumAge` INTEGER NOT NULL,
    `method` VARCHAR(100) NOT NULL,
    `reasonCode` VARCHAR(80) NULL,
    `verifierUserId` VARCHAR(30) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `metadata` JSON NULL,

    INDEX `AgeVerificationEvent_orderId_phase_occurredAt_idx`(`orderId`, `phase`, `occurredAt`),
    INDEX `AgeVerificationEvent_deliveryId_phase_occurredAt_idx`(`deliveryId`, `phase`, `occurredAt`),
    INDEX `AgeVerificationEvent_result_occurredAt_idx`(`result`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductRestriction` (
    `id` VARCHAR(30) NOT NULL,
    `productId` VARCHAR(30) NULL,
    `categoryId` VARCHAR(30) NULL,
    `brandId` VARCHAR(30) NULL,
    `type` ENUM('LEGAL_SUSPENSION', 'AGE_RESTRICTION', 'DELIVERY_RESTRICTION', 'SALES_LIMIT', 'RECALL', 'MANUAL_REVIEW') NOT NULL,
    `status` ENUM('SCHEDULED', 'ACTIVE', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `reason` VARCHAR(1000) NOT NULL,
    `rule` JSON NULL,
    `startsAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endsAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(30) NOT NULL,
    `revokedBy` VARCHAR(30) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProductRestriction_productId_status_startsAt_idx`(`productId`, `status`, `startsAt`),
    INDEX `ProductRestriction_categoryId_status_startsAt_idx`(`categoryId`, `status`, `startsAt`),
    INDEX `ProductRestriction_brandId_status_startsAt_idx`(`brandId`, `status`, `startsAt`),
    INDEX `ProductRestriction_status_endsAt_idx`(`status`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(30) NOT NULL,
    `orderId` VARCHAR(30) NULL,
    `templateId` VARCHAR(30) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `event` ENUM('REGISTRATION', 'EMAIL_VERIFICATION', 'PASSWORD_RESET', 'ORDER_RECEIVED', 'ORDER_CONFIRMED', 'ORDER_ON_HOLD', 'ORDER_PREPARING', 'HANDED_TO_COURIER', 'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED', 'DELIVERY_RESCHEDULED', 'ORDER_DELIVERED', 'DELIVERY_REFUSED', 'DELIVERY_FAILED', 'ORDER_CANCELLED', 'RETURN_UPDATE') NOT NULL,
    `channel` ENUM('EMAIL', 'SMS', 'CONSOLE') NOT NULL,
    `recipientHash` CHAR(64) NOT NULL,
    `encryptedRecipient` TEXT NULL,
    `locale` VARCHAR(10) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('QUEUED', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `scheduledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Notification_idempotencyKey_key`(`idempotencyKey`),
    INDEX `Notification_status_scheduledAt_idx`(`status`, `scheduledAt`),
    INDEX `Notification_orderId_event_idx`(`orderId`, `event`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationTemplate` (
    `id` VARCHAR(30) NOT NULL,
    `key` VARCHAR(120) NOT NULL,
    `channel` ENUM('EMAIL', 'SMS', 'CONSOLE') NOT NULL,
    `locale` VARCHAR(10) NOT NULL,
    `subject` VARCHAR(255) NULL,
    `body` LONGTEXT NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `NotificationTemplate_key_channel_locale_active_idx`(`key`, `channel`, `locale`, `active`),
    UNIQUE INDEX `NotificationTemplate_key_channel_locale_version_key`(`key`, `channel`, `locale`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationDeliveryAttempt` (
    `id` VARCHAR(30) NOT NULL,
    `notificationId` VARCHAR(30) NOT NULL,
    `attemptNumber` INTEGER NOT NULL,
    `provider` VARCHAR(100) NOT NULL,
    `providerMessageId` VARCHAR(255) NULL,
    `status` ENUM('QUEUED', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER', 'CANCELLED') NOT NULL,
    `safeErrorCode` VARCHAR(100) NULL,
    `attemptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `nextRetryAt` DATETIME(3) NULL,

    INDEX `NotificationDeliveryAttempt_status_nextRetryAt_idx`(`status`, `nextRetryAt`),
    UNIQUE INDEX `NotificationDeliveryAttempt_notificationId_attemptNumber_key`(`notificationId`, `attemptNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(30) NOT NULL,
    `actorUserId` VARCHAR(30) NULL,
    `actorType` ENUM('CUSTOMER', 'ADMIN', 'COURIER', 'SYSTEM') NOT NULL,
    `action` VARCHAR(160) NOT NULL,
    `resourceType` VARCHAR(120) NOT NULL,
    `resourceId` VARCHAR(80) NULL,
    `outcome` ENUM('SUCCESS', 'FAILURE', 'DENIED') NOT NULL,
    `requestId` VARCHAR(100) NOT NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `beforeSummary` JSON NULL,
    `afterSummary` JSON NULL,
    `errorCode` VARCHAR(100) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_actorUserId_occurredAt_idx`(`actorUserId`, `occurredAt`),
    INDEX `AuditLog_action_occurredAt_idx`(`action`, `occurredAt`),
    INDEX `AuditLog_resourceType_resourceId_occurredAt_idx`(`resourceType`, `resourceId`, `occurredAt`),
    INDEX `AuditLog_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SecurityEvent` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NULL,
    `sessionId` VARCHAR(30) NULL,
    `type` VARCHAR(120) NOT NULL,
    `severity` ENUM('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL,
    `summary` VARCHAR(500) NOT NULL,
    `metadata` JSON NULL,
    `requestId` VARCHAR(100) NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SecurityEvent_type_occurredAt_idx`(`type`, `occurredAt`),
    INDEX `SecurityEvent_severity_occurredAt_idx`(`severity`, `occurredAt`),
    INDEX `SecurityEvent_userId_occurredAt_idx`(`userId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoginAttempt` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NULL,
    `audience` ENUM('CUSTOMER', 'ADMIN') NOT NULL,
    `identifierHash` CHAR(64) NOT NULL,
    `result` ENUM('SUCCESS', 'INVALID_CREDENTIALS', 'LOCKED', 'SUSPENDED', 'TWO_FACTOR_REQUIRED', 'TWO_FACTOR_FAILED', 'RATE_LIMITED', 'IP_RESTRICTED') NOT NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `riskMetadata` JSON NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LoginAttempt_identifierHash_audience_occurredAt_idx`(`identifierHash`, `audience`, `occurredAt`),
    INDEX `LoginAttempt_ipAddress_audience_occurredAt_idx`(`ipAddress`, `audience`, `occurredAt`),
    INDEX `LoginAttempt_result_occurredAt_idx`(`result`, `occurredAt`),
    INDEX `LoginAttempt_userId_occurredAt_idx`(`userId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminActionApproval` (
    `id` VARCHAR(30) NOT NULL,
    `action` VARCHAR(160) NOT NULL,
    `resourceType` VARCHAR(120) NOT NULL,
    `resourceId` VARCHAR(80) NULL,
    `requestPayloadHash` CHAR(64) NOT NULL,
    `requesterUserId` VARCHAR(30) NOT NULL,
    `approverUserId` VARCHAR(30) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionReason` VARCHAR(500) NULL,

    INDEX `AdminActionApproval_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `AdminActionApproval_requesterUserId_requestedAt_idx`(`requesterUserId`, `requestedAt`),
    INDEX `AdminActionApproval_approverUserId_decidedAt_idx`(`approverUserId`, `decidedAt`),
    INDEX `AdminActionApproval_resourceType_resourceId_idx`(`resourceType`, `resourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoreSetting` (
    `id` VARCHAR(30) NOT NULL,
    `key` VARCHAR(120) NOT NULL,
    `valueType` ENUM('BOOLEAN', 'INTEGER', 'STRING', 'JSON') NOT NULL,
    `value` JSON NOT NULL,
    `secret` BOOLEAN NOT NULL DEFAULT false,
    `description` VARCHAR(500) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedBy` VARCHAR(30) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StoreSetting_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeatureFlag` (
    `id` VARCHAR(30) NOT NULL,
    `key` VARCHAR(120) NOT NULL,
    `environment` ENUM('ALL', 'DEVELOPMENT', 'STAGING', 'PRODUCTION') NOT NULL DEFAULT 'ALL',
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `configuration` JSON NULL,
    `description` VARCHAR(500) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FeatureFlag_enabled_environment_idx`(`enabled`, `environment`),
    UNIQUE INDEX `FeatureFlag_key_environment_key`(`key`, `environment`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BackgroundJobRecord` (
    `id` VARCHAR(30) NOT NULL,
    `queue` VARCHAR(120) NOT NULL,
    `jobName` VARCHAR(160) NOT NULL,
    `externalJobId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `payloadHash` CHAR(64) NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `scheduledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `nextRetryAt` DATETIME(3) NULL,
    `safeErrorCode` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BackgroundJobRecord_idempotencyKey_key`(`idempotencyKey`),
    INDEX `BackgroundJobRecord_queue_status_scheduledAt_idx`(`queue`, `status`, `scheduledAt`),
    INDEX `BackgroundJobRecord_status_nextRetryAt_idx`(`status`, `nextRetryAt`),
    UNIQUE INDEX `BackgroundJobRecord_queue_externalJobId_key`(`queue`, `externalJobId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemHealthRecord` (
    `id` VARCHAR(30) NOT NULL,
    `component` VARCHAR(120) NOT NULL,
    `instanceId` VARCHAR(160) NOT NULL,
    `status` ENUM('HEALTHY', 'DEGRADED', 'UNHEALTHY') NOT NULL,
    `latencyMs` INTEGER NULL,
    `details` JSON NULL,
    `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SystemHealthRecord_component_checkedAt_idx`(`component`, `checkedAt`),
    INDEX `SystemHealthRecord_status_checkedAt_idx`(`status`, `checkedAt`),
    INDEX `SystemHealthRecord_instanceId_checkedAt_idx`(`instanceId`, `checkedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CustomerProfile` ADD CONSTRAINT `CustomerProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminProfile` ADD CONSTRAINT `AdminProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_rotatedFromId_fkey` FOREIGN KEY (`rotatedFromId`) REFERENCES `Session`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationToken` ADD CONSTRAINT `VerificationToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasswordResetToken` ADD CONSTRAINT `PasswordResetToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TwoFactorSecret` ADD CONSTRAINT `TwoFactorSecret_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecoveryCode` ADD CONSTRAINT `RecoveryCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserRole` ADD CONSTRAINT `UserRole_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserRole` ADD CONSTRAINT `UserRole_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Address` ADD CONSTRAINT `Address_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Address` ADD CONSTRAINT `Address_governorateId_fkey` FOREIGN KEY (`governorateId`) REFERENCES `Governorate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Address` ADD CONSTRAINT `Address_delegationId_fkey` FOREIGN KEY (`delegationId`) REFERENCES `Delegation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Address` ADD CONSTRAINT `Address_localityId_fkey` FOREIGN KEY (`localityId`) REFERENCES `Locality`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerTagAssignment` ADD CONSTRAINT `CustomerTagAssignment_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerTagAssignment` ADD CONSTRAINT `CustomerTagAssignment_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `CustomerTag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerNote` ADD CONSTRAINT `CustomerNote_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerRiskEvent` ADD CONSTRAINT `CustomerRiskEvent_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerBlocklistEntry` ADD CONSTRAINT `CustomerBlocklistEntry_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerDataExportRequest` ADD CONSTRAINT `CustomerDataExportRequest_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerDeletionRequest` ADD CONSTRAINT `CustomerDeletionRequest_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Category` ADD CONSTRAINT `Category_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `Brand`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductVariant` ADD CONSTRAINT `ProductVariant_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductImage` ADD CONSTRAINT `ProductImage_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductImage` ADD CONSTRAINT `ProductImage_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductAttribute` ADD CONSTRAINT `ProductAttribute_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductAttributeValue` ADD CONSTRAINT `ProductAttributeValue_attributeId_fkey` FOREIGN KEY (`attributeId`) REFERENCES `ProductAttribute`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductVariantAttribute` ADD CONSTRAINT `ProductVariantAttribute_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductVariantAttribute` ADD CONSTRAINT `ProductVariantAttribute_attributeValueId_fkey` FOREIGN KEY (`attributeValueId`) REFERENCES `ProductAttributeValue`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductSupplier` ADD CONSTRAINT `ProductSupplier_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductSupplier` ADD CONSTRAINT `ProductSupplier_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatch` ADD CONSTRAINT `ProductBatch_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductBatch` ADD CONSTRAINT `ProductBatch_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryItem` ADD CONSTRAINT `InventoryItem_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryItem` ADD CONSTRAINT `InventoryItem_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryItem` ADD CONSTRAINT `InventoryItem_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockMovement` ADD CONSTRAINT `StockMovement_inventoryItemId_fkey` FOREIGN KEY (`inventoryItemId`) REFERENCES `InventoryItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockMovement` ADD CONSTRAINT `StockMovement_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockMovement` ADD CONSTRAINT `StockMovement_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `ProductBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockReservation` ADD CONSTRAINT `StockReservation_inventoryItemId_fkey` FOREIGN KEY (`inventoryItemId`) REFERENCES `InventoryItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockReservation` ADD CONSTRAINT `StockReservation_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockReservation` ADD CONSTRAINT `StockReservation_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `OrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryAdjustment` ADD CONSTRAINT `InventoryAdjustment_inventoryItemId_fkey` FOREIGN KEY (`inventoryItemId`) REFERENCES `InventoryItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Cart` ADD CONSTRAINT `Cart_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CartItem` ADD CONSTRAINT `CartItem_cartId_fkey` FOREIGN KEY (`cartId`) REFERENCES `Cart`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CartItem` ADD CONSTRAINT `CartItem_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Wishlist` ADD CONSTRAINT `Wishlist_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WishlistItem` ADD CONSTRAINT `WishlistItem_wishlistId_fkey` FOREIGN KEY (`wishlistId`) REFERENCES `Wishlist`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WishlistItem` ADD CONSTRAINT `WishlistItem_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Coupon` ADD CONSTRAINT `Coupon_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionProduct` ADD CONSTRAINT `PromotionProduct_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionProduct` ADD CONSTRAINT `PromotionProduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionCategory` ADD CONSTRAINT `PromotionCategory_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionCategory` ADD CONSTRAINT `PromotionCategory_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionBrand` ADD CONSTRAINT `PromotionBrand_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionBrand` ADD CONSTRAINT `PromotionBrand_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `Brand`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionRedemption` ADD CONSTRAINT `PromotionRedemption_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionRedemption` ADD CONSTRAINT `PromotionRedemption_couponId_fkey` FOREIGN KEY (`couponId`) REFERENCES `Coupon`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionRedemption` ADD CONSTRAINT `PromotionRedemption_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionRedemption` ADD CONSTRAINT `PromotionRedemption_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Delegation` ADD CONSTRAINT `Delegation_governorateId_fkey` FOREIGN KEY (`governorateId`) REFERENCES `Governorate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Locality` ADD CONSTRAINT `Locality_delegationId_fkey` FOREIGN KEY (`delegationId`) REFERENCES `Delegation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostalCode` ADD CONSTRAINT `PostalCode_localityId_fkey` FOREIGN KEY (`localityId`) REFERENCES `Locality`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryZoneLocality` ADD CONSTRAINT `DeliveryZoneLocality_deliveryZoneId_fkey` FOREIGN KEY (`deliveryZoneId`) REFERENCES `DeliveryZone`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryZoneLocality` ADD CONSTRAINT `DeliveryZoneLocality_localityId_fkey` FOREIGN KEY (`localityId`) REFERENCES `Locality`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryRate` ADD CONSTRAINT `DeliveryRate_deliveryZoneId_fkey` FOREIGN KEY (`deliveryZoneId`) REFERENCES `DeliveryZone`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryRate` ADD CONSTRAINT `DeliveryRate_governorateId_fkey` FOREIGN KEY (`governorateId`) REFERENCES `Governorate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryRate` ADD CONSTRAINT `DeliveryRate_delegationId_fkey` FOREIGN KEY (`delegationId`) REFERENCES `Delegation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryRate` ADD CONSTRAINT `DeliveryRate_localityId_fkey` FOREIGN KEY (`localityId`) REFERENCES `Locality`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryTimeWindow` ADD CONSTRAINT `DeliveryTimeWindow_deliveryZoneId_fkey` FOREIGN KEY (`deliveryZoneId`) REFERENCES `DeliveryZone`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryTimeWindow` ADD CONSTRAINT `DeliveryTimeWindow_pickupLocationId_fkey` FOREIGN KEY (`pickupLocationId`) REFERENCES `PickupLocation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryBlackoutDate` ADD CONSTRAINT `DeliveryBlackoutDate_deliveryZoneId_fkey` FOREIGN KEY (`deliveryZoneId`) REFERENCES `DeliveryZone`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryBlackoutDate` ADD CONSTRAINT `DeliveryBlackoutDate_pickupLocationId_fkey` FOREIGN KEY (`pickupLocationId`) REFERENCES `PickupLocation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PickupLocation` ADD CONSTRAINT `PickupLocation_inventoryLocationId_fkey` FOREIGN KEY (`inventoryLocationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_cartId_fkey` FOREIGN KEY (`cartId`) REFERENCES `Cart`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_deliveryZoneId_fkey` FOREIGN KEY (`deliveryZoneId`) REFERENCES `DeliveryZone`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_deliveryRateId_fkey` FOREIGN KEY (`deliveryRateId`) REFERENCES `DeliveryRate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_pickupLocationId_fkey` FOREIGN KEY (`pickupLocationId`) REFERENCES `PickupLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_deliveryTimeWindowId_fkey` FOREIGN KEY (`deliveryTimeWindowId`) REFERENCES `DeliveryTimeWindow`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderAddressSnapshot` ADD CONSTRAINT `OrderAddressSnapshot_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderAddressSnapshot` ADD CONSTRAINT `OrderAddressSnapshot_governorateId_fkey` FOREIGN KEY (`governorateId`) REFERENCES `Governorate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderAddressSnapshot` ADD CONSTRAINT `OrderAddressSnapshot_delegationId_fkey` FOREIGN KEY (`delegationId`) REFERENCES `Delegation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderAddressSnapshot` ADD CONSTRAINT `OrderAddressSnapshot_localityId_fkey` FOREIGN KEY (`localityId`) REFERENCES `Locality`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderStatusHistory` ADD CONSTRAINT `OrderStatusHistory_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderNote` ADD CONSTRAINT `OrderNote_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderConsentSnapshot` ADD CONSTRAINT `OrderConsentSnapshot_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderDiscount` ADD CONSTRAINT `OrderDiscount_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderDiscount` ADD CONSTRAINT `OrderDiscount_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderDiscount` ADD CONSTRAINT `OrderDiscount_couponId_fkey` FOREIGN KEY (`couponId`) REFERENCES `Coupon`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderIdempotencyKey` ADD CONSTRAINT `OrderIdempotencyKey_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourierUser` ADD CONSTRAINT `CourierUser_courierId_fkey` FOREIGN KEY (`courierId`) REFERENCES `Courier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourierUser` ADD CONSTRAINT `CourierUser_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourierIntegration` ADD CONSTRAINT `CourierIntegration_courierId_fkey` FOREIGN KEY (`courierId`) REFERENCES `Courier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Delivery` ADD CONSTRAINT `Delivery_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Delivery` ADD CONSTRAINT `Delivery_courierId_fkey` FOREIGN KEY (`courierId`) REFERENCES `Courier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryAttempt` ADD CONSTRAINT `DeliveryAttempt_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `Delivery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryEvent` ADD CONSTRAINT `DeliveryEvent_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `Delivery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryManifest` ADD CONSTRAINT `DeliveryManifest_courierId_fkey` FOREIGN KEY (`courierId`) REFERENCES `Courier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryManifestItem` ADD CONSTRAINT `DeliveryManifestItem_manifestId_fkey` FOREIGN KEY (`manifestId`) REFERENCES `DeliveryManifest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryManifestItem` ADD CONSTRAINT `DeliveryManifestItem_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `Delivery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShippingLabel` ADD CONSTRAINT `ShippingLabel_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `Delivery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProofOfDelivery` ADD CONSTRAINT `ProofOfDelivery_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `Delivery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashCollection` ADD CONSTRAINT `CashCollection_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashCollection` ADD CONSTRAINT `CashCollection_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `Delivery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashCollection` ADD CONSTRAINT `CashCollection_courierId_fkey` FOREIGN KEY (`courierId`) REFERENCES `Courier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashRemittance` ADD CONSTRAINT `CashRemittance_courierId_fkey` FOREIGN KEY (`courierId`) REFERENCES `Courier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashRemittanceItem` ADD CONSTRAINT `CashRemittanceItem_remittanceId_fkey` FOREIGN KEY (`remittanceId`) REFERENCES `CashRemittance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashRemittanceItem` ADD CONSTRAINT `CashRemittanceItem_cashCollectionId_fkey` FOREIGN KEY (`cashCollectionId`) REFERENCES `CashCollection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashDiscrepancy` ADD CONSTRAINT `CashDiscrepancy_remittanceId_fkey` FOREIGN KEY (`remittanceId`) REFERENCES `CashRemittance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashDiscrepancy` ADD CONSTRAINT `CashDiscrepancy_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashReconciliationEvent` ADD CONSTRAINT `CashReconciliationEvent_remittanceId_fkey` FOREIGN KEY (`remittanceId`) REFERENCES `CashRemittance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnRequest` ADD CONSTRAINT `ReturnRequest_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnRequest` ADD CONSTRAINT `ReturnRequest_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnRequest` ADD CONSTRAINT `ReturnRequest_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `Delivery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnItem` ADD CONSTRAINT `ReturnItem_returnRequestId_fkey` FOREIGN KEY (`returnRequestId`) REFERENCES `ReturnRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnItem` ADD CONSTRAINT `ReturnItem_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `OrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnStatusHistory` ADD CONSTRAINT `ReturnStatusHistory_returnRequestId_fkey` FOREIGN KEY (`returnRequestId`) REFERENCES `ReturnRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LegalDocumentVersion` ADD CONSTRAINT `LegalDocumentVersion_legalDocumentId_fkey` FOREIGN KEY (`legalDocumentId`) REFERENCES `LegalDocument`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConsentRecord` ADD CONSTRAINT `ConsentRecord_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConsentRecord` ADD CONSTRAINT `ConsentRecord_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConsentRecord` ADD CONSTRAINT `ConsentRecord_legalDocumentVersionId_fkey` FOREIGN KEY (`legalDocumentVersionId`) REFERENCES `LegalDocumentVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AgeVerificationEvent` ADD CONSTRAINT `AgeVerificationEvent_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AgeVerificationEvent` ADD CONSTRAINT `AgeVerificationEvent_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AgeVerificationEvent` ADD CONSTRAINT `AgeVerificationEvent_deliveryId_fkey` FOREIGN KEY (`deliveryId`) REFERENCES `Delivery`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductRestriction` ADD CONSTRAINT `ProductRestriction_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductRestriction` ADD CONSTRAINT `ProductRestriction_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductRestriction` ADD CONSTRAINT `ProductRestriction_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `Brand`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `NotificationTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationDeliveryAttempt` ADD CONSTRAINT `NotificationDeliveryAttempt_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `Notification`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SecurityEvent` ADD CONSTRAINT `SecurityEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SecurityEvent` ADD CONSTRAINT `SecurityEvent_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoginAttempt` ADD CONSTRAINT `LoginAttempt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminActionApproval` ADD CONSTRAINT `AdminActionApproval_requesterUserId_fkey` FOREIGN KEY (`requesterUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminActionApproval` ADD CONSTRAINT `AdminActionApproval_approverUserId_fkey` FOREIGN KEY (`approverUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
