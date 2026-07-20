-- An order can be created without a checkout self-attestation when the operator disables that
-- configurable feature. The configured minimum-age policy is still snapshotted independently.
ALTER TABLE `Order`
  MODIFY `ageConfirmedAt` DATETIME(3) NULL;
