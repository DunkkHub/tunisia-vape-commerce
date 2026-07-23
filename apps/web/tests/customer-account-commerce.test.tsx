import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../src/i18n';
import { json, renderRoute, requestUrl, statusPayload } from './test-app';

const customerSession = {
  user: {
    id: 'customer-1',
    email: 'amel@example.tn',
    phone: '+21620123456',
    fullName: 'Amel Ben Salah',
    emailVerified: true,
  },
};

const product = {
  id: 'product-1',
  name: 'Menthe fraîche',
  slug: 'menthe-fraiche',
  shortDescription: 'Une saveur fraîche.',
  brandName: 'PuffJet',
  brandSlug: 'puffjet',
  productType: 'E_LIQUID',
  flavor: 'Menthe',
  priceMillimes: 25_000,
  promotionalPriceMillimes: null,
  availableQuantity: 8,
  lowStock: false,
  ageRestricted: true,
  primaryImage: null,
};

const productDetail = {
  ...product,
  description: 'Description complète.',
  sku: 'MINT-01',
  images: [],
  variants: [
    {
      id: 'variant-1',
      name: '10 ml',
      sku: 'MINT-10',
      priceMillimes: 25_000,
      promotionalPriceMillimes: null,
      availableQuantity: 4,
    },
    {
      id: 'variant-2',
      name: '30 ml',
      sku: 'MINT-30',
      priceMillimes: 55_000,
      promotionalPriceMillimes: null,
      availableQuantity: 4,
    },
  ],
  warningText: 'Réservé aux adultes.',
  attributes: [],
};

function noContent() {
  return new Response(null, { status: 204 });
}

function wishlistNotFound() {
  return new Response(
    JSON.stringify({
      statusCode: 404,
      code: 'WISHLIST_ITEM_NOT_FOUND',
      message: 'The requested wishlist item was not found.',
    }),
    { status: 404, headers: { 'content-type': 'application/json' } },
  );
}

function requestBody(init?: RequestInit) {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body.');
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe('customer commerce account', () => {
  beforeEach(() => {
    document.cookie = 'vape_customer_csrf=customer-csrf; Path=/';
  });

  it('renders the complete customer-safe order and delivery tracking snapshot', async () => {
    const order = {
      id: 'order-1',
      orderNumber: 'TN-100',
      status: 'IN_TRANSIT',
      paymentStatus: 'CASH_EXPECTED',
      deliveryStatus: 'IN_TRANSIT',
      grandTotalMillimes: 61_000,
      currency: 'TND',
      cancellable: false,
      version: 3,
      createdAt: '2026-07-19T09:00:00.000Z',
      customerName: 'Amel Ben Salah',
      customerPhone: '+21620123456',
      customerEmail: 'amel@example.tn',
      deliveryMethodType: 'COURIER',
      deliveryMethod: 'Livraison Grand Tunis',
      subtotalMillimes: 55_000,
      discountTotalMillimes: 2_000,
      deliveryTotalMillimes: 8_000,
      taxTotalMillimes: 0,
      expectedCodMillimes: 61_000,
      items: [
        {
          id: 'item-1',
          productName: 'Menthe fraîche',
          variantName: '30 ml',
          sku: 'MINT-30',
          warningFr: 'Réservé aux adultes.',
          warningAr: 'للراشدين فقط.',
          unitPriceMillimes: 55_000,
          unitDiscountMillimes: 2_000,
          unitTaxMillimes: 0,
          quantity: 1,
          lineSubtotalMillimes: 55_000,
          lineDiscountMillimes: 2_000,
          lineTaxMillimes: 0,
          lineTotalMillimes: 53_000,
        },
      ],
      addresses: [
        {
          id: 'snapshot-1',
          type: 'DELIVERY',
          fullName: 'Amel Ben Salah',
          phone: '+21620123456',
          governorate: 'Tunis',
          delegation: 'La Marsa',
          locality: 'Sidi Daoud',
          postalCode: '2046',
          street: '12 rue des Jasmins',
          building: 'Résidence Le Port',
          floor: null,
          apartment: null,
          landmark: null,
          instructions: 'Appeler avant de venir.',
        },
      ],
      history: [
        {
          id: 'history-1',
          fromStatus: 'CONFIRMED',
          toStatus: 'IN_TRANSIT',
          occurredAt: '2026-07-20T08:00:00.000Z',
        },
      ],
      customerVisibleNotes: [
        {
          id: 'note-1',
          body: 'Votre commande a quitté notre dépôt.',
          createdAt: '2026-07-20T08:05:00.000Z',
        },
      ],
      delivery: {
        id: 'delivery-1',
        status: 'IN_TRANSIT',
        trackingNumber: 'TRACK-TN-100',
        courierName: 'Tunis Express',
        ageVerificationResult: 'PENDING',
        customerVisibleNotes: 'Livraison prévue dans la matinée.',
        assignedAt: '2026-07-20T07:00:00.000Z',
        handedToCourierAt: '2026-07-20T08:00:00.000Z',
        deliveredAt: null,
        nextAttemptAt: '2026-07-21T09:00:00.000Z',
        attempts: [
          {
            id: 'attempt-1',
            attemptNumber: 1,
            outcome: 'CUSTOMER_UNAVAILABLE',
            ageVerificationResult: 'UNABLE_TO_VERIFY',
            attemptedAt: '2026-07-20T10:00:00.000Z',
            nextAttemptAt: '2026-07-21T09:00:00.000Z',
          },
        ],
        events: [
          {
            id: 'event-1',
            fromStatus: 'HANDED_TO_COURIER',
            toStatus: 'IN_TRANSIT',
            occurredAt: '2026-07-20T08:00:00.000Z',
          },
        ],
      },
      consents: [],
      discounts: [],
      codCollections: [],
      confirmedAt: '2026-07-19T10:00:00.000Z',
      cancelledAt: null,
      cancellationReason: null,
      updatedAt: '2026-07-20T08:05:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL): Promise<Response> => {
        const url = requestUrl(input);
        if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
        if (url.endsWith('/auth/customer/session')) return Promise.resolve(json(customerSession));
        if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
        if (url.endsWith('/orders/TN-100')) return Promise.resolve(json(order));
        return Promise.resolve(json({}));
      }),
    );

    renderRoute('/account/orders/TN-100');

    expect(await screen.findByRole('heading', { name: 'TN-100' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Articles commandés' })).toBeVisible();
    expect(screen.getByText('Menthe fraîche')).toBeVisible();
    expect(screen.getByText('12 rue des Jasmins')).toBeVisible();
    expect(screen.getByText('Tunis Express')).toBeVisible();
    expect(screen.getByText('TRACK-TN-100')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('Client injoignable')).toBeVisible();
    expect(screen.getByText('Votre commande a quitté notre dépôt.')).toBeVisible();
    expect(document.querySelector('data[value="61000"]')).toBeTruthy();
  });

  it('creates, edits and deletes a versioned saved address with customer CSRF', async () => {
    let addresses: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
        if (url.endsWith('/auth/customer/session')) return Promise.resolve(json(customerSession));
        if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
        if (url.endsWith('/geography/governorates'))
          return Promise.resolve(json([{ id: 'gov-1', name: 'Tunis' }]));
        if (url.endsWith('/geography/governorates/gov-1/delegations'))
          return Promise.resolve(json([{ id: 'del-1', name: 'La Marsa' }]));
        if (url.endsWith('/geography/delegations/del-1/localities'))
          return Promise.resolve(json([{ id: 'loc-1', name: 'Sidi Daoud' }]));
        if (url.endsWith('/customers/me/addresses') && init?.method === 'POST') {
          const body = requestBody(init);
          const created = {
            id: 'address-1',
            ...body,
            label: body.label || 'HOME',
            governorate: 'Tunis',
            delegation: 'La Marsa',
            locality: 'Sidi Daoud',
            version: 1,
            createdAt: '2026-07-20T10:00:00.000Z',
            updatedAt: '2026-07-20T10:00:00.000Z',
          };
          addresses = [created];
          return Promise.resolve(json(created, 201));
        }
        if (url.endsWith('/customers/me/addresses/address-1') && init?.method === 'PATCH') {
          const body = requestBody(init);
          const updated = {
            ...addresses[0],
            ...body,
            version: 2,
            updatedAt: '2026-07-20T11:00:00.000Z',
          };
          addresses = [updated];
          return Promise.resolve(json(updated));
        }
        if (
          url.endsWith('/customers/me/addresses/address-1?expectedVersion=2') &&
          init?.method === 'DELETE'
        ) {
          addresses = [];
          return Promise.resolve(json({ id: 'address-1', deleted: true }));
        }
        if (url.endsWith('/customers/me/addresses')) return Promise.resolve(json(addresses));
        return Promise.resolve(json({}));
      }),
    );

    const user = userEvent.setup();
    renderRoute('/account/addresses');
    await screen.findByRole('heading', { name: 'Carnet d’adresses' });
    await user.click(screen.getByRole('button', { name: 'Ajouter une adresse' }));
    const createDialog = await screen.findByRole('dialog', { name: 'Nouvelle adresse' });
    fireEvent.change(within(createDialog).getByLabelText('Libellé (facultatif)'), {
      target: { value: 'Maison' },
    });
    fireEvent.change(within(createDialog).getByLabelText(/Nom complet/), {
      target: { value: 'Amel Ben Salah' },
    });
    fireEvent.change(within(createDialog).getByLabelText(/Téléphone/), {
      target: { value: '+21620123456' },
    });
    await user.selectOptions(within(createDialog).getByLabelText(/Gouvernorat/), 'gov-1');
    await waitFor(() =>
      expect(within(createDialog).getByRole('option', { name: 'La Marsa' })).toBeVisible(),
    );
    await user.selectOptions(within(createDialog).getByLabelText(/Délégation/), 'del-1');
    await waitFor(() =>
      expect(within(createDialog).getByRole('option', { name: 'Sidi Daoud' })).toBeVisible(),
    );
    await user.selectOptions(within(createDialog).getByLabelText('Localité'), 'loc-1');
    fireEvent.change(within(createDialog).getByLabelText('Code postal'), {
      target: { value: '2046' },
    });
    fireEvent.change(within(createDialog).getByLabelText(/Rue et numéro/), {
      target: { value: '12 rue des Jasmins' },
    });
    await user.click(within(createDialog).getByLabelText('Utiliser comme adresse par défaut'));
    await user.click(within(createDialog).getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Maison')).toBeVisible();
    const createCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith('/customers/me/addresses') && init?.method === 'POST',
      );
    expect(requestBody(createCall?.[1])).toMatchObject({
      governorateId: 'gov-1',
      delegationId: 'del-1',
      localityId: 'loc-1',
      isDefault: true,
    });
    expect(new Headers(createCall?.[1]?.headers).get('X-CSRF-Token')).toBe('customer-csrf');

    await user.click(screen.getByRole('button', { name: 'Modifier' }));
    const editDialog = await screen.findByRole('dialog', { name: 'Modifier l’adresse' });
    const street = within(editDialog).getByLabelText(/Rue et numéro/);
    fireEvent.change(street, { target: { value: '24 avenue Habib Bourguiba' } });
    await user.click(within(editDialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([input, init]) =>
              requestUrl(input).endsWith('/customers/me/addresses/address-1') &&
              init?.method === 'PATCH',
          ),
      ).toBe(true),
    );
    const updateCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith('/customers/me/addresses/address-1') &&
          init?.method === 'PATCH',
      );
    expect(requestBody(updateCall?.[1])).toMatchObject({
      street: '24 avenue Habib Bourguiba',
      expectedVersion: 1,
    });
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'ADDRESS' &&
          element.textContent?.includes('24 avenue Habib Bourguiba') === true,
      ),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    const deleteDialog = await screen.findByRole('dialog', { name: 'Supprimer cette adresse ?' });
    await user.click(within(deleteDialog).getByRole('button', { name: 'Supprimer' }));
    expect(await screen.findByText('Aucune adresse enregistrée.')).toBeVisible();
  });

  it('adds and removes a product wishlist selection from the product page', async () => {
    let saved = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
        if (url.endsWith('/auth/customer/session')) return Promise.resolve(json(customerSession));
        if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
        if (url.endsWith('/products/menthe-fraiche')) return Promise.resolve(json(productDetail));
        if (url.endsWith('/wishlist/items') && init?.method === 'POST') {
          saved = true;
          return Promise.resolve(
            json({ variantId: 'variant-1', productId: 'product-1', saved: true }),
          );
        }
        if (url.endsWith('/wishlist/items/variant-1') && init?.method === 'DELETE') {
          saved = false;
          return Promise.resolve(
            json({ variantId: 'variant-1', productId: 'product-1', saved: false }),
          );
        }
        if (url.endsWith('/wishlist'))
          return Promise.resolve(
            json({
              items: saved ? [product] : [],
              page: 1,
              pageSize: 20,
              total: saved ? 1 : 0,
              totalPages: saved ? 1 : 0,
            }),
          );
        return Promise.resolve(noContent());
      }),
    );

    const user = userEvent.setup();
    renderRoute('/products/menthe-fraiche');
    await screen.findByRole('heading', { name: 'Menthe fraîche' });
    await user.click(screen.getByRole('button', { name: 'Ajouter aux favoris' }));
    expect(await screen.findByText('Produit ajouté à vos favoris.')).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retirer des favoris' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Retirer des favoris' }));
    expect(await screen.findByText('Produit retiré de vos favoris.')).toBeVisible();
  });

  it('removes the actual saved variant lazily from the wishlist page', async () => {
    let saved = true;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input);
        if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
        if (url.endsWith('/auth/customer/session')) return Promise.resolve(json(customerSession));
        if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
        if (url.endsWith('/products/menthe-fraiche')) return Promise.resolve(json(productDetail));
        if (url.endsWith('/wishlist/items/variant-1') && init?.method === 'DELETE')
          return Promise.resolve(wishlistNotFound());
        if (url.endsWith('/wishlist/items/variant-2') && init?.method === 'DELETE') {
          saved = false;
          return Promise.resolve(
            json({ variantId: 'variant-2', productId: 'product-1', saved: false }),
          );
        }
        if (url.endsWith('/wishlist'))
          return Promise.resolve(
            json({
              items: saved ? [product] : [],
              page: 1,
              pageSize: 20,
              total: saved ? 1 : 0,
              totalPages: saved ? 1 : 0,
            }),
          );
        return Promise.resolve(noContent());
      }),
    );

    const user = userEvent.setup();
    renderRoute('/account/wishlist');
    await screen.findByRole('heading', { name: 'Vos favoris' });
    await user.click(screen.getByRole('button', { name: 'Retirer des favoris' }));
    expect(await screen.findByText('Votre liste de favoris est vide.')).toBeVisible();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([input]) => requestUrl(input).endsWith('/wishlist/items/variant-2')),
    ).toBe(true);
  });

  it('renders the writable address flow in Arabic with RTL document semantics', async () => {
    await i18n.changeLanguage('ar');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL): Promise<Response> => {
        const url = requestUrl(input);
        if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
        if (url.endsWith('/auth/customer/session')) return Promise.resolve(json(customerSession));
        if (url.includes('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
        if (url.endsWith('/customers/me/addresses')) return Promise.resolve(json([]));
        if (url.endsWith('/geography/governorates')) return Promise.resolve(json([]));
        return Promise.resolve(json({}));
      }),
    );

    const user = userEvent.setup();
    renderRoute('/account/addresses');
    await screen.findByRole('heading', { name: 'دفتر العناوين' });
    await user.click(screen.getByRole('button', { name: 'إضافة عنوان' }));
    expect(await screen.findByRole('dialog', { name: 'عنوان جديد' })).toBeVisible();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});
