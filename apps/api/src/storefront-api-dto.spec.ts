import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateCustomerAddressDto } from './customer-addresses/dto/customer-address.dto';
import { StorefrontContentSlugParamDto } from './storefront-content/dto/storefront-content.dto';
import { WishlistQueryDto } from './wishlist/dto/wishlist.dto';

describe('storefront API DTO validation', () => {
  it('normalizes a Tunisian address phone and accepts bounded identifiers', async () => {
    const input = plainToInstance(CreateCustomerAddressDto, {
      fullName: ' Customer Name ',
      phone: '20 111 222',
      governorateId: 'governorate-1',
      delegationId: 'delegation-1',
      localityId: 'locality-1',
      postalCode: '1000',
      street: ' 1 Example Street ',
    });

    expect(await validate(input)).toHaveLength(0);
    expect(input.fullName).toBe('Customer Name');
    expect(input.phone).toBe('+21620111222');
    expect(input.street).toBe('1 Example Street');
  });

  it('rejects unbounded wishlist pages and malformed public-content slugs', async () => {
    const query = plainToInstance(WishlistQueryDto, { page: 1, pageSize: 51 });
    const slug = plainToInstance(StorefrontContentSlugParamDto, { slug: '../draft-policy' });

    expect(await validate(query)).not.toHaveLength(0);
    expect(await validate(slug)).not.toHaveLength(0);
  });
});
