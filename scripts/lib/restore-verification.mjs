import { Prisma } from '@prisma/client';

const asCount = (value) => {
  const count = typeof value === 'bigint' ? value : BigInt(value ?? 0);
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Verification count overflow');
  return Number(count);
};

const scalarCount = async (prisma, query) => {
  const [row] = await prisma.$queryRaw(query);
  return asCount(row?.count);
};

export const assertExpectedMigrationHead = (latestMigration, expectedMigration) => {
  if (latestMigration !== expectedMigration) {
    throw new Error(
      `Restored migration head ${String(latestMigration ?? 'NONE')} does not match the application-required migration ${expectedMigration}`,
    );
  }
};

export const verifyRestoredDatabase = async (
  prisma,
  manifest = null,
  { expectedMigration } = {},
) => {
  if (!expectedMigration || !/^[A-Za-z0-9_.-]{1,200}$/.test(expectedMigration)) {
    throw new Error('A valid expected migration is required for restore verification');
  }
  const countEntries = await Promise.all(
    [
      ['User', prisma.user.count()],
      ['CustomerExternalIdentity', prisma.customerExternalIdentity.count()],
      ['PasswordResetToken', prisma.passwordResetToken.count()],
      ['Product', prisma.product.count()],
      ['ProductVariant', prisma.productVariant.count()],
      ['ProductImage', prisma.productImage.count()],
      ['InventoryItem', prisma.inventoryItem.count()],
      ['StockReservation', prisma.stockReservation.count()],
      ['StockMovement', prisma.stockMovement.count()],
      ['Order', prisma.order.count()],
      ['OrderItem', prisma.orderItem.count()],
      ['OrderAddressSnapshot', prisma.orderAddressSnapshot.count()],
      ['OrderConsentSnapshot', prisma.orderConsentSnapshot.count()],
      ['DeliveryZone', prisma.deliveryZone.count()],
      ['Courier', prisma.courier.count()],
      ['CourierDeliveryZone', prisma.courierDeliveryZone.count()],
      ['Delivery', prisma.delivery.count()],
      ['DeliveryAttempt', prisma.deliveryAttempt.count()],
      ['DeliveryEvent', prisma.deliveryEvent.count()],
      ['CashCollection', prisma.cashCollection.count()],
      ['CashRemittance', prisma.cashRemittance.count()],
      ['CashRemittanceItem', prisma.cashRemittanceItem.count()],
      ['CashDiscrepancy', prisma.cashDiscrepancy.count()],
      ['CashReconciliationEvent', prisma.cashReconciliationEvent.count()],
      ['AuditLog', prisma.auditLog.count()],
      ['OutboxEvent', prisma.outboxEvent.count()],
      ['Notification', prisma.notification.count()],
      ['NotificationDeliveryAttempt', prisma.notificationDeliveryAttempt.count()],
    ].map(async ([name, operation]) => [name, await operation]),
  );
  const rowCounts = Object.fromEntries(countEntries);
  const [
    negativeInventory,
    overReservedInventory,
    invalidOrderTotals,
    invalidLineTotals,
    invalidCash,
    orphanedReferences,
  ] = await Promise.all([
    scalarCount(
      prisma,
      Prisma.sql`SELECT COUNT(*) AS \`count\` FROM \`InventoryItem\` WHERE \`onHandQuantity\` < 0`,
    ),
    scalarCount(
      prisma,
      Prisma.sql`
          SELECT COUNT(*) AS \`count\`
          FROM (
            SELECT i.id
            FROM \`InventoryItem\` i
            LEFT JOIN \`StockReservation\` r
              ON r.inventoryItemId = i.id
              AND r.state = ${'ACTIVE'}
              AND r.expiresAt > UTC_TIMESTAMP(3)
            GROUP BY i.id, i.onHandQuantity
            HAVING COALESCE(SUM(r.quantity), 0) > i.onHandQuantity
          ) invalid_reservations
        `,
    ),
    scalarCount(
      prisma,
      Prisma.sql`
          SELECT COUNT(*) AS \`count\`
          FROM \`Order\`
          WHERE \`grandTotalMillimes\` !=
            \`subtotalMillimes\` - \`discountTotalMillimes\` +
            \`deliveryTotalMillimes\` + \`taxTotalMillimes\`
        `,
    ),
    scalarCount(
      prisma,
      Prisma.sql`
          SELECT COUNT(*) AS \`count\`
          FROM \`OrderItem\`
          WHERE \`lineTotalMillimes\` !=
            \`lineSubtotalMillimes\` - \`lineDiscountMillimes\` + \`lineTaxMillimes\`
        `,
    ),
    scalarCount(
      prisma,
      Prisma.sql`
          SELECT COUNT(*) AS \`count\`
          FROM (
            SELECT cc.id
            FROM \`CashCollection\` cc
            WHERE cc.\`expectedMillimes\` < 0 OR cc.\`collectedMillimes\` < 0
            UNION ALL
            SELECT cd.id
            FROM \`CashDiscrepancy\` cd
            LEFT JOIN \`CashCollection\` cc ON cc.id = cd.cashCollectionId
            WHERE cd.\`expectedMillimes\` < 0
              OR cd.\`actualMillimes\` < 0
              OR cd.\`differenceMillimes\` != cd.\`actualMillimes\` - cd.\`expectedMillimes\`
              OR NOT (
                (cd.\`remittanceId\` IS NOT NULL AND cd.\`orderId\` IS NULL AND
                 cd.\`cashCollectionId\` IS NULL) OR
                (cd.\`remittanceId\` IS NULL AND cd.\`orderId\` IS NOT NULL)
              )
              OR (cd.\`cashCollectionId\` IS NOT NULL AND
                  (cd.\`orderId\` IS NULL OR
                   cc.\`orderId\` != cd.\`orderId\` OR
                   cc.\`expectedMillimes\` != cd.\`expectedMillimes\` OR
                   cc.\`collectedMillimes\` != cd.\`actualMillimes\`))
            UNION ALL
            SELECT cre.id
            FROM \`CashReconciliationEvent\` cre
            WHERE cre.\`remittanceId\` IS NOT NULL AND cre.\`cashCollectionId\` IS NOT NULL
          ) invalid_cash
        `,
    ),
    scalarCount(
      prisma,
      Prisma.sql`
        SELECT COUNT(*) AS \`count\`
        FROM (
          SELECT oi.id
          FROM \`OrderItem\` oi
          LEFT JOIN \`Order\` o ON o.id = oi.orderId
          WHERE o.id IS NULL
          UNION ALL
          SELECT cei.id
          FROM \`CustomerExternalIdentity\` cei
          LEFT JOIN \`CustomerProfile\` cp ON cp.id = cei.customerId
          WHERE cp.id IS NULL
          UNION ALL
          SELECT prt.id
          FROM \`PasswordResetToken\` prt
          LEFT JOIN \`User\` u ON u.id = prt.userId
          WHERE u.id IS NULL
          UNION ALL
          SELECT pi.id
          FROM \`ProductImage\` pi
          LEFT JOIN \`Product\` p ON p.id = pi.productId
          WHERE pi.productId IS NOT NULL AND p.id IS NULL
          UNION ALL
          SELECT pi.id
          FROM \`ProductImage\` pi
          LEFT JOIN \`ProductVariant\` pv ON pv.id = pi.variantId
          WHERE pi.variantId IS NOT NULL AND pv.id IS NULL
          UNION ALL
          SELECT oa.id
          FROM \`OrderAddressSnapshot\` oa
          LEFT JOIN \`Order\` o ON o.id = oa.orderId
          WHERE o.id IS NULL
          UNION ALL
          SELECT oc.id
          FROM \`OrderConsentSnapshot\` oc
          LEFT JOIN \`Order\` o ON o.id = oc.orderId
          WHERE o.id IS NULL
          UNION ALL
          SELECT d.id
          FROM \`Delivery\` d
          LEFT JOIN \`Order\` o ON o.id = d.orderId
          WHERE o.id IS NULL
          UNION ALL
          SELECT d.id
          FROM \`Delivery\` d
          LEFT JOIN \`Courier\` c ON c.id = d.courierId
          WHERE d.courierId IS NOT NULL AND c.id IS NULL
          UNION ALL
          SELECT cdz.courierId
          FROM \`CourierDeliveryZone\` cdz
          LEFT JOIN \`Courier\` c ON c.id = cdz.courierId
          WHERE c.id IS NULL
          UNION ALL
          SELECT cdz.courierId
          FROM \`CourierDeliveryZone\` cdz
          LEFT JOIN \`DeliveryZone\` dz ON dz.id = cdz.deliveryZoneId
          WHERE dz.id IS NULL
          UNION ALL
          SELECT da.id
          FROM \`DeliveryAttempt\` da
          LEFT JOIN \`Delivery\` d ON d.id = da.deliveryId
          WHERE d.id IS NULL
          UNION ALL
          SELECT de.id
          FROM \`DeliveryEvent\` de
          LEFT JOIN \`Delivery\` d ON d.id = de.deliveryId
          WHERE d.id IS NULL
          UNION ALL
          SELECT cc.id
          FROM \`CashCollection\` cc
          LEFT JOIN \`Order\` o ON o.id = cc.orderId
          WHERE o.id IS NULL
          UNION ALL
          SELECT cc.id
          FROM \`CashCollection\` cc
          LEFT JOIN \`Delivery\` d ON d.id = cc.deliveryId
          WHERE cc.deliveryId IS NOT NULL AND d.id IS NULL
          UNION ALL
          SELECT cc.id
          FROM \`CashCollection\` cc
          LEFT JOIN \`Courier\` c ON c.id = cc.courierId
          WHERE cc.courierId IS NOT NULL AND c.id IS NULL
          UNION ALL
          SELECT cr.id
          FROM \`CashRemittance\` cr
          LEFT JOIN \`Courier\` c ON c.id = cr.courierId
          WHERE c.id IS NULL
          UNION ALL
          SELECT cri.id
          FROM \`CashRemittanceItem\` cri
          LEFT JOIN \`CashRemittance\` cr ON cr.id = cri.remittanceId
          WHERE cr.id IS NULL
          UNION ALL
          SELECT cri.id
          FROM \`CashRemittanceItem\` cri
          LEFT JOIN \`CashCollection\` cc ON cc.id = cri.cashCollectionId
          WHERE cc.id IS NULL
          UNION ALL
          SELECT cd.id
          FROM \`CashDiscrepancy\` cd
          LEFT JOIN \`CashRemittance\` cr ON cr.id = cd.remittanceId
          WHERE cd.remittanceId IS NOT NULL AND cr.id IS NULL
          UNION ALL
          SELECT cd.id
          FROM \`CashDiscrepancy\` cd
          LEFT JOIN \`Order\` o ON o.id = cd.orderId
          WHERE cd.orderId IS NOT NULL AND o.id IS NULL
          UNION ALL
          SELECT cd.id
          FROM \`CashDiscrepancy\` cd
          LEFT JOIN \`CashCollection\` cc ON cc.id = cd.cashCollectionId
          WHERE cd.cashCollectionId IS NOT NULL AND cc.id IS NULL
          UNION ALL
          SELECT cre.id
          FROM \`CashReconciliationEvent\` cre
          LEFT JOIN \`CashRemittance\` cr ON cr.id = cre.remittanceId
          WHERE cre.remittanceId IS NOT NULL AND cr.id IS NULL
          UNION ALL
          SELECT cre.id
          FROM \`CashReconciliationEvent\` cre
          LEFT JOIN \`CashCollection\` cc ON cc.id = cre.cashCollectionId
          WHERE cre.cashCollectionId IS NOT NULL AND cc.id IS NULL
          UNION ALL
          SELECT sr.id
          FROM \`StockReservation\` sr
          LEFT JOIN \`InventoryItem\` i ON i.id = sr.inventoryItemId
          WHERE i.id IS NULL
          UNION ALL
          SELECT sr.id
          FROM \`StockReservation\` sr
          LEFT JOIN \`Order\` o ON o.id = sr.orderId
          WHERE sr.orderId IS NOT NULL AND o.id IS NULL
          UNION ALL
          SELECT nda.id
          FROM \`NotificationDeliveryAttempt\` nda
          LEFT JOIN \`Notification\` n ON n.id = nda.notificationId
          WHERE n.id IS NULL
        ) orphaned
      `,
    ),
  ]);
  const incompleteMigrations = await scalarCount(
    prisma,
    Prisma.sql`
      SELECT COUNT(*) AS \`count\`
      FROM \`_prisma_migrations\`
      WHERE \`finished_at\` IS NULL AND \`rolled_back_at\` IS NULL
    `,
  );
  const [latestMigrationRow] = await prisma.$queryRaw(
    Prisma.sql`
      SELECT \`migration_name\` AS \`migrationName\`
      FROM \`_prisma_migrations\`
      WHERE \`finished_at\` IS NOT NULL AND \`rolled_back_at\` IS NULL
      ORDER BY \`finished_at\` DESC
      LIMIT 1
    `,
  );
  const [expectedMigrationRows, migrationStateRows] = await Promise.all([
    prisma.$queryRaw(
      Prisma.sql`
        SELECT COUNT(*) AS \`count\`
        FROM \`_prisma_migrations\`
        WHERE \`migration_name\` = ${expectedMigration}
          AND \`finished_at\` IS NOT NULL
          AND \`rolled_back_at\` IS NULL
      `,
    ),
    prisma.$queryRaw(
      Prisma.sql`
        SELECT \`migration_name\` AS \`name\`, \`checksum\`
        FROM \`_prisma_migrations\`
        WHERE \`finished_at\` IS NOT NULL AND \`rolled_back_at\` IS NULL
        ORDER BY \`migration_name\`
      `,
    ),
  ]);
  const expectedMigrationMissing = asCount(expectedMigrationRows[0]?.count) === 1 ? 0 : 1;
  const violations = {
    negativeInventory,
    overReservedInventory,
    invalidOrderTotals,
    invalidLineTotals,
    invalidCash,
    orphanedReferences,
    incompleteMigrations,
    expectedMigrationMissing,
  };
  if (Object.values(violations).some((count) => count !== 0)) {
    throw new Error(`Post-restore invariant verification failed: ${JSON.stringify(violations)}`);
  }
  if (
    manifest?.latestMigration &&
    manifest.latestMigration !== 'NONE' &&
    latestMigrationRow?.migrationName !== manifest.latestMigration
  ) {
    throw new Error('Restored migration state does not match the backup manifest');
  }
  assertExpectedMigrationHead(latestMigrationRow?.migrationName ?? null, expectedMigration);
  if (
    manifest?.formatVersion === 2 &&
    JSON.stringify(migrationStateRows) !== JSON.stringify(manifest.migrationState)
  ) {
    throw new Error('Restored migration names or checksums do not match the backup manifest');
  }
  const advisoryCountDifferences = Object.fromEntries(
    Object.entries(manifest?.rowCounts ?? {}).flatMap(([table, expected]) =>
      rowCounts[table] === expected
        ? []
        : [[table, { expected, restored: rowCounts[table] ?? null }]],
    ),
  );
  return {
    status: 'verified',
    rowCounts,
    violations,
    latestMigration: latestMigrationRow?.migrationName ?? null,
    expectedMigration: expectedMigration ?? null,
    migrationState: migrationStateRows,
    advisoryCountDifferences,
  };
};
