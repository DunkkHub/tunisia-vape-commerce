import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AdminInventoryQueryDto } from './admin-read-query.dto';

describe('administrator inventory product type validation', () => {
  it.each(['PREFILLED_POD_KIT', 'PREFILLED_REPLACEMENT_POD'] as const)(
    'accepts the %s inventory filter',
    async (productType) => {
      const input = plainToInstance(AdminInventoryQueryDto, { productType });

      await expect(validate(input)).resolves.toHaveLength(0);
    },
  );
});
