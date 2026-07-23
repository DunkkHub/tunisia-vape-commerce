import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminBrandTaxonomy, AdminCategoryTaxonomy } from '../src/api/types';
import { json, renderRoute, requestUrl } from './test-app';

const adminUser = {
  id: 'admin-self',
  email: 'operations@example.test',
  name: 'Responsable opérations',
  roles: ['operations'],
  permissions: [
    'products.read',
    'products.write',
    'categories.manage',
    'brands.manage',
    'inventory.read',
    'inventory.adjust',
    'inventory.approve',
    'inventory.transfer',
    'cash.read',
    'cash.collect',
    'cash.reconcile',
  ],
};

const page = <T,>(items: T[]) => ({
  items,
  page: 1,
  pageSize: 50,
  total: items.length,
  totalPages: items.length > 0 ? 1 : 0,
});

const category = {
  id: 'category-1',
  parentId: null,
  nameFr: 'Puffs',
  nameAr: 'باف',
  slug: 'puffs',
  descriptionFr: null,
  descriptionAr: null,
  sortOrder: 0,
  publicationStatus: 'DRAFT',
  productCount: 0,
  childCount: 0,
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
} as const;

const brand = {
  id: 'brand-1',
  name: 'PUFFJET',
  slug: 'puffjet',
  descriptionFr: null,
  descriptionAr: null,
  publicationStatus: 'DRAFT',
  productCount: 0,
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
} as const;

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body.');
  return JSON.parse(init.body) as Record<string, unknown>;
}

beforeEach(() => {
  document.documentElement.lang = 'fr';
  document.cookie = 'vape_admin_csrf=test-admin-csrf; Path=/';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fresh-store product taxonomy', () => {
  it('creates, publishes, and selects the first category and brand', async () => {
    const publishedCategories: AdminCategoryTaxonomy[] = [];
    const publishedBrands: AdminBrandTaxonomy[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/auth/admin/session')) return Promise.resolve(json({ user: adminUser }));
      if (url.includes('/admin/categories?')) {
        return Promise.resolve(json(page(publishedCategories)));
      }
      if (url.endsWith('/admin/categories') && method === 'POST') {
        return Promise.resolve(json(category));
      }
      if (url.endsWith('/admin/categories/category-1') && method === 'PATCH') {
        const published = { ...category, publicationStatus: 'PUBLISHED' } as const;
        publishedCategories.splice(0, publishedCategories.length, published);
        return Promise.resolve(json(published));
      }
      if (url.includes('/admin/brands?')) return Promise.resolve(json(page(publishedBrands)));
      if (url.endsWith('/admin/brands') && method === 'POST') {
        return Promise.resolve(json(brand));
      }
      if (url.endsWith('/admin/brands/brand-1') && method === 'PATCH') {
        const published = { ...brand, publicationStatus: 'PUBLISHED' } as const;
        publishedBrands.splice(0, publishedBrands.length, published);
        return Promise.resolve(json(published));
      }
      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/catalog/new');

    const foundation = await screen.findByRole('region', { name: 'Préparer le catalogue' });
    const categoryButton = within(foundation).getByRole('button', {
      name: 'Créer et publier la catégorie',
    });
    const categoryForm = categoryButton.closest('form');
    if (!categoryForm) throw new Error('Expected the category form.');
    await user.type(within(categoryForm).getByLabelText('Nom en français'), 'Puffs');
    await user.type(within(categoryForm).getByLabelText('Nom en arabe'), 'باف');
    await user.type(within(categoryForm).getByLabelText('Identifiant URL'), 'puffs');
    await user.click(categoryButton);

    expect(
      await screen.findByText('La catégorie a été créée, publiée et sélectionnée.'),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByLabelText('Identifiant catégorie')).toHaveValue('category-1'),
    );

    const brandButton = within(foundation).getByRole('button', {
      name: 'Créer et publier la marque',
    });
    const brandForm = brandButton.closest('form');
    if (!brandForm) throw new Error('Expected the brand form.');
    await user.type(within(brandForm).getByLabelText('Nom de la marque'), 'PUFFJET');
    await user.type(within(brandForm).getByLabelText('Identifiant URL'), 'puffjet');
    await user.click(brandButton);

    expect(
      await screen.findByText('La marque a été créée, publiée et sélectionnée.'),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByLabelText('Identifiant marque (facultatif)')).toHaveValue('brand-1'),
    );

    const categoryCreate = fetchMock.mock.calls.find(
      ([input, init]) => requestUrl(input).endsWith('/admin/categories') && init?.method === 'POST',
    );
    const categoryPublish = fetchMock.mock.calls.find(([input, init]) => {
      return requestUrl(input).endsWith('/admin/categories/category-1') && init?.method === 'PATCH';
    });
    const brandCreate = fetchMock.mock.calls.find(
      ([input, init]) => requestUrl(input).endsWith('/admin/brands') && init?.method === 'POST',
    );
    const brandPublish = fetchMock.mock.calls.find(([input, init]) => {
      return requestUrl(input).endsWith('/admin/brands/brand-1') && init?.method === 'PATCH';
    });
    expect(requestBody(categoryCreate?.[1])).toEqual({
      nameFr: 'Puffs',
      nameAr: 'باف',
      slug: 'puffs',
    });
    expect(requestBody(categoryPublish?.[1])).toEqual({
      expectedUpdatedAt: category.updatedAt,
      publicationStatus: 'PUBLISHED',
    });
    expect(requestBody(brandCreate?.[1])).toEqual({ name: 'PUFFJET', slug: 'puffjet' });
    expect(requestBody(brandPublish?.[1])).toEqual({
      expectedUpdatedAt: brand.updatedAt,
      publicationStatus: 'PUBLISHED',
    });
  });
});

const inventoryVariant = {
  id: 'variant-1',
  productId: 'product-1',
  productNameFr: 'PUFFJET Max',
  productNameAr: 'باف جيت ماكس',
  nameFr: 'Menthe glacée',
  nameAr: 'نعناع مثلج',
  sku: 'PUFF-MINT-01',
  lowStockThreshold: 3,
  version: 4,
  onHandQuantity: 12,
  reservedQuantity: 2,
  availableQuantity: 10,
  committedQuantity: 2,
  commitmentPolicy: 'DEDUCT_ON_CONFIRMATION',
  asOf: '2026-07-20T10:00:00.000Z',
  items: [
    {
      id: 'item-source',
      lotKey: 'batch:batch-1',
      location: { id: 'location-source', code: 'TUNIS', name: 'Dépôt Tunis', active: true },
      batch: {
        id: 'batch-1',
        batchNumber: 'LOT-001',
        expiryDate: '2027-07-20',
        archivedAt: null,
      },
      onHandQuantity: 12,
      reservedQuantity: 2,
      availableQuantity: 10,
      committedQuantity: 2,
      version: 7,
      updatedAt: '2026-07-20T10:00:00.000Z',
    },
  ],
} as const;

const pendingAdjustment = (id: string, requestedBy: string) => ({
  id,
  quantityDelta: -2,
  reasonCode: 'STOCK_COUNT_CORRECTION',
  note: 'Comptage physique',
  status: 'PENDING_APPROVAL',
  requestedBy,
  approvedBy: null,
  decisionReason: null,
  expectedVersion: 7,
  onHandBefore: 12,
  proposedOnHandQuantity: 10,
  requestedAt: '2026-07-20T10:00:00.000Z',
  expiresAt: '2026-07-21T10:00:00.000Z',
  decidedAt: null,
  appliedAt: null,
  stockMovementId: null,
  inventoryItem: {
    id: 'item-source',
    version: 7,
    onHandQuantity: 12,
    location: { id: 'location-source', code: 'TUNIS', name: 'Dépôt Tunis' },
    batch: { id: 'batch-1', batchNumber: 'LOT-001', expiryDate: '2027-07-20' },
    variant: {
      id: 'variant-1',
      sku: 'PUFF-MINT-01',
      nameFr: 'Menthe glacée',
      nameAr: 'نعناع مثلج',
    },
  },
});

describe('inventory operational controls', () => {
  it('keeps adjustments pending for dual control and records receipts and transfers explicitly', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/auth/admin/session')) return Promise.resolve(json({ user: adminUser }));
      if (url.endsWith('/admin/inventory/variants/variant-1')) {
        return Promise.resolve(json(inventoryVariant));
      }
      if (url.endsWith('/admin/inventory/locations')) {
        return Promise.resolve(
          json([
            {
              id: 'location-source',
              code: 'TUNIS',
              name: 'Dépôt Tunis',
              address: null,
              active: true,
              fulfillsOrders: true,
              updatedAt: '2026-07-20T10:00:00.000Z',
            },
            {
              id: 'location-destination',
              code: 'BIZ',
              name: 'Dépôt Bizerte',
              address: null,
              active: true,
              fulfillsOrders: true,
              updatedAt: '2026-07-20T10:00:00.000Z',
            },
          ]),
        );
      }
      if (url.includes('/admin/inventory/adjustments?')) {
        return Promise.resolve(
          json(
            page([
              pendingAdjustment('adjustment-self', 'admin-self'),
              pendingAdjustment('adjustment-other', 'admin-requester'),
            ]),
          ),
        );
      }
      if (url.includes('/admin/inventory/transfers?')) return Promise.resolve(json(page([])));
      if (url.endsWith('/admin/inventory/batches/receipts') && method === 'POST') {
        return Promise.resolve(json({ movementId: 'movement-receipt' }));
      }
      if (url.endsWith('/admin/inventory/items/item-source/adjustments') && method === 'POST') {
        return Promise.resolve(
          json({
            adjustmentId: 'adjustment-new',
            inventoryItemId: 'item-source',
            status: 'PENDING_APPROVAL',
            requiresApproval: true,
            proposedOnHandQuantity: 13,
            currentOnHandQuantity: 12,
            reservedQuantity: 2,
            expectedVersion: 7,
            expiresAt: '2026-07-21T10:00:00.000Z',
          }),
        );
      }
      if (
        url.endsWith('/admin/inventory/adjustments/adjustment-other/decision') &&
        method === 'POST'
      ) {
        return Promise.resolve(json({ status: 'APPLIED' }));
      }
      if (url.endsWith('/admin/inventory/items/item-source/transfers') && method === 'POST') {
        return Promise.resolve(json({ transferId: 'transfer-1' }));
      }
      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/inventory/variant-1');

    expect(
      await screen.findByRole('heading', { name: 'PUFFJET Max / Menthe glacée' }),
    ).toBeVisible();
    expect(
      await screen.findByRole('button', { name: 'Un second administrateur doit décider' }),
    ).toBeDisabled();
    const decisionButton = screen.getByRole('button', { name: 'Enregistrer la décision' });
    expect(decisionButton).toBeEnabled();
    await user.click(decisionButton);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        requestUrl(input).endsWith('/admin/inventory/adjustments/adjustment-other/decision'),
      );
      expect(requestBody(call?.[1])).toEqual({ decision: 'APPROVE' });
    });

    const receiptButton = screen.getByRole('button', { name: 'Enregistrer la réception' });
    const receiptForm = receiptButton.closest('form');
    if (!receiptForm) throw new Error('Expected the batch receipt form.');
    await user.selectOptions(
      within(receiptForm).getByLabelText('Emplacement actif'),
      'location-source',
    );
    await user.type(within(receiptForm).getByLabelText('Numéro de lot'), 'LOT-NEW');
    await user.type(within(receiptForm).getByLabelText('Quantité'), '24');
    await user.type(within(receiptForm).getByLabelText('Date d’expiration'), '2027-12-31');
    await user.click(receiptButton);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        requestUrl(input).endsWith('/admin/inventory/batches/receipts'),
      );
      expect(requestBody(call?.[1])).toEqual({
        variantId: 'variant-1',
        locationId: 'location-source',
        batchNumber: 'LOT-NEW',
        expiryDate: '2027-12-31',
        quantity: 24,
      });
      expect(new Headers(call?.[1]?.headers).get('Idempotency-Key')).toMatch(/^admin-web-/);
    });
    expect(
      await screen.findByText('La réception et son mouvement de stock ont été enregistrés.'),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Demander un ajustement' }));
    const adjustmentButton = screen.getByRole('button', { name: 'Soumettre à approbation' });
    const adjustmentForm = adjustmentButton.closest('form');
    if (!adjustmentForm) throw new Error('Expected the adjustment form.');
    await user.type(within(adjustmentForm).getByLabelText('Quantité'), '1');
    await user.click(adjustmentButton);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        requestUrl(input).endsWith('/admin/inventory/items/item-source/adjustments'),
      );
      expect(requestBody(call?.[1])).toEqual({
        operation: 'ADD',
        quantity: 1,
        reasonCode: 'STOCK_COUNT_CORRECTION',
        expectedVersion: 7,
      });
    });
    expect(
      await screen.findByText('L’ajustement attend l’approbation d’un autre administrateur.'),
    ).toBeVisible();

    const transferButton = screen.getByRole('button', { name: 'Transférer le lot' });
    const transferForm = transferButton.closest('form');
    if (!transferForm) throw new Error('Expected the transfer form.');
    await user.selectOptions(
      within(transferForm).getByLabelText('Emplacement de destination'),
      'location-destination',
    );
    await user.type(within(transferForm).getByLabelText('Quantité'), '3');
    await user.type(
      within(transferForm).getByLabelText('Motif ou référence du transfert'),
      'Rééquilibrage dépôt',
    );
    await user.click(transferButton);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        requestUrl(input).endsWith('/admin/inventory/items/item-source/transfers'),
      );
      expect(requestBody(call?.[1])).toEqual({
        destinationLocationId: 'location-destination',
        quantity: 3,
        expectedSourceVersion: 7,
        note: 'Rééquilibrage dépôt',
      });
      expect(new Headers(call?.[1]?.headers).get('Idempotency-Key')).toMatch(/^admin-web-/);
    });
    expect(
      await screen.findByText('Le transfert et ses deux mouvements ont été enregistrés.'),
    ).toBeVisible();
  });
});

const discrepancySummary = {
  id: 'remittance-1',
  remittanceNumber: 'REM-001',
  courierName: 'Livreur Tunis',
  status: 'DISCREPANCY',
  declaredMillimes: 100_000,
  verifiedMillimes: 98_000,
  differenceMillimes: -2_000,
  createdAt: '2026-07-20T10:00:00.000Z',
};

const discrepancyDetail = {
  ...discrepancySummary,
  courier: { id: 'courier-1', code: 'LIV-TUN', name: 'Livreur Tunis' },
  submittedAt: '2026-07-20T10:10:00.000Z',
  remittedAt: '2026-07-20T10:15:00.000Z',
  receivedByUserId: 'admin-cashier',
  verifiedByUserId: 'admin-verifier',
  verifiedAt: '2026-07-20T10:20:00.000Z',
  note: null,
  discrepancies: [
    {
      id: 'discrepancy-self',
      status: 'OPEN',
      expectedMillimes: 100_000,
      actualMillimes: 98_000,
      differenceMillimes: -2_000,
      reasonCode: 'CASH_DIFFERENCE',
      reasonDetail: 'Écart au comptage',
      openedByUserId: 'admin-self',
      resolvedByUserId: null,
      openedAt: '2026-07-20T10:20:00.000Z',
      resolvedAt: null,
    },
    {
      id: 'discrepancy-other',
      status: 'OPEN',
      expectedMillimes: 100_000,
      actualMillimes: 98_000,
      differenceMillimes: -2_000,
      reasonCode: 'CASH_DIFFERENCE',
      reasonDetail: 'Écart au comptage',
      openedByUserId: 'admin-verifier',
      resolvedByUserId: null,
      openedAt: '2026-07-20T10:20:00.000Z',
      resolvedAt: null,
    },
  ],
  historyTruncated: false,
  updatedAt: '2026-07-20T10:20:00.000Z',
};

describe('COD discrepancy dual control', () => {
  it('records cash with a stable operation idempotency key and CSRF protection', async () => {
    const collectionSummary = {
      id: 'collection-1',
      orderNumber: 'TN-000001',
      courierName: 'Livreur Tunis',
      status: 'EXPECTED',
      expectedMillimes: 100_000,
      collectedMillimes: 0,
      collectedAt: null,
    };
    const collectionDetail = {
      ...collectionSummary,
      orderId: 'order-1',
      orderStatus: 'OUT_FOR_DELIVERY',
      paymentStatus: 'CASH_EXPECTED',
      orderVersion: 3,
      deliveryId: 'delivery-1',
      delivery: {
        id: 'delivery-1',
        orderId: 'order-1',
        status: 'OUT_FOR_DELIVERY',
        version: 4,
        courier: { id: 'courier-1', code: 'LIV-TUN', name: 'Livreur Tunis' },
      },
      courierId: 'courier-1',
      collectedByUserId: null,
      method: 'CASH',
      note: null,
      allocations: [],
      discrepancies: [],
      historyTruncated: false,
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: '2026-07-20T10:00:00.000Z',
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/auth/admin/session')) return Promise.resolve(json({ user: adminUser }));
      if (url.includes('/admin/cash/collections?')) {
        return Promise.resolve(json(page([collectionSummary])));
      }
      if (url.endsWith('/admin/cash/collections/collection-1') && method === 'GET') {
        return Promise.resolve(json(collectionDetail));
      }
      if (url.endsWith('/admin/cash/collections/collection-1/record') && method === 'POST') {
        return Promise.resolve(json({ ...collectionDetail, status: 'COLLECTED' }));
      }
      if (url.includes('/admin/cash/remittances?')) return Promise.resolve(json(page([])));
      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/cash');
    await user.click(await screen.findByRole('button', { name: 'Voir les détails' }));
    await user.click(await screen.findByRole('button', { name: /Enregistrer.*encaissement/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        requestUrl(input).endsWith('/admin/cash/collections/collection-1/record'),
      );
      expect(new Headers(call?.[1]?.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Headers(call?.[1]?.headers).get('X-CSRF-Token')).toBe('test-admin-csrf');
      expect(requestBody(call?.[1])).toMatchObject({
        collectedMillimes: 100_000,
        expectedOrderVersion: 3,
        expectedDeliveryVersion: 4,
        confirmation: 'RECORD_COLLECTION',
      });
    });
  });

  it('disables self-resolution and submits the explicit verified resolution payload', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/auth/admin/session')) return Promise.resolve(json({ user: adminUser }));
      if (url.includes('/admin/cash/collections?')) return Promise.resolve(json(page([])));
      if (url.includes('/admin/cash/remittances?')) {
        return Promise.resolve(json(page([discrepancySummary])));
      }
      if (url.endsWith('/admin/cash/remittances/remittance-1')) {
        return Promise.resolve(json(discrepancyDetail));
      }
      if (
        url.endsWith('/admin/cash/discrepancies/discrepancy-other/resolve') &&
        method === 'POST'
      ) {
        return Promise.resolve(json(discrepancyDetail));
      }
      return Promise.resolve(json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/cash');

    await user.click(await screen.findByRole('button', { name: 'Ouvrir l’écart' }));
    expect(
      await screen.findByRole('heading', { name: 'Résolution à double contrôle' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Un second administrateur doit résoudre' }),
    ).toBeDisabled();

    const resolveButton = screen.getByRole('button', { name: 'Résoudre l’écart' });
    const resolutionForm = resolveButton.closest('form');
    if (!resolutionForm) throw new Error('Expected the discrepancy resolution form.');
    const finalAmount = within(resolutionForm).getByLabelText('Montant final vérifié (millimes)');
    await user.clear(finalAmount);
    await user.type(finalAmount, '98000');
    await user.type(
      within(resolutionForm).getByLabelText('Justification détaillée'),
      'Second comptage confirmé',
    );
    await user.click(resolveButton);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        requestUrl(input).endsWith('/admin/cash/discrepancies/discrepancy-other/resolve'),
      );
      expect(requestBody(call?.[1])).toEqual({
        resolution: 'RESOLVED',
        reasonDetail: 'Second comptage confirmé',
        finalVerifiedMillimes: 98_000,
        confirmation: 'RESOLVE_DISCREPANCY',
      });
      expect(new Headers(call?.[1]?.headers).get('X-CSRF-Token')).toBe('test-admin-csrf');
    });
  });
});
