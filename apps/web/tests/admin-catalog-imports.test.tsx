import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adminDataClient } from '../src/api/admin-data-client';
import type { AdminCatalogImportBatch, AdminCatalogImportRow } from '../src/api/types';
import { json, renderRoute, requestUrl } from './test-app';

const administrator = {
  id: 'admin-import-1',
  email: 'catalog@example.test',
  name: 'Responsable catalogue',
  roles: ['Catalog Administrator'],
  permissions: ['products.read', 'catalog.import'],
};

function importRow(
  rowNumber: number,
  status: AdminCatalogImportRow['status'],
): AdminCatalogImportRow {
  return {
    id: `row-${rowNumber}`,
    rowNumber,
    stableIdentity: `wotofo:nexbar-${rowNumber}:20:flavor-${rowNumber}`,
    payloadHash: 'a'.repeat(64),
    status,
    action: status === 'INVALID' ? 'REJECT' : 'CREATE_OR_UPDATE',
    issues:
      status === 'INVALID'
        ? [{ code: 'CATALOG_IMPORT_DUPLICATE_SKU', field: 'sku', message: 'Duplicate SKU.' }]
        : [],
    beforeSnapshot: null,
    afterSnapshot: null,
    productId: null,
    variantId: null,
    productPostVersion: null,
    postVersion: null,
    createdAt: '2026-07-20T10:00:00.000Z',
  };
}

function batch(overrides: Partial<AdminCatalogImportBatch> = {}): AdminCatalogImportBatch {
  return {
    id: 'preview-1',
    importKey: 'wotofo-review-2026-07-20',
    dryRun: true,
    payloadHash: 'b'.repeat(64),
    format: 'CSV',
    source: 'ADMIN_UPLOAD',
    schemaVersion: '1.0',
    status: 'PREVIEW_VALID',
    partialMode: true,
    overridePrice: true,
    overrideStatus: false,
    overrideImages: false,
    rowCount: 2,
    appliedCount: 0,
    result: { validCount: 1, invalidCount: 1, duplicateCount: 1, canApply: true },
    previewBatchId: null,
    createdByUserId: administrator.id,
    createdAt: '2026-07-20T10:00:00.000Z',
    completedAt: '2026-07-20T10:00:01.000Z',
    rolledBackAt: null,
    rows: [importRow(1, 'VALID'), importRow(2, 'INVALID')],
    ...overrides,
  };
}

function installImportFetch(
  historyItems: AdminCatalogImportBatch[] = [],
  user: typeof administrator = administrator,
) {
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes('/auth/admin/session')) return Promise.resolve(json({ user }));
    if (url.includes('/admin/catalog/imports?')) {
      return Promise.resolve(
        json({
          items: historyItems,
          page: 1,
          pageSize: 20,
          total: historyItems.length,
          totalPages: historyItems.length > 0 ? 1 : 0,
        }),
      );
    }
    const detail = historyItems.find((item) => url.endsWith(`/admin/catalog/imports/${item.id}`));
    if (detail) return Promise.resolve(json(detail));
    return Promise.resolve(json({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('administrator catalogue import workflow', () => {
  beforeEach(() => {
    document.documentElement.lang = 'fr';
    document.cookie = 'vape_admin_csrf=test-csrf; Path=/';
    vi.restoreAllMocks();
  });

  it('exposes a permission-scoped route with bounded empty history and explicit import controls', async () => {
    const fetchMock = installImportFetch();

    renderRoute('/admin/catalog/imports');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Imports du catalogue' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Imports catalogue' })).toHaveAttribute(
      'href',
      '/admin/catalog/imports',
    );
    expect(await screen.findByText('Aucun import enregistré')).toBeVisible();
    expect(
      screen.getByLabelText('Autoriser un import partiel des lignes valides'),
    ).not.toBeChecked();
    expect(
      screen.getByLabelText('Autoriser le remplacement des prix maintenus manuellement'),
    ).not.toBeChecked();
    expect(
      screen.getByLabelText('Autoriser le remplacement des images existantes'),
    ).not.toBeChecked();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        requestUrl(input).includes('/admin/catalog/imports?page=1&pageSize=20'),
      ),
    ).toBe(true);
  });

  it('does not expose import controls or request history without catalog.import', async () => {
    const fetchMock = installImportFetch([], {
      ...administrator,
      id: 'admin-read-only',
      permissions: ['products.read'],
    });

    renderRoute('/admin/catalog/imports');

    expect(
      await screen.findByText('Votre rôle ne permet pas d’accéder à cette section.'),
    ).toBeVisible();
    expect(screen.queryByLabelText('Fichier catalogue')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => requestUrl(input).includes('/admin/catalog/imports?')),
    ).toBe(false);
  });

  it('previews a CSV with explicit overrides, renders row errors and requires apply confirmation', async () => {
    installImportFetch();
    const previewBatch = batch();
    const appliedBatch = batch({
      id: 'applied-1',
      dryRun: false,
      status: 'APPLIED_WITH_WARNINGS',
      appliedCount: 1,
      previewBatchId: previewBatch.id,
      result: { rowsApplied: 1, rowsSkipped: 1, manualPricingRequired: true },
    });
    const previewSpy = vi
      .spyOn(adminDataClient, 'previewCatalogImport')
      .mockResolvedValue(previewBatch);
    const applySpy = vi
      .spyOn(adminDataClient, 'applyCatalogImport')
      .mockResolvedValue(appliedBatch);
    const user = userEvent.setup();

    renderRoute('/admin/catalog/imports');
    await screen.findByRole('heading', { level: 1, name: 'Imports du catalogue' });
    await user.type(screen.getAllByLabelText('Clé unique du lot')[0]!, previewBatch.importKey);
    await user.upload(
      screen.getByLabelText('Fichier catalogue'),
      new File(['schemaVersion,productKey\n'], 'catalog.csv', { type: 'text/csv' }),
    );
    await user.click(screen.getByLabelText('Autoriser un import partiel des lignes valides'));
    await user.click(
      screen.getByLabelText('Autoriser le remplacement des prix maintenus manuellement'),
    );
    fireEvent.submit(
      screen.getByRole('button', { name: 'Valider et prévisualiser' }).closest('form')!,
    );

    await waitFor(() => expect(previewSpy).toHaveBeenCalledTimes(1));
    expect(previewSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        importKey: previewBatch.importKey,
        format: 'CSV',
        partialMode: true,
        overridePrice: true,
        overrideStatus: false,
        overrideImages: false,
      }),
      expect.any(Function),
    );
    expect(await screen.findByText('CATALOG_IMPORT_DUPLICATE_SKU')).toBeVisible();
    expect(screen.getByText('Duplicate SKU.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Appliquer ce lot' }));
    expect(screen.getByRole('dialog')).toBeVisible();

    fireEvent.change(screen.getByLabelText(/Saisissez APPLY_CATALOG_IMPORT/), {
      target: { value: 'APPLY_CATALOG_IMPORT' },
    });
    await user.click(screen.getByRole('button', { name: 'Appliquer ce lot' }));
    await waitFor(() => expect(applySpy).toHaveBeenCalledWith(previewBatch.id));
    expect(await screen.findByText('Appliqué avec avertissements')).toBeVisible();
  }, 15_000);

  it('offers allowlisted media import for an applied administrator batch and warns on override', async () => {
    const applied = batch({
      id: 'operator-media-applied',
      importKey: 'operator-media-v1',
      dryRun: false,
      status: 'APPLIED',
      source: 'ADMIN_UPLOAD',
      format: 'JSON',
      overrideImages: true,
      rowCount: 1,
      appliedCount: 1,
      result: { rowsApplied: 1 },
      rows: [
        {
          ...importRow(1, 'CREATED'),
          productId: 'product-1',
          variantId: 'variant-1',
          productPostVersion: 1,
          postVersion: 1,
        },
      ],
    });
    installImportFetch([applied]);
    const mediaSpy = vi.spyOn(adminDataClient, 'importCatalogMedia').mockResolvedValue({
      batch: applied,
      report: {
        successful: [
          { owner: 'PRODUCT', productKey: 'operator-product', imageId: 'operator-image-1' },
        ],
        missing: [
          { owner: 'VARIANT', productKey: 'operator-product', code: 'SOURCE_IMAGE_MISSING' },
        ],
        rejected: [
          {
            owner: 'VARIANT',
            productKey: 'operator-product',
            variantKey: 'berry',
            code: 'CATALOG_MEDIA_CONTENT_TYPE_REJECTED',
          },
        ],
        duplicates: [
          { owner: 'VARIANT', productKey: 'operator-product', code: 'USES_PRODUCT_FALLBACK' },
        ],
        productsRequiringManualReview: ['operator-product'],
      },
    });
    const user = userEvent.setup();

    renderRoute('/admin/catalog/imports');
    await screen.findByText('operator-media-v1');
    await user.click(screen.getByRole('button', { name: 'Voir le reçu' }));
    await user.click(screen.getByRole('button', { name: 'Importer les médias du lot' }));
    expect(screen.getByText(/explicitement autorisé le remplacement/)).toBeVisible();
    await user.type(
      screen.getByLabelText(/Saisissez IMPORT_CATALOG_MEDIA/),
      'IMPORT_CATALOG_MEDIA',
    );
    await user.click(screen.getByRole('button', { name: 'Importer les médias du lot' }));

    await waitFor(() => expect(mediaSpy).toHaveBeenCalledWith(applied.id));
    expect(await screen.findByText('CATALOG_MEDIA_CONTENT_TYPE_REJECTED')).toBeVisible();
    expect(screen.getByText('SOURCE_IMAGE_MISSING')).toBeVisible();
    expect(screen.getByText('USES_PRODUCT_FALLBACK')).toBeVisible();
    expect(screen.getAllByText('operator-product').length).toBeGreaterThan(1);
  }, 15_000);

  it('previews the official Wotofo source and confirms create-only rollback from history', async () => {
    const applied = batch({
      id: 'applied-create-only',
      importKey: 'wotofo-official-verified',
      dryRun: false,
      source: 'WOTOFO_OFFICIAL',
      format: 'WOTOFO',
      status: 'APPLIED',
      partialMode: false,
      overridePrice: false,
      rowCount: 1,
      appliedCount: 1,
      result: { rowsApplied: 1 },
      rows: [
        {
          ...importRow(1, 'CREATED'),
          productId: 'product-1',
          variantId: 'variant-1',
          productPostVersion: 1,
          postVersion: 1,
        },
      ],
    });
    installImportFetch([applied]);
    const officialPreview = batch({
      id: 'official-preview-2',
      importKey: 'wotofo-official-next',
      source: 'WOTOFO_OFFICIAL',
      format: 'WOTOFO',
      partialMode: false,
      overridePrice: false,
    });
    const wotofoSpy = vi
      .spyOn(adminDataClient, 'previewOfficialWotofoCatalog')
      .mockResolvedValue(officialPreview);
    const rollbackSpy = vi.spyOn(adminDataClient, 'rollbackCatalogImport').mockResolvedValue(
      batch({
        ...applied,
        status: 'ROLLED_BACK',
        rolledBackAt: '2026-07-20T11:00:00.000Z',
      }),
    );
    const mediaSpy = vi.spyOn(adminDataClient, 'importCatalogMedia').mockResolvedValue({
      batch: applied,
      report: {
        successful: [{ imageId: 'image-1' }],
        missing: [],
        rejected: [],
        duplicates: [],
        productsRequiringManualReview: [],
      },
    });
    const user = userEvent.setup();

    renderRoute('/admin/catalog/imports');
    await screen.findByText('wotofo-official-verified');
    const wotofoKey = screen.getAllByLabelText('Clé unique du lot')[1]!;
    await user.type(wotofoKey, officialPreview.importKey);
    await user.click(screen.getByRole('button', { name: 'Vérifier les sources Wotofo' }));
    await waitFor(() => expect(wotofoSpy).toHaveBeenCalledWith(officialPreview.importKey));

    await user.click(screen.getByRole('button', { name: 'Voir le reçu' }));
    expect((await screen.findAllByText('Import appliqué')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Importer les médias du lot' }));
    expect(screen.getByText(/images du lot/)).toBeVisible();
    await user.type(
      screen.getByLabelText(/Saisissez IMPORT_CATALOG_MEDIA/),
      'IMPORT_CATALOG_MEDIA',
    );
    await user.click(screen.getByRole('button', { name: 'Importer les médias du lot' }));
    await waitFor(() => expect(mediaSpy).toHaveBeenCalledWith(applied.id));
    await user.click(screen.getByRole('button', { name: 'Archiver les créations de ce lot' }));
    expect(screen.getByText(/réservé aux imports ayant uniquement créé/)).toBeVisible();
    await user.type(
      screen.getByLabelText(/Saisissez ROLLBACK_CATALOG_IMPORT/),
      'ROLLBACK_CATALOG_IMPORT',
    );
    await user.click(screen.getByRole('button', { name: 'Archiver les créations de ce lot' }));
    await waitFor(() => expect(rollbackSpy).toHaveBeenCalledWith(applied.id));
    expect(await screen.findByText('Créations archivées')).toBeVisible();
  }, 15_000);
});
