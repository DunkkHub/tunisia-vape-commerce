import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../src/app/providers';
import { appRoutes } from '../src/app/router';
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

describe('customer-safe delivery metadata', () => {
  beforeEach(async () => {
    document.cookie = 'vape_customer_csrf=customer-csrf; Path=/';
    await i18n.changeLanguage('fr');
  });

  it('replaces method-option estimates with the authoritative quote without exposing operations', async () => {
    let resolveQuote!: (response: Response) => void;
    const quoteResponse = new Promise<Response>((resolve) => {
      resolveQuote = resolve;
    });
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
        return Promise.resolve(
          json([{ id: 'delegation-1', name: 'Bizerte Nord', supported: true }]),
        );
      }
      if (url.endsWith('/geography/delegations/delegation-1/localities')) {
        return Promise.resolve(
          json([{ id: 'locality-1', name: 'Centre', postalCode: '7000', supported: true }]),
        );
      }
      if (url.includes('/delivery/methods?localityId=locality-1')) {
        return Promise.resolve(
          json([
            {
              id: 'courier:zone-1',
              type: 'COURIER',
              label: 'Bizerte Express',
              address: null,
              minimumOrderMillimes: null,
              maximumCodMillimes: 500_000,
              estimatedMinDays: 1,
              estimatedMaxDays: 3,
              estimatedMinMinutes: null,
              estimatedMaxMinutes: null,
              paymentMethod: 'CASH_ON_DELIVERY',
              phoneConfirmationRequired: true,
              assignmentMode: 'MANUAL',
              driverCommunication: 'WHATSAPP',
              manualReviewRequired: true,
            },
          ]),
        );
      }
      if (url.endsWith('/delivery/methods')) return Promise.resolve(json([]));
      if (url.endsWith('/checkout/quote') && init?.method === 'POST') return quoteResponse;
      return Promise.resolve(json([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/checkout');

    await screen.findByRole('option', { name: 'Bizerte' });
    await user.selectOptions(await screen.findByLabelText('Gouvernorat'), 'gov-1');
    await screen.findByRole('option', { name: 'Bizerte Nord' });
    await user.selectOptions(await screen.findByLabelText('Délégation'), 'delegation-1');
    await screen.findByRole('option', { name: 'Centre' });
    await user.selectOptions(await screen.findByLabelText('Localité'), 'locality-1');
    await screen.findByRole('option', { name: /Bizerte Express/ });
    await user.selectOptions(await screen.findByLabelText('Mode de remise'), 'courier:zone-1');

    expect(await screen.findByText('1–3 jours')).toBeInTheDocument();
    expect(screen.getByText('Paiement à la livraison')).toBeInTheDocument();
    expect(screen.getByText('Oui')).toBeInTheDocument();

    act(() => {
      resolveQuote(
        json({
          currency: 'TND',
          subtotalMillimes: 25_000,
          discountTotalMillimes: 0,
          deliveryTotalMillimes: 8_000,
          taxTotalMillimes: 0,
          grandTotalMillimes: 33_000,
          expectedCodMillimes: 33_000,
          expiresAt: '2026-07-27T12:05:00.000Z',
          stockReserved: false,
          orderCreated: false,
          fulfillment: {
            type: 'COURIER',
            express: false,
            deliveryZone: {
              id: 'zone-1',
              code: 'BIZERTE_EXPRESS',
              nameFr: 'Bizerte Express',
              nameAr: 'بنزرت السريع',
            },
            selectedRateIds: ['rate-1'],
            estimatedMinDays: null,
            estimatedMaxDays: null,
            estimatedMinMinutes: 30,
            estimatedMaxMinutes: 50,
            paymentMethod: 'CASH_ON_DELIVERY',
            phoneConfirmationRequired: false,
            freeDeliveryApplied: false,
            assignmentMode: 'MANUAL',
            driverCommunication: 'WHATSAPP',
            manualReviewRequired: true,
          },
        }),
      );
    });

    expect(await screen.findByText('30–50 minutes')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('1–3 jours')).not.toBeInTheDocument());
    expect(screen.getByText('Non')).toBeInTheDocument();
    expect(screen.queryByText('MANUAL')).not.toBeInTheDocument();
    expect(screen.queryByText('WHATSAPP')).not.toBeInTheDocument();
    expect(screen.queryByText('manualReviewRequired')).not.toBeInTheDocument();
  });

  it('renders the authoritative order fulfillment in Arabic from a matching confirmation state', async () => {
    await i18n.changeLanguage('ar');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL): Promise<Response> => {
        const url = requestUrl(input);
        if (url.includes('/storefront/status')) return Promise.resolve(json(statusPayload));
        if (url.endsWith('/auth/customer/session')) return Promise.resolve(json(customerSession));
        if (url.endsWith('/cart/summary')) return Promise.resolve(json({ itemCount: 0 }));
        return Promise.resolve(json([]));
      }),
    );
    const router = createMemoryRouter(appRoutes, {
      initialEntries: [
        {
          pathname: '/order-confirmation/TJ-2026-00000001',
          state: {
            orderNumber: 'TJ-2026-00000001',
            fulfillment: {
              type: 'COURIER',
              estimatedMinDays: 1,
              estimatedMaxDays: 3,
              estimatedMinMinutes: null,
              estimatedMaxMinutes: null,
              paymentMethod: 'CASH_ON_DELIVERY',
              phoneConfirmationRequired: true,
              assignmentMode: 'MANUAL',
              driverCommunication: 'WHATSAPP',
              manualReviewRequired: true,
            },
          },
        },
      ],
    });

    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByText('1–3 يوم')).toBeInTheDocument();
    expect(screen.getByText('الدفع عند الاستلام')).toBeInTheDocument();
    expect(screen.getByText('نعم')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.queryByText('MANUAL')).not.toBeInTheDocument();
    expect(screen.queryByText('WHATSAPP')).not.toBeInTheDocument();
  });
});
