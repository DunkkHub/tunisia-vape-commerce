import { screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { json, renderRoute, requestUrl } from './test-app';

beforeEach(() => {
  document.documentElement.lang = 'fr';
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes('/auth/admin/session')) {
        return Promise.resolve(
          json({
            user: {
              id: 'admin-1',
              email: 'admin@local.test',
              name: 'Administrateur',
              roles: ['super-administrator'],
              permissions: ['inventory.read'],
            },
          }),
        );
      }
      if (url.includes('/admin/inventory?')) {
        const totals = { onHandQuantity: 10, reservedQuantity: 3, remainingQuantity: 7 };
        return Promise.resolve(
          json({
            items: [
              {
                id: 'variant-1',
                productId: 'product-1',
                sku: 'MENTHE-01',
                name: 'Produit / Menthe',
                productName: 'Produit',
                variantName: 'Menthe',
                brand: { id: 'brand-1', name: 'Marque test', slug: 'marque-test' },
                brandName: 'Marque test',
                productType: 'E_LIQUID',
                flavor: 'Menthe',
                ...totals,
                availableQuantity: 7,
                lowStockThreshold: 2,
                status: 'IN_STOCK',
                publicationStatus: 'PUBLISHED',
                productPublicationStatus: 'PUBLISHED',
                updatedAt: '2026-07-12T10:00:00.000Z',
              },
            ],
            page: 1,
            pageSize: 20,
            total: 1,
            totalPages: 1,
            asOf: '2026-07-12T10:00:00.000Z',
            availabilityDefinition: 'Derived stock.',
            grouping: {
              scope: 'FILTERED_RESULT',
              byBrand: [{ brandId: 'brand-1', brandName: 'Marque test', ...totals }],
              byProductType: [{ productType: 'E_LIQUID', ...totals }],
              byFlavor: [{ flavor: 'Menthe', ...totals }],
              byBrandAndFlavor: [
                { brandId: 'brand-1', brandName: 'Marque test', flavor: 'Menthe', ...totals },
              ],
            },
          }),
        );
      }
      return Promise.resolve(json({}));
    }),
  );
});

it('shows remaining stock grouped by brand, type, and flavor', async () => {
  renderRoute('/admin/inventory');

  expect(await screen.findByRole('heading', { level: 1, name: 'Stock' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Stock par marque' })).toBeInTheDocument();
  expect(screen.getByText('Marque test · Menthe')).toBeInTheDocument();
  expect(screen.getAllByText('7').length).toBeGreaterThan(0);
  expect(screen.getByText('MENTHE-01')).toBeInTheDocument();
});
