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

export const verifyRestoredDatabase = async (prisma, manifest = null) => {
  const countEntries = await Promise.all(
    [
      ['User', prisma.user.count()],
      ['Product', prisma.product.count()],
      ['ProductVariant', prisma.productVariant.count()],
      ['InventoryItem', prisma.inventoryItem.count()],
      ['StockReservation', prisma.stockReservation.count()],
      ['StockMovement', prisma.stockMovement.count()],
      ['Order', prisma.order.count()],
      ['OrderItem', prisma.orderItem.count()],
      ['OrderAddressSnapshot', prisma.orderAddressSnapshot.count()],
      ['OrderConsentSnapshot', prisma.orderConsentSnapshot.count()],
      ['Delivery', prisma.delivery.count()],
      ['DeliveryEvent', prisma.deliveryEvent.count()],
      ['CashCollection', prisma.cashCollection.count()],
      ['CashRemittance', prisma.cashRemittance.count()],
      ['AuditLog', prisma.auditLog.count()],
      ['OutboxEvent', prisma.outboxEvent.count()],
      ['Notification', prisma.notification.count()],
    ].map(async ([name, operation]) => [name, await operation]),
  );
  const rowCounts = Object.fromEntries(countEntries);
  const [
    negativeInventory,
    overReservedInventory,
    invalidOrderTotals,
    invalidLineTotals,
    invalidCash,
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
          FROM \`CashCollection\`
          WHERE \`expectedMillimes\` < 0 OR \`collectedMillimes\` < 0
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
  const violations = {
    negativeInventory,
    overReservedInventory,
    invalidOrderTotals,
    invalidLineTotals,
    invalidCash,
    incompleteMigrations,
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
    advisoryCountDifferences,
  };
};
