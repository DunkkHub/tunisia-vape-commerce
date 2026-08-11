import { describe, expect, it } from 'vitest';

import { AdminCashCollectionDetailDto, AdminCashCollectionListItemDto } from './admin-cash.dto';

describe('administrator cash collection reporting contract', () => {
  it.each([AdminCashCollectionListItemDto, AdminCashCollectionDetailDto])(
    'documents raw, accountable, signed adjustment, and discrepancy status on %s',
    (contract) => {
      const properties = Reflect.getMetadata(
        'swagger/apiModelPropertiesArray',
        contract.prototype,
      ) as string[];
      expect(properties).toEqual(
        expect.arrayContaining([
          ':collectedMillimes',
          ':accountableMillimes',
          ':adjustmentMillimes',
          ':discrepancyStatus',
        ]),
      );
      const adjustment = Reflect.getMetadata(
        'swagger/apiModelProperties',
        contract.prototype,
        'adjustmentMillimes',
      ) as { minimum?: number } | undefined;
      expect(adjustment?.minimum).toBeUndefined();
    },
  );
});
