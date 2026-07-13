import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { calculateInventoryAdjustment } from './admin-inventory.service';
import { CreateInventoryLocationDto } from './dto/admin-inventory.dto';

describe('inventory adjustment calculation', () => {
  it('calculates additions, removals, and exact stock corrections using integers', () => {
    expect(calculateInventoryAdjustment(5, 'ADD', 3)).toEqual({
      quantityDelta: 3,
      onHandAfter: 8,
    });
    expect(calculateInventoryAdjustment(5, 'REMOVE', 2)).toEqual({
      quantityDelta: -2,
      onHandAfter: 3,
    });
    expect(calculateInventoryAdjustment(5, 'SET', undefined, 1)).toEqual({
      quantityDelta: -4,
      onHandAfter: 1,
    });
  });

  it('rejects negative physical stock and zero corrections', () => {
    expect(() => calculateInventoryAdjustment(1, 'REMOVE', 2)).toThrow(ConflictException);
    expect(() => calculateInventoryAdjustment(1, 'SET', undefined, 1)).toThrow(BadRequestException);
  });

  it('rejects ambiguous operation payloads', () => {
    expect(() => calculateInventoryAdjustment(2, 'ADD', undefined)).toThrow(BadRequestException);
    expect(() => calculateInventoryAdjustment(2, 'SET', 1, 4)).toThrow(BadRequestException);
  });
});

describe('inventory location input', () => {
  it('rejects a whitespace-only location name', () => {
    const input = plainToInstance(CreateInventoryLocationDto, {
      code: 'WAREHOUSE_1',
      name: '   ',
    });

    expect(validateSync(input).some((error) => error.property === 'name')).toBe(true);
  });
});
