CREATE TABLE `ProductImageRendition` (
    `productImageId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `format` VARCHAR(8) NOT NULL,
    `profileVersion` INTEGER NOT NULL,
    `byteSize` INTEGER NOT NULL,
    `checksumSha256` CHAR(64) NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT `ProductImageRendition_pkey`
      PRIMARY KEY (`productImageId`, `name`, `format`, `profileVersion`),
    INDEX `ProductImageRendition_productImageId_profileVersion_idx`
      (`productImageId`, `profileVersion`),
    CONSTRAINT `ProductImageRendition_name_check`
      CHECK ((`name` COLLATE utf8mb4_bin) IN ('thumbnail', 'card', 'detail', 'high-resolution')),
    CONSTRAINT `ProductImageRendition_format_check`
      CHECK ((`format` COLLATE utf8mb4_bin) IN ('webp', 'jpeg')),
    CONSTRAINT `ProductImageRendition_profileVersion_check`
      CHECK (`profileVersion` > 0),
    CONSTRAINT `ProductImageRendition_byteSize_check`
      CHECK (`byteSize` > 0 AND `byteSize` <= 10485760),
    CONSTRAINT `ProductImageRendition_dimensions_check`
      CHECK (`width` > 0 AND `height` > 0),
    CONSTRAINT `ProductImageRendition_checksumSha256_check`
      CHECK ((`checksumSha256` COLLATE utf8mb4_bin) REGEXP '^[a-f0-9]{64}$'),
    CONSTRAINT `ProductImageRendition_productImageId_fkey`
      FOREIGN KEY (`productImageId`) REFERENCES `ProductImage` (`id`)
      ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
