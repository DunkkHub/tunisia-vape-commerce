import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  ConfirmProductMediaReviewDto,
  CreateProductDto,
  UpdateProductDto,
} from './admin-product.dto';

const prefilledProductTypes = ['PREFILLED_POD_KIT', 'PREFILLED_REPLACEMENT_POD'] as const;

describe('administrator product type validation', () => {
  it.each(prefilledProductTypes)('accepts %s when creating a product', async (productType) => {
    const input = plainToInstance(CreateProductDto, {
      categoryId: 'category-1',
      nameFr: 'Produit prérempli',
      nameAr: 'منتج معبأ مسبقًا',
      slug: `produit-${productType.toLowerCase().replaceAll('_', '-')}`,
      productType,
    });

    await expect(validate(input)).resolves.toHaveLength(0);
  });

  it.each(prefilledProductTypes)('accepts %s when updating a product', async (productType) => {
    const input = plainToInstance(UpdateProductDto, { version: 1, productType });

    await expect(validate(input)).resolves.toHaveLength(0);
  });

  it('continues to reject unknown product types', async () => {
    const input = plainToInstance(UpdateProductDto, {
      version: 1,
      productType: 'PREFILLED_UNKNOWN',
    });

    const errors = await validate(input);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('productType');
  });

  it('accepts media-review confirmation only as an explicit boolean', async () => {
    const valid = plainToInstance(UpdateProductDto, {
      version: 1,
      publicationStatus: 'PUBLISHED',
      mediaReviewConfirmed: true,
    });
    const invalid = plainToInstance(UpdateProductDto, {
      version: 1,
      publicationStatus: 'PUBLISHED',
      mediaReviewConfirmed: 'true',
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(validate(invalid)).resolves.not.toHaveLength(0);
  });

  it('requires an optimistic version, audit reason and exact draft-review confirmation', async () => {
    const valid = plainToInstance(ConfirmProductMediaReviewDto, {
      version: 7,
      reason: 'Every imported image was compared with its exact product variant.',
      confirmation: 'CONFIRM_PRODUCT_MEDIA_REVIEW',
    });
    const invalidConfirmation = plainToInstance(ConfirmProductMediaReviewDto, {
      version: 7,
      reason: 'Reviewed every candidate.',
      confirmation: 'CONFIRM_REVIEW',
    });
    const missingReason = plainToInstance(ConfirmProductMediaReviewDto, {
      version: 7,
      confirmation: 'CONFIRM_PRODUCT_MEDIA_REVIEW',
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(validate(invalidConfirmation)).resolves.not.toHaveLength(0);
    await expect(validate(missingReason)).resolves.not.toHaveLength(0);
  });
});
