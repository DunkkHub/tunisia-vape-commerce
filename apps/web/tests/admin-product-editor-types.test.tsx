import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json, renderRoute, requestUrl, statusPayload } from './test-app';

const adminUser = {
  id: 'admin-1',
  email: 'catalog@example.test',
  name: 'Responsable catalogue',
  roles: ['catalog-manager'],
  permissions: ['products.read', 'products.write'],
};

const category = {
  id: 'category-1',
  parentId: null,
  nameFr: 'Pods préremplis',
  nameAr: 'بودات معبأة مسبقًا',
  slug: 'pods-preremplis',
  descriptionFr: null,
  descriptionAr: null,
  sortOrder: 0,
  publicationStatus: 'PUBLISHED',
  productCount: 0,
  childCount: 0,
  createdAt: '2026-07-21T10:00:00.000Z',
  updatedAt: '2026-07-21T10:00:00.000Z',
};

const flaggedProduct = {
  id: 'product-1',
  categoryId: category.id,
  brandId: null,
  nameFr: 'Kit prérempli contrôlé',
  nameAr: 'طقم معبأ مراجع',
  slug: 'kit-prerempli-controle',
  sku: null,
  barcode: null,
  productType: 'PREFILLED_POD_KIT',
  flavor: null,
  shortDescriptionFr: null,
  shortDescriptionAr: null,
  descriptionFr: null,
  descriptionAr: null,
  containsNicotine: false,
  baseCostMillimes: null,
  basePriceMillimes: 89_000,
  promotionalPriceMillimes: null,
  taxRateBps: null,
  warningFr: null,
  warningAr: null,
  minimumAge: 18,
  publicationStatus: 'PUBLISHED',
  featured: false,
  requiresPricing: false,
  requiresStock: false,
  needsMediaReview: true,
  version: 7,
};

const page = <T,>(items: T[]) => ({
  items,
  page: 1,
  pageSize: 50,
  total: items.length,
  totalPages: items.length > 0 ? 1 : 0,
});

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body.');
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe('administrator product editor product types', () => {
  beforeEach(() => {
    document.documentElement.lang = 'fr';
    document.cookie = 'vape_admin_csrf=test-admin-csrf; Path=/';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('offers both prefilled types and submits the selected value', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
      if (url.includes('/auth/admin/session')) return Promise.resolve(json({ user: adminUser }));
      if (url.includes('/admin/categories?')) return Promise.resolve(json(page([category])));
      if (url.includes('/admin/brands?')) return Promise.resolve(json(page([])));
      if (url.endsWith('/admin/products') && method === 'POST') {
        return Promise.resolve(
          json({
            id: 'product-1',
            categoryId: category.id,
            brandId: null,
            nameFr: 'Kit prérempli',
            nameAr: 'طقم معبأ مسبقًا',
            slug: 'kit-prerempli',
            productType: 'PREFILLED_POD_KIT',
            publicationStatus: 'DRAFT',
            version: 1,
          }),
        );
      }

      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/catalog/new');

    const productType = await screen.findByLabelText('Type de produit');
    expect(productType).toHaveAccessibleName('Type de produit');
    expect(screen.getByRole('option', { name: 'Kit pod prérempli' })).toHaveValue(
      'PREFILLED_POD_KIT',
    );
    expect(screen.getByRole('option', { name: 'Cartouche préremplie' })).toHaveValue(
      'PREFILLED_REPLACEMENT_POD',
    );

    await user.type(screen.getByLabelText('Nom en français'), 'Kit prérempli');
    await user.type(screen.getByLabelText('Nom en arabe'), 'طقم معبأ مسبقًا');
    await user.type(screen.getByLabelText('Identifiant URL'), 'kit-prerempli');
    await user.selectOptions(screen.getByLabelText('Identifiant catégorie'), category.id);
    await user.selectOptions(productType, 'PREFILLED_POD_KIT');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le produit' }));

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(
        ([input, init]) => requestUrl(input).endsWith('/admin/products') && init?.method === 'POST',
      );
      expect(requestBody(createCall?.[1])).toMatchObject({
        productType: 'PREFILLED_POD_KIT',
      });
    });
  });

  it('requires an explicit media-review acknowledgement and sends it for a flagged product', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
      if (url.includes('/auth/admin/session')) return Promise.resolve(json({ user: adminUser }));
      if (url.includes('/admin/categories?')) return Promise.resolve(json(page([category])));
      if (url.includes('/admin/brands?')) return Promise.resolve(json(page([])));
      if (url.includes('/admin/products/product-1/variants')) {
        return Promise.resolve(json(page([])));
      }
      if (url.includes('/admin/products/product-1/images?')) {
        return Promise.resolve(json(page([])));
      }
      if (url.endsWith('/admin/products/product-1') && method === 'PATCH') {
        return Promise.resolve(json({ ...flaggedProduct, needsMediaReview: false, version: 8 }));
      }
      if (url.endsWith('/admin/products/product-1')) {
        return Promise.resolve(json(flaggedProduct));
      }

      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/catalog/product-1/edit');

    const reviewConfirmation = await screen.findByRole('checkbox', {
      name: /Je confirme avoir vérifié que chaque image importée/i,
    });
    expect(reviewConfirmation).not.toBeChecked();
    await user.click(reviewConfirmation);
    expect(reviewConfirmation).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Enregistrer le produit' }));

    await waitFor(() => {
      const updateCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith('/admin/products/product-1') && init?.method === 'PATCH',
      );
      expect(requestBody(updateCall?.[1])).toMatchObject({
        version: 7,
        publicationStatus: 'PUBLISHED',
        mediaReviewConfirmed: true,
      });
    });
  });
});
