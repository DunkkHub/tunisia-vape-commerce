import { screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
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

const catalogAdminUser = {
  ...adminUser,
  permissions: [...adminUser.permissions, 'categories.manage', 'brands.manage', 'products.archive'],
  requiresRecentAuthentication: false,
};

const draftCategory = {
  ...category,
  publicationStatus: 'DRAFT',
};

const draftBrand = {
  id: 'brand-1',
  name: 'Wotofo',
  slug: 'wotofo',
  descriptionFr: null,
  descriptionAr: null,
  publicationStatus: 'DRAFT',
  productCount: 1,
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

const draftProduct = {
  ...flaggedProduct,
  categoryId: draftCategory.id,
  brandId: draftBrand.id,
  publicationStatus: 'DRAFT',
  needsMediaReview: false,
  requiresPricing: true,
  requiresStock: true,
  version: 5,
};

const draftVariant = {
  id: 'variant-1',
  productId: 'product-1',
  nameFr: 'Argent',
  nameAr: 'فضي',
  sku: 'WOT-AEROKPODKIT-SILVER',
  barcode: null,
  color: 'Silver',
  costMillimes: null,
  priceMillimes: 0,
  promotionalPriceMillimes: null,
  taxRateBps: 0,
  weightGrams: 0,
  lowStockThreshold: 4,
  publicationStatus: 'DRAFT',
  archivedAt: null,
  version: 2,
};

const page = <T,>(items: T[]) => ({
  items,
  page: 1,
  pageSize: 50,
  total: items.length,
  totalPages: items.length > 0 ? 1 : 0,
});

const editorFallback = (url: string): Response =>
  url.includes('/admin/products?') ? json(page([])) : json({});

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body.');
  return JSON.parse(init.body) as Record<string, unknown>;
}

function apiError(
  status: number,
  payload: {
    code: string;
    message: string;
    requestId?: string;
    blockers?: string[];
  },
): Response {
  return new Response(JSON.stringify({ statusCode: status, ...payload }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

      return Promise.resolve(editorFallback(url));
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
    await user.type(
      screen.getByLabelText('Description complète en français'),
      'Une description complète du kit.',
    );
    await user.type(screen.getByLabelText('Description complète en arabe'), 'وصف كامل للطقم.');
    await user.type(screen.getByLabelText('Prix de base (millimes)'), '89000');
    await user.type(screen.getByLabelText('Prix promotionnel du produit (millimes)'), '79000');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le produit' }));

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(
        ([input, init]) => requestUrl(input).endsWith('/admin/products') && init?.method === 'POST',
      );
      expect(requestBody(createCall?.[1])).toMatchObject({
        productType: 'PREFILLED_POD_KIT',
        descriptionFr: 'Une description complète du kit.',
        descriptionAr: 'وصف كامل للطقم.',
        basePriceMillimes: 89_000,
        promotionalPriceMillimes: 79_000,
      });
    });
  });

  it('requires an explicit media-review acknowledgement and sends it for a flagged product', async () => {
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
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

      return Promise.resolve(editorFallback(url));
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
    await user.type(
      screen.getByLabelText('Description complète en français'),
      'Description éditée.',
    );
    await user.type(screen.getByLabelText('Description complète en arabe'), 'وصف تم تعديله.');
    await user.type(screen.getByLabelText('Prix promotionnel du produit (millimes)'), '79000');
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
        descriptionFr: 'Description éditée.',
        descriptionAr: 'وصف تم تعديله.',
        promotionalPriceMillimes: 79_000,
      });
    });
    await waitFor(() => {
      for (const queryKey of [
        ['storefront', 'home'],
        ['catalog'],
        ['products'],
        ['product'],
        ['cart'],
        ['checkout'],
      ]) {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
      }
    });
  });

  it('shows a localized slug conflict beside the slug field and keeps the entered values', async () => {
    const product = { ...draftProduct, categoryId: category.id, brandId: null };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
      if (url.includes('/auth/admin/session')) return Promise.resolve(json({ user: adminUser }));
      if (url.includes('/admin/categories?')) return Promise.resolve(json(page([category])));
      if (url.includes('/admin/brands?')) return Promise.resolve(json(page([])));
      if (url.includes('/admin/products/product-1/variants')) {
        return Promise.resolve(json({ items: [] }));
      }
      if (url.includes('/admin/products/product-1/images?')) {
        return Promise.resolve(json(page([])));
      }
      if (url.endsWith('/admin/products/product-1') && method === 'PATCH') {
        return Promise.resolve(
          apiError(409, {
            code: 'PRODUCT_SLUG_CONFLICT',
            message: 'Product slug already exists.',
            requestId: 'request-slug-1',
          }),
        );
      }
      if (url.endsWith('/admin/products/product-1')) return Promise.resolve(json(product));

      return Promise.resolve(editorFallback(url));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/catalog/product-1/edit');

    const slug = await screen.findByLabelText('Identifiant URL');
    await user.clear(slug);
    await user.type(slug, 'slug-deja-utilise');
    const description = screen.getByLabelText('Description complète en français');
    await user.type(description, 'Valeur à conserver après l’échec.');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le produit' }));

    const fieldError = await screen.findByText(
      'Cet identifiant URL est déjà utilisé. Choisissez un identifiant unique puis réessayez.',
    );
    expect(fieldError).toHaveAttribute('role', 'alert');
    expect(slug).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(slug).toHaveFocus());
    expect(slug).toHaveValue('slug-deja-utilise');
    expect(description).toHaveValue('Valeur à conserver après l’échec.');
    expect(screen.queryByText('Product slug already exists.')).not.toBeInTheDocument();
    expect(screen.queryByText('Référence de la demande : request-slug-1')).not.toBeInTheDocument();
  });

  it('shows and executes explicit publication actions for draft product taxonomy', async () => {
    let categoryState = draftCategory;
    let brandState = draftBrand;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
      if (url.includes('/auth/admin/session')) {
        return Promise.resolve(json({ user: catalogAdminUser }));
      }
      if (url.includes('/admin/categories?')) return Promise.resolve(json(page([categoryState])));
      if (url.includes('/admin/brands?')) return Promise.resolve(json(page([brandState])));
      if (url.includes('/admin/products/product-1/variants')) {
        return Promise.resolve(json(page([])));
      }
      if (url.includes('/admin/products/product-1/images?')) {
        return Promise.resolve(json(page([])));
      }
      if (url.endsWith('/admin/categories/category-1') && method === 'PATCH') {
        categoryState = {
          ...categoryState,
          publicationStatus: 'PUBLISHED',
          updatedAt: '2026-07-23T12:00:00.000Z',
        };
        return Promise.resolve(json(categoryState));
      }
      if (url.endsWith('/admin/brands/brand-1') && method === 'PATCH') {
        brandState = {
          ...brandState,
          publicationStatus: 'PUBLISHED',
          updatedAt: '2026-07-23T12:00:00.000Z',
        };
        return Promise.resolve(json(brandState));
      }
      if (url.endsWith('/admin/products/product-1')) {
        return Promise.resolve(json(draftProduct));
      }

      return Promise.resolve(editorFallback(url));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/catalog/product-1/edit');

    await user.selectOptions(await screen.findByLabelText('Statut'), 'PUBLISHED');
    expect(
      await screen.findByRole('heading', { name: 'Préparer les références avant la publication' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Publier la catégorie sélectionnée' }));
    await user.click(await screen.findByRole('button', { name: 'Publier la marque sélectionnée' }));

    await waitFor(() => {
      const categoryCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith('/admin/categories/category-1') && init?.method === 'PATCH',
      );
      const brandCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith('/admin/brands/brand-1') && init?.method === 'PATCH',
      );
      expect(requestBody(categoryCall?.[1])).toMatchObject({ publicationStatus: 'PUBLISHED' });
      expect(requestBody(brandCall?.[1])).toMatchObject({ publicationStatus: 'PUBLISHED' });
    });
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          requestUrl(input).endsWith('/admin/products/product-1') && init?.method === 'PATCH',
      ),
    ).toBe(false);
  });

  it('renders safe publication blockers instead of a service outage', async () => {
    const product = {
      ...draftProduct,
      categoryId: category.id,
      brandId: null,
    };
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
        return Promise.resolve(
          apiError(409, {
            code: 'PRODUCT_PUBLICATION_NOT_READY',
            message: 'The product does not meet the operational publication requirements.',
            requestId: 'request-catalog-1',
            blockers: ['NON_POSITIVE_PRICE', 'AVAILABLE_STOCK_MISSING', 'DELIVERY_METHOD_MISSING'],
          }),
        );
      }
      if (url.endsWith('/admin/products/product-1')) return Promise.resolve(json(product));

      return Promise.resolve(editorFallback(url));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/catalog/product-1/edit');

    await user.selectOptions(await screen.findByLabelText('Statut'), 'PUBLISHED');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le produit' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Le produit ne remplit pas encore toutes les conditions opérationnelles de publication.',
    );
    expect(alert).toHaveTextContent('Saisissez un prix de vente strictement supérieur à zéro.');
    expect(alert).toHaveTextContent('Ajoutez du stock disponible');
    expect(alert).toHaveTextContent('Configurez une zone et un tarif de livraison actifs');
    expect(alert).toHaveTextContent('Référence de la demande : request-catalog-1');
    expect(screen.queryByText('Nous rencontrons un problème')).not.toBeInTheDocument();
  });

  it('explains when a sensitive edit requires a fresh password and 2FA login', async () => {
    const product = {
      ...draftProduct,
      categoryId: category.id,
      brandId: null,
    };
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
        return Promise.resolve(
          apiError(403, {
            code: 'RECENT_AUTHENTICATION_REQUIRED',
            message: 'Recent authentication is required.',
          }),
        );
      }
      if (url.endsWith('/admin/products/product-1')) return Promise.resolve(json(product));

      return Promise.resolve(editorFallback(url));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/catalog/product-1/edit');

    await user.click(await screen.findByRole('button', { name: 'Enregistrer le produit' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('cette action sensible exige une authentification récente');
    expect(alert).toHaveTextContent('reconnectez-vous avec votre mot de passe et votre code 2FA');
    expect(screen.queryByText('Nous rencontrons un problème')).not.toBeInTheDocument();
  });

  it('invalidates public commerce caches after a product lifecycle change', async () => {
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
      if (url.includes('/auth/admin/session')) {
        return Promise.resolve(json({ user: catalogAdminUser }));
      }
      if (url.includes('/admin/categories?')) return Promise.resolve(json(page([category])));
      if (url.includes('/admin/brands?')) return Promise.resolve(json(page([])));
      if (url.includes('/admin/products/product-1/variants')) {
        return Promise.resolve(json({ items: [] }));
      }
      if (url.includes('/admin/products/product-1/images?')) {
        return Promise.resolve(json(page([])));
      }
      if (url.endsWith('/admin/products/product-1/archive') && method === 'POST') {
        return Promise.resolve(
          json({ ...flaggedProduct, publicationStatus: 'ARCHIVED', version: 8 }),
        );
      }
      if (url.endsWith('/admin/products/product-1')) return Promise.resolve(json(flaggedProduct));
      if (url.includes('/admin/products?')) return Promise.resolve(json(page([])));

      return Promise.resolve(editorFallback(url));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/catalog/product-1/edit');

    await user.click(await screen.findByRole('button', { name: 'Archiver le produit' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            requestUrl(input).endsWith('/admin/products/product-1/archive') &&
            init?.method === 'POST',
        ),
      ).toBe(true);
      for (const queryKey of [
        ['storefront', 'home'],
        ['catalog'],
        ['products'],
        ['product'],
        ['cart'],
        ['checkout'],
      ]) {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
      }
    });
  });

  it('snapshots an existing variant form before starting its asynchronous update', async () => {
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const product = { ...draftProduct, categoryId: category.id, brandId: null };
    let variant = draftVariant;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
      if (url.includes('/auth/admin/session')) return Promise.resolve(json({ user: adminUser }));
      if (url.includes('/admin/categories?')) return Promise.resolve(json(page([category])));
      if (url.includes('/admin/brands?')) return Promise.resolve(json(page([])));
      if (url.endsWith('/admin/products/product-1/variants/variant-1') && method === 'PATCH') {
        variant = { ...variant, ...requestBody(init), version: variant.version + 1 };
        return Promise.resolve(json(variant));
      }
      if (url.includes('/admin/products/product-1/variants')) {
        return Promise.resolve(json({ items: [variant] }));
      }
      if (url.includes('/admin/products/product-1/images?')) {
        return Promise.resolve(json(page([])));
      }
      if (url.endsWith('/admin/products/product-1')) return Promise.resolve(json(product));

      return Promise.resolve(editorFallback(url));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/catalog/product-1/edit');

    const updateButton = await screen.findByRole('button', {
      name: 'Mettre à jour la variante',
    });
    const variantForm = updateButton.closest('form');
    if (!variantForm) throw new Error('Expected an existing variant form.');
    const fields = within(variantForm);
    expect(fields.getByRole('link', { name: 'Gérer le stock' })).toHaveAttribute(
      'href',
      '/admin/inventory/variant-1',
    );
    await user.clear(fields.getByLabelText('Nom en français'));
    await user.type(fields.getByLabelText('Nom en français'), 'Argent mat');
    await user.clear(fields.getByLabelText('Nom en arabe'));
    await user.type(fields.getByLabelText('Nom en arabe'), 'فضي مطفي');
    await user.clear(fields.getByLabelText('SKU'));
    await user.type(fields.getByLabelText('SKU'), 'WOT-AEROKPODKIT-MATTE-SILVER');
    await user.clear(fields.getByLabelText('Couleur (facultatif)'));
    await user.type(fields.getByLabelText('Couleur (facultatif)'), 'Argent mat');
    await user.type(fields.getByLabelText('Coût (millimes)'), '41000');
    await user.clear(fields.getByLabelText('Prix (millimes)'));
    await user.type(fields.getByLabelText('Prix (millimes)'), '89000');
    await user.type(fields.getByLabelText('Prix promotionnel (millimes)'), '79000');
    await user.clear(fields.getByLabelText('Seuil de stock bas'));
    await user.type(fields.getByLabelText('Seuil de stock bas'), '8');
    await user.click(updateButton);

    await waitFor(() => {
      const updateCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith('/admin/products/product-1/variants/variant-1') &&
          init?.method === 'PATCH',
      );
      expect(requestBody(updateCall?.[1])).toEqual({
        version: 2,
        nameFr: 'Argent mat',
        nameAr: 'فضي مطفي',
        sku: 'WOT-AEROKPODKIT-MATTE-SILVER',
        color: 'Argent mat',
        costMillimes: 41_000,
        priceMillimes: 89_000,
        promotionalPriceMillimes: 79_000,
        lowStockThreshold: 8,
        publicationStatus: 'DRAFT',
      });
    });
    expect(await screen.findByText('La variante a été mise à jour.')).toHaveAttribute(
      'role',
      'status',
    );
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          requestUrl(input).endsWith('/admin/products/product-1') && init?.method === 'PATCH',
      ),
    ).toBe(false);
    await waitFor(() => {
      for (const queryKey of [
        ['storefront', 'home'],
        ['catalog'],
        ['products'],
        ['product'],
        ['cart'],
        ['checkout'],
      ]) {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
      }
    });
  });

  it('snapshots the new-variant form and submits one normalized create payload', async () => {
    const product = { ...draftProduct, categoryId: category.id, brandId: null };
    let variants = [draftVariant];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
      if (url.includes('/auth/admin/session')) return Promise.resolve(json({ user: adminUser }));
      if (url.includes('/admin/categories?')) return Promise.resolve(json(page([category])));
      if (url.includes('/admin/brands?')) return Promise.resolve(json(page([])));
      if (url.endsWith('/admin/products/product-1/variants') && method === 'POST') {
        const created = {
          ...draftVariant,
          ...requestBody(init),
          id: 'variant-2',
          version: 1,
        };
        variants = [...variants, created];
        return Promise.resolve(json(created));
      }
      if (url.includes('/admin/products/product-1/variants')) {
        return Promise.resolve(json({ items: variants }));
      }
      if (url.includes('/admin/products/product-1/images?')) {
        return Promise.resolve(json(page([])));
      }
      if (url.endsWith('/admin/products/product-1')) return Promise.resolve(json(product));

      return Promise.resolve(editorFallback(url));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/catalog/product-1/edit');

    const createButton = await screen.findByRole('button', { name: 'Créer la variante' });
    const createForm = createButton.closest('form');
    if (!createForm) throw new Error('Expected the new variant form.');
    const fields = within(createForm);
    await user.type(fields.getByLabelText('Nom en français'), 'Bleu nuit');
    await user.type(fields.getByLabelText('Nom en arabe'), 'أزرق داكن');
    await user.type(fields.getByLabelText('SKU'), 'WOT-AEROKPODKIT-NAVY');
    await user.type(fields.getByLabelText('Couleur (facultatif)'), 'Bleu nuit');
    await user.type(fields.getByLabelText('Coût (millimes)'), '60000');
    await user.type(fields.getByLabelText('Prix (millimes)'), '89000');
    await user.type(fields.getByLabelText('Prix promotionnel (millimes)'), '79000');
    await user.clear(fields.getByLabelText('Seuil de stock bas'));
    await user.type(fields.getByLabelText('Seuil de stock bas'), '6');
    await user.click(createButton);

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith('/admin/products/product-1/variants') &&
          init?.method === 'POST',
      );
      expect(requestBody(createCall?.[1])).toEqual({
        nameFr: 'Bleu nuit',
        nameAr: 'أزرق داكن',
        sku: 'WOT-AEROKPODKIT-NAVY',
        color: 'Bleu nuit',
        costMillimes: 60_000,
        priceMillimes: 89_000,
        promotionalPriceMillimes: 79_000,
        lowStockThreshold: 6,
      });
    });
    expect(await screen.findByText('La variante a été créée en brouillon.')).toHaveAttribute(
      'role',
      'status',
    );
  });

  it('focuses localized operational blockers when a variant cannot be published', async () => {
    const product = { ...draftProduct, categoryId: category.id, brandId: null };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
      if (url.includes('/auth/admin/session')) return Promise.resolve(json({ user: adminUser }));
      if (url.includes('/admin/categories?')) return Promise.resolve(json(page([category])));
      if (url.includes('/admin/brands?')) return Promise.resolve(json(page([])));
      if (url.endsWith('/admin/products/product-1/variants/variant-1') && method === 'PATCH') {
        return Promise.resolve(
          apiError(409, {
            code: 'VARIANT_PUBLICATION_NOT_READY',
            message: 'The variant does not meet the operational publication requirements.',
            requestId: 'request-variant-1',
            blockers: ['AVAILABLE_STOCK_MISSING', 'DELIVERY_METHOD_MISSING'],
          }),
        );
      }
      if (url.includes('/admin/products/product-1/variants')) {
        return Promise.resolve(json({ items: [draftVariant] }));
      }
      if (url.includes('/admin/products/product-1/images?')) {
        return Promise.resolve(json(page([])));
      }
      if (url.endsWith('/admin/products/product-1')) return Promise.resolve(json(product));

      return Promise.resolve(editorFallback(url));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/catalog/product-1/edit');

    const updateButton = await screen.findByRole('button', {
      name: 'Mettre à jour la variante',
    });
    const variantForm = updateButton.closest('form');
    if (!variantForm) throw new Error('Expected an existing variant form.');
    const fields = within(variantForm);
    await user.clear(fields.getByLabelText('Prix (millimes)'));
    await user.type(fields.getByLabelText('Prix (millimes)'), '89000');
    await user.selectOptions(fields.getByLabelText('Statut'), 'PUBLISHED');
    await user.click(updateButton);

    const alert = await fields.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Cette variante ne remplit pas encore toutes les conditions opérationnelles de publication.',
    );
    expect(alert).toHaveTextContent('Ajoutez du stock disponible');
    expect(alert).toHaveTextContent('Configurez une zone et un tarif de livraison actifs');
    expect(alert).toHaveTextContent('Référence de la demande : request-variant-1');
    await waitFor(() => expect(alert).toHaveFocus());
  });
});
