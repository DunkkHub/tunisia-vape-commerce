import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CatalogProductsQueryDto } from './catalog-query.dto';

describe('CatalogProductsQueryDto', () => {
  it('accepts a combined public catalog filter and converts prices to integers', async () => {
    const query = plainToInstance(CatalogProductsQueryDto, {
      brand: 'nexa',
      productType: 'PREFILLED_REPLACEMENT_POD',
      flavor: 'menthe',
      puffCount: '15000',
      nicotineStrengthMg: '20.125',
      minPriceMillimes: '10000',
      maxPriceMillimes: '25000',
    });

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query).toMatchObject({
      productType: 'PREFILLED_REPLACEMENT_POD',
      puffCount: 15_000,
      nicotineStrengthMg: 20.125,
      minPriceMillimes: 10_000,
      maxPriceMillimes: 25_000,
    });
  });

  it('rejects a maximum price below the minimum price', async () => {
    const query = plainToInstance(CatalogProductsQueryDto, {
      minPriceMillimes: '25000',
      maxPriceMillimes: '10000',
    });
    const errors = await validate(query);

    expect(errors.some((error) => error.property === 'maxPriceMillimes')).toBe(true);
  });

  it('rejects negative, fractional and non-enum filters', async () => {
    const query = plainToInstance(CatalogProductsQueryDto, {
      productType: 'UNKNOWN',
      flavor: '   ',
      puffCount: '0',
      nicotineStrengthMg: '100000.001',
      minPriceMillimes: '-1',
      maxPriceMillimes: '1.5',
    });
    const errors = await validate(query);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'productType',
        'flavor',
        'puffCount',
        'nicotineStrengthMg',
        'minPriceMillimes',
        'maxPriceMillimes',
      ]),
    );
  });
});
