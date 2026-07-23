import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CatalogImportPreviewDto, ImportCatalogMediaDto } from './catalog-import.dto';

describe('catalog import DTOs', () => {
  it('parses the explicit multipart image override and defaults it off', async () => {
    const enabled = plainToInstance(CatalogImportPreviewDto, {
      importKey: 'operator-catalog-v1',
      format: 'JSON',
      overrideImages: 'true',
    });
    const safeDefault = plainToInstance(CatalogImportPreviewDto, {
      importKey: 'operator-catalog-v2',
      format: 'CSV',
    });

    await expect(validate(enabled)).resolves.toHaveLength(0);
    await expect(validate(safeDefault)).resolves.toHaveLength(0);
    expect(enabled.overrideImages).toBe(true);
    expect(safeDefault.overrideImages).toBe(false);
  });

  it('requires the exact catalog media confirmation phrase', async () => {
    const accepted = plainToInstance(ImportCatalogMediaDto, {
      confirmation: 'IMPORT_CATALOG_MEDIA',
    });
    const rejected = plainToInstance(ImportCatalogMediaDto, {
      confirmation: 'IMPORT_VERIFIED_WOTOFO_MEDIA',
    });

    await expect(validate(accepted)).resolves.toHaveLength(0);
    await expect(validate(rejected)).resolves.not.toHaveLength(0);
  });
});
