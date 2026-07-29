import type { Prisma } from '@prisma/client';

export const eligibleOrderInventoryWhere = (now: Date): Prisma.InventoryItemWhereInput => ({
  onHandQuantity: { gt: 0 },
  location: { is: { active: true, fulfillsOrders: true } },
  OR: [
    { batchId: null },
    {
      batch: {
        is: {
          archivedAt: null,
          OR: [{ expiryDate: null }, { expiryDate: { gt: now } }],
        },
      },
    },
  ],
});
