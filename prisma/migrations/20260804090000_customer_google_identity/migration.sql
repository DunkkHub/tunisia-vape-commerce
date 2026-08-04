-- Provider-only customers have no reusable local credential. Administrator creation and login
-- continue to require a password and remain in the separate ADMIN realm.
ALTER TABLE `User`
  MODIFY `passwordHash` VARCHAR(255) NULL,
  ADD CONSTRAINT `User_admin_password_required` CHECK (
    `audience` <> 'ADMIN' OR `passwordHash` IS NOT NULL
  );

-- Persist only the stable provider binding required for account resolution. Authorization codes,
-- access/refresh tokens, OAuth state, nonce and PKCE material remain short-lived in Redis.
CREATE TABLE `CustomerExternalIdentity` (
  `id` VARCHAR(30) NOT NULL,
  `customerId` VARCHAR(30) NOT NULL,
  `provider` ENUM('GOOGLE') NOT NULL,
  `providerSubjectHash` CHAR(64) NOT NULL,
  `emailNormalized` VARCHAR(320) NOT NULL,
  `linkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastAuthenticatedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CustomerExternalIdentity_provider_providerSubjectHash_key` (`provider`, `providerSubjectHash`),
  UNIQUE INDEX `CustomerExternalIdentity_customerId_provider_key` (`customerId`, `provider`),
  INDEX `CustomerExternalIdentity_emailNormalized_idx` (`emailNormalized`),
  PRIMARY KEY (`id`),
  CONSTRAINT `CustomerExternalIdentity_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
