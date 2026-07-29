import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const cart = {
  id: 'cart-1',
  itemCount: 1,
  subtotalMillimes: 25_000,
  items: [
    {
      id: 'item-1',
      quantity: 1,
      unitPriceMillimes: 25_000,
      lineTotalMillimes: 25_000,
      product: {
        id: 'product-1',
        name: 'Menthe fraîche',
        slug: 'menthe-fraiche',
        shortDescription: null,
        brandName: 'PuffJet',
        brandSlug: 'puffjet',
        productType: 'E_LIQUID',
        flavor: 'Menthe',
        priceMillimes: 25_000,
        promotionalPriceMillimes: null,
        availableQuantity: 4,
        lowStock: false,
        ageRestricted: true,
        primaryImage: null,
      },
      variant: {
        id: 'variant-1',
        name: '10 ml',
        sku: 'MINT-10',
        priceMillimes: 25_000,
        promotionalPriceMillimes: null,
        availableQuantity: 4,
      },
    },
  ],
};

const deliveryMethod = {
  id: 'courier:zone-1',
  type: 'COURIER',
  label: 'Livraison Bizerte',
  address: null,
  minimumOrderMillimes: null,
  maximumCodMillimes: 500_000,
  estimatedMinDays: 1,
  estimatedMaxDays: 3,
  estimatedMinMinutes: null,
  estimatedMaxMinutes: null,
  paymentMethod: 'CASH_ON_DELIVERY',
  phoneConfirmationRequired: true,
};

const quote = {
  currency: 'TND',
  subtotalMillimes: 25_000,
  discountTotalMillimes: 0,
  deliveryTotalMillimes: 8_000,
  taxTotalMillimes: 0,
  grandTotalMillimes: 33_000,
  expectedCodMillimes: 33_000,
  expiresAt: '2026-07-29T08:00:00.000Z',
  stockReserved: false,
  orderCreated: false,
  fulfillment: {
    type: 'COURIER',
    express: false,
    deliveryZone: {
      id: 'zone-1',
      code: 'BIZERTE',
      nameFr: 'Livraison Bizerte',
      nameAr: 'توصيل بنزرت',
    },
    selectedRateIds: ['rate-1'],
    freeDeliveryApplied: false,
    estimatedMinDays: 1,
    estimatedMaxDays: 3,
    estimatedMinMinutes: null,
    estimatedMaxMinutes: null,
    paymentMethod: 'CASH_ON_DELIVERY',
    phoneConfirmationRequired: true,
  },
};

const order = {
  id: 'order-1',
  orderNumber: 'TJ-2026-00000001',
  status: 'PENDING_CONFIRMATION',
  paymentStatus: 'CASH_EXPECTED',
  currency: 'TND',
  subtotalMillimes: 25_000,
  discountTotalMillimes: 0,
  deliveryTotalMillimes: 8_000,
  taxTotalMillimes: 0,
  grandTotalMillimes: 33_000,
  expectedCodMillimes: 33_000,
  deliveryMethodType: 'COURIER',
  fulfillment: {
    type: 'COURIER',
    estimatedMinDays: 1,
    estimatedMaxDays: 3,
    estimatedMinMinutes: null,
    estimatedMaxMinutes: null,
    paymentMethod: 'CASH_ON_DELIVERY',
    phoneConfirmationRequired: true,
  },
  createdAt: '2026-07-29T07:00:00.000Z',
};

function requestBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body.');
  return JSON.parse(init.body) as Record<string, unknown>;
}

function checkoutError(code: string, requestId: string) {
  return new Response(
    JSON.stringify({
      statusCode: 409,
      code,
      message: 'The postal code does not match the selected locality.',
      requestId,
    }),
    { status: 409, headers: { 'content-type': 'application/json' } },
  );
}

function installCheckoutFetch(options: { localityPostalCode?: string; orderError?: Response }) {
  const orderBodies: Record<string, unknown>[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
    if (url.endsWith('/auth/customer/session')) return Promise.resolve(json(customerSession));
    if (url.endsWith('/cart/summary')) return Promise.resolve(json({ itemCount: 1 }));
    if (url.endsWith('/cart')) return Promise.resolve(json(cart));
    if (url.endsWith('/geography/governorates')) {
      return Promise.resolve(json([{ id: 'gov-1', name: 'Bizerte', supported: true }]));
    }
    if (url.endsWith('/geography/governorates/gov-1/delegations')) {
      return Promise.resolve(json([{ id: 'delegation-1', name: 'Bizerte Nord', supported: true }]));
    }
    if (url.endsWith('/geography/delegations/delegation-1/localities')) {
      return Promise.resolve(
        json([
          {
            id: 'locality-1',
            name: 'El Corniche',
            supported: true,
            ...(options.localityPostalCode ? { postalCode: options.localityPostalCode } : {}),
          },
        ]),
      );
    }
    if (url.includes('/delivery/methods?localityId=locality-1')) {
      return Promise.resolve(json([deliveryMethod]));
    }
    if (url.endsWith('/delivery/methods')) return Promise.resolve(json([]));
    if (url.endsWith('/checkout/quote') && init?.method === 'POST') {
      return Promise.resolve(json(quote, 201));
    }
    if (url.endsWith('/checkout/orders') && init?.method === 'POST') {
      orderBodies.push(requestBody(init));
      return Promise.resolve(options.orderError ?? json(order, 201));
    }
    return Promise.resolve(json([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, orderBodies };
}

async function completeCourierCheckout() {
  const user = userEvent.setup();
  renderRoute('/checkout');

  await user.type(await screen.findByLabelText(/Nom complet/i), 'Amel Ben Salah');
  await user.type(screen.getByLabelText(/Téléphone/i), '+21620123456');
  await user.selectOptions(await screen.findByLabelText(/Gouvernorat/i), 'gov-1');
  await screen.findByRole('option', { name: 'Bizerte Nord' });
  await user.selectOptions(screen.getByLabelText(/Délégation/i), 'delegation-1');
  await screen.findByRole('option', { name: 'El Corniche' });
  await user.selectOptions(screen.getByLabelText(/Localité/i), 'locality-1');
  await screen.findByRole('option', { name: /Livraison Bizerte/ });
  await user.selectOptions(screen.getByLabelText(/Mode de remise/i), 'courier:zone-1');
  await user.type(screen.getByLabelText(/Rue/i), '12 avenue Habib Bourguiba');
  for (const checkbox of screen.getAllByRole('checkbox')) await user.click(checkbox);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Confirmer la commande/i })).toBeEnabled(),
  );
  return user;
}

describe('checkout courier postal-code handling', () => {
  beforeEach(() => {
    document.cookie = 'vape_customer_csrf=customer-csrf; Path=/';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('allows a courier locality without a configured postal code and omits it from the order', async () => {
    const { orderBodies } = installCheckoutFetch({});
    const user = await completeCourierCheckout();

    expect(screen.getByLabelText(/Code postal/i)).toHaveValue('');
    await user.click(screen.getByRole('button', { name: /Confirmer la commande/i }));

    await waitFor(() => expect(orderBodies).toHaveLength(1));
    expect(orderBodies[0]).toMatchObject({
      localityId: 'locality-1',
      address: { street: '12 avenue Habib Bourguiba' },
    });
    expect(orderBodies[0]?.address).not.toHaveProperty('postalCode');
  });

  it('auto-fills and submits the postal code supplied by the selected locality', async () => {
    const { orderBodies } = installCheckoutFetch({ localityPostalCode: '7000' });
    const user = await completeCourierCheckout();

    expect(screen.getByLabelText(/Code postal/i)).toHaveValue('7000');
    await user.click(screen.getByRole('button', { name: /Confirmer la commande/i }));

    await waitFor(() => expect(orderBodies).toHaveLength(1));
    expect(orderBodies[0]).toMatchObject({
      localityId: 'locality-1',
      address: { street: '12 avenue Habib Bourguiba', postalCode: '7000' },
    });
  });

  it('shows actionable postal-code recovery and the safe request reference', async () => {
    const requestId = 'checkout-request-123';
    installCheckoutFetch({
      localityPostalCode: '7000',
      orderError: checkoutError('POSTAL_CODE_INVALID', requestId),
    });
    const user = await completeCourierCheckout();

    await user.click(screen.getByRole('button', { name: /Confirmer la commande/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/code postal|localité/i);
    expect(alert).toHaveTextContent(requestId);
  });
});
