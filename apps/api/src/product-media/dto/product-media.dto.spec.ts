import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  ProductMediaListQueryDto,
  PublicMediaRenditionParamDto,
  ReviewProductImageDto,
} from './product-media.dto';

describe('product media DTOs', () => {
  it('accepts only the exact explicit image-review confirmation', async () => {
    const valid = plainToInstance(ReviewProductImageDto, {
      expectedOwnerVersion: 4,
      decision: 'APPROVE',
      confirmation: 'REVIEW_IMPORTED_PRODUCT_IMAGE',
    });
    const invalid = plainToInstance(ReviewProductImageDto, {
      expectedOwnerVersion: 4,
      decision: 'APPROVE',
      confirmation: 'APPROVE',
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(validate(invalid)).resolves.not.toHaveLength(0);
  });

  it('transforms the bounded unresolved-review queue query flag', async () => {
    const query = plainToInstance(ProductMediaListQueryDto, {
      page: '2',
      pageSize: '50',
      reviewRequired: 'true',
    });

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query).toMatchObject({ page: 2, pageSize: 50, reviewRequired: true });
  });

  it('accepts only a fixed storefront rendition name and a SHA-256 media coordinate', async () => {
    const valid = plainToInstance(PublicMediaRenditionParamDto, {
      objectKeyHash: 'a'.repeat(64),
      rendition: 'high-resolution',
      profileVersion: 'v1',
    });
    const invalid = plainToInstance(PublicMediaRenditionParamDto, {
      objectKeyHash: '../source',
      rendition: '../../original',
      profileVersion: 'latest',
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.profileVersion).toBe(1);
    await expect(validate(invalid)).resolves.not.toHaveLength(0);
  });
});
