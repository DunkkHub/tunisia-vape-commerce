import { describe, expect, it } from 'vitest';
import { eligibleOrderInventoryWhere } from './inventory-eligibility';

describe('eligibleOrderInventoryWhere', () => {
  it('excludes zero stock, inactive/non-fulfilling locations, and archived or expired batches', () => {
    const now = new Date('2026-07-27T12:00:00.000Z');

    expect(eligibleOrderInventoryWhere(now)).toEqual({
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
  });
});
