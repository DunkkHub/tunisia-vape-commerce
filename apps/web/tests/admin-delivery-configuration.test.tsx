import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminDeliveryZoneConfig } from '../src/api/types';
import { json, renderRoute, requestUrl } from './test-app';

const adminUser = {
  id: 'delivery-admin',
  email: 'delivery@example.test',
  name: 'Responsable livraison',
  roles: ['delivery-coordinator'],
  permissions: ['deliveries.read', 'deliveries.assign', 'deliveries.update'],
  requiresRecentAuthentication: false,
};

const page = <T,>(items: T[]) => ({
  items,
  page: 1,
  pageSize: 50,
  total: items.length,
  totalPages: items.length > 0 ? 1 : 0,
});

const zone: AdminDeliveryZoneConfig = {
  id: 'zone-standard',
  code: 'STANDARD_COD',
  nameFr: 'Livraison nationale standard',
  nameAr: 'توصيل وطني عادي',
  priority: 10,
  active: false,
  supported: false,
  temporarilySuspended: false,
  phoneConfirmationRequired: true,
  manualReviewRequired: false,
  minOrderMillimes: null,
  maxCodMillimes: null,
  freeDeliveryThresholdMillimes: null,
  estimatedMinDays: 1,
  estimatedMaxDays: 3,
  estimatedMinMinutes: null,
  estimatedMaxMinutes: null,
  paymentMethod: 'CASH_ON_DELIVERY',
  assignmentMode: 'MANUAL',
  driverCommunication: null,
  localityCount: 0,
  activeRateCount: 0,
  createdAt: '2026-07-23T10:00:00.000Z',
  updatedAt: '2026-07-23T10:00:00.000Z',
};

const bizerteZone: AdminDeliveryZoneConfig = {
  ...zone,
  id: 'zone-bizerte-express',
  code: 'BIZERTE_EXPRESS',
  nameFr: 'Bizerte Express',
  nameAr: 'بنزرت السريع',
  priority: 100,
  phoneConfirmationRequired: false,
  estimatedMinDays: null,
  estimatedMaxDays: null,
  estimatedMinMinutes: 30,
  estimatedMaxMinutes: 50,
  driverCommunication: 'WHATSAPP',
};

const rate = {
  id: 'rate-standard',
  deliveryZoneId: zone.id,
  type: 'BASE',
  name: 'Standard COD',
  feeMillimes: 4,
  priority: 10,
  express: false,
  active: false,
  version: 1,
  validFrom: null,
  validUntil: null,
};

const courier = {
  id: 'courier-intigo',
  code: 'INTIGO',
  name: 'Intigo',
  status: 'ACTIVE',
  contactName: null,
  phoneE164: null,
  email: null,
  notes: 'STANDARD_COD · COD · suivi manuel · retours activés',
  integrations: [{ type: 'MANUAL', name: 'Manual administrator operations', active: true }],
  deliveryCount: 0,
  manifestCount: 0,
  createdAt: '2026-07-23T10:00:00.000Z',
  updatedAt: '2026-07-23T10:00:00.000Z',
} as const;

function commonRead(
  url: string,
  couriers: (typeof courier)[],
  zones: AdminDeliveryZoneConfig[],
  rates: (typeof rate)[] = [],
): Response | undefined {
  if (url.includes('/auth/admin/session')) return json({ user: adminUser });
  if (url.includes('/admin/deliveries?page=')) return json(page([]));
  if (url.includes('/admin/delivery-config/zones?')) return json(page(zones));
  if (url.includes('/admin/delivery-config/rates?')) return json(page(rates));
  if (url.includes('/admin/delivery-config/pickups?')) return json(page([]));
  if (url.endsWith('/admin/delivery-config/geography/governorates')) return json([]);
  if (
    url.includes('/admin/delivery-config/geography/governorates/') &&
    url.endsWith('/delegations')
  )
    return json([]);
  if (url.includes('/admin/delivery-config/geography/delegations/') && url.endsWith('/localities'))
    return json([]);
  if (url.endsWith('/admin/deliveries/couriers')) {
    return json(couriers.map(({ id, code, name }) => ({ id, code, name })));
  }
  if (url.includes('/admin/deliveries/courier-records?')) return json(page(couriers));
  if (url.includes('/admin/deliveries/manifests?')) return json(page([]));
  return undefined;
}

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

describe('administrator delivery configuration', () => {
  it('separates configuration, daily operations, and advanced tools into clear workspaces', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      return Promise.resolve(commonRead(requestUrl(input), [], [zone]) ?? json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/delivery');

    const configuration = await screen.findByRole('button', {
      name: /Configurer la livraison/,
    });
    const operations = screen.getByRole('button', { name: /Gérer les livraisons/ });
    const tools = screen.getByRole('button', { name: /Outils avancés/ });
    expect(configuration).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Mettre une méthode de livraison en service')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Créer le livreur' })).not.toBeInTheDocument();

    await user.click(operations);
    expect(operations).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('button', { name: 'Créer le livreur' })).toBeVisible();
    expect(screen.getByText('Mettre une méthode de livraison en service')).not.toBeVisible();

    await user.click(tools);
    expect(tools).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('button', { name: 'Télécharger le CSV' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Créer le livreur' })).not.toBeInTheDocument();
  });

  it('shows each zone prerequisite and prevents activation until coverage and a rate are active', async () => {
    const noCoverage = {
      ...zone,
      id: 'zone-no-coverage',
      code: 'NO_COVERAGE',
      nameFr: 'Sans couverture',
      activeRateCount: 1,
    };
    const noRate = {
      ...zone,
      id: 'zone-no-rate',
      code: 'NO_RATE',
      nameFr: 'Sans tarif',
      localityCount: 12,
    };
    const ready = {
      ...zone,
      id: 'zone-ready',
      code: 'READY_ZONE',
      nameFr: 'Prête pour activation',
      localityCount: 12,
      activeRateCount: 1,
    };
    const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      return Promise.resolve(
        commonRead(requestUrl(input), [], [noCoverage, noRate, ready]) ?? json({}),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    renderRoute('/admin/delivery');

    const coverageCard = await screen.findByRole('article', { name: 'Sans couverture' });
    expect(within(coverageCard).getByText('Couverture à ajouter')).toBeVisible();
    expect(within(coverageCard).getByText('Tarif actif configuré')).toBeVisible();
    expect(
      within(coverageCard).getByRole('button', { name: 'Activer la zone NO_COVERAGE' }),
    ).toBeDisabled();

    const rateCard = screen.getByRole('article', { name: 'Sans tarif' });
    expect(within(rateCard).getByText('Couverture configurée')).toBeVisible();
    expect(within(rateCard).getByText('Tarif actif à ajouter')).toBeVisible();
    expect(
      within(rateCard).getByRole('button', { name: 'Activer la zone NO_RATE' }),
    ).toBeDisabled();

    const readyCard = screen.getByRole('article', { name: 'Prête pour activation' });
    expect(within(readyCard).getByText('Prête à activer')).toBeVisible();
    expect(
      within(readyCard).getByRole('button', { name: 'Activer la zone READY_ZONE' }),
    ).toBeEnabled();
  });

  it('shows courier creation success and notes beside the courier form', async () => {
    const courierRecords: (typeof courier)[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/admin/deliveries/courier-records') && method === 'POST') {
        courierRecords.push(courier);
        return Promise.resolve(json(courier));
      }
      return Promise.resolve(commonRead(url, courierRecords, []) ?? json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/delivery');

    await user.click(await screen.findByRole('button', { name: /Gérer les livraisons/ }));
    const createButton = await screen.findByRole('button', { name: 'Créer le livreur' });
    const form = createButton.closest('form');
    if (!form) throw new Error('Expected the courier form.');
    await user.type(within(form).getByLabelText('Code'), 'INTIGO');
    await user.type(within(form).getByLabelText('Nom du livreur'), 'Intigo');
    await user.type(
      within(form).getByLabelText('Notes internes'),
      'STANDARD_COD · COD · suivi manuel · retours activés',
    );
    await user.click(createButton);

    expect(await screen.findByText('Livreur créé : INTIGO · Intigo.')).toBeVisible();
    expect(
      await screen.findByText('STANDARD_COD · COD · suivi manuel · retours activés'),
    ).toBeVisible();
    const call = fetchMock.mock.calls.find(
      ([input, init]) =>
        requestUrl(input).endsWith('/admin/deliveries/courier-records') && init?.method === 'POST',
    );
    expect(requestBody(call?.[1])).toEqual({
      code: 'INTIGO',
      name: 'Intigo',
      notes: 'STANDARD_COD · COD · suivi manuel · retours activés',
      confirmation: 'CREATE_MANUAL_COURIER',
    });
  });

  it('sends the supported Standard COD timing and confirmation controls', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/admin/delivery-config/zones') && method === 'POST') {
        return Promise.resolve(json(zone));
      }
      return Promise.resolve(commonRead(url, [], []) ?? json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/delivery');

    const createButton = await screen.findByRole('button', { name: 'Créer une zone inactive' });
    const form = createButton.closest('form');
    if (!form) throw new Error('Expected the zone form.');
    await user.click(within(form).getByRole('button', { name: 'Appliquer Standard COD' }));
    expect(within(form).getByLabelText('Code (majuscules)')).toHaveValue('STANDARD_COD');
    expect(within(form).getByLabelText('Délai minimum estimé (jours)')).toHaveValue(1);
    expect(within(form).getByLabelText('Délai maximum estimé (jours)')).toHaveValue(3);
    expect(within(form).getByLabelText('Confirmation téléphonique obligatoire')).toBeChecked();
    await user.type(within(form).getByLabelText('Nom français'), 'Livraison nationale standard');
    await user.type(within(form).getByLabelText('Nom arabe'), 'توصيل وطني عادي');
    const priority = within(form).getByLabelText('Priorité (la valeur la plus élevée gagne)');
    await user.clear(priority);
    await user.type(priority, '10');
    await user.click(createButton);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith('/admin/delivery-config/zones') && init?.method === 'POST',
      );
      expect(requestBody(call?.[1])).toEqual({
        code: 'STANDARD_COD',
        nameFr: 'Livraison nationale standard',
        nameAr: 'توصيل وطني عادي',
        priority: 10,
        estimatedMinDays: 1,
        estimatedMaxDays: 3,
        paymentMethod: 'CASH_ON_DELIVERY',
        assignmentMode: 'MANUAL',
        phoneConfirmationRequired: true,
        manualReviewRequired: false,
      });
    });
  });

  it('applies and saves the exact Bizerte Express operational metadata', async () => {
    const unconfiguredZone: AdminDeliveryZoneConfig = {
      ...bizerteZone,
      estimatedMinMinutes: null,
      estimatedMaxMinutes: null,
      paymentMethod: null,
      assignmentMode: null,
      driverCommunication: null,
    };
    let currentZones = [unconfiguredZone];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (
        url.endsWith(`/admin/delivery-config/zones/${unconfiguredZone.id}`) &&
        method === 'PATCH'
      ) {
        currentZones = [
          {
            ...bizerteZone,
            updatedAt: '2026-07-23T11:00:00.000Z',
          },
        ];
        return Promise.resolve(json(currentZones[0]));
      }
      return Promise.resolve(commonRead(url, [], currentZones) ?? json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/delivery');

    const zoneCard = await screen.findByRole('article', { name: 'Bizerte Express' });
    await user.click(within(zoneCard).getByText('Modifier les réglages de la zone'));
    const form = await screen.findByRole('form', {
      name: 'Modifier la zone BIZERTE_EXPRESS',
    });
    await user.click(within(form).getByRole('button', { name: 'Appliquer Bizerte Express' }));
    expect(within(form).getByLabelText('Délai minimum estimé (jours)')).toHaveValue(null);
    expect(within(form).getByLabelText('Délai maximum estimé (jours)')).toHaveValue(null);
    expect(within(form).getByLabelText('Délai minimum estimé (minutes)')).toHaveValue(30);
    expect(within(form).getByLabelText('Délai maximum estimé (minutes)')).toHaveValue(50);
    expect(within(form).getByLabelText('Mode de paiement')).toHaveValue('CASH_ON_DELIVERY');
    expect(within(form).getByLabelText('Mode d’affectation')).toHaveValue('MANUAL');
    expect(within(form).getByLabelText('Communication avec le livreur')).toHaveValue('WHATSAPP');
    await user.click(within(form).getByRole('button', { name: 'Enregistrer la zone' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith(`/admin/delivery-config/zones/${unconfiguredZone.id}`) &&
          init?.method === 'PATCH',
      );
      expect(requestBody(call?.[1])).toEqual({
        code: 'BIZERTE_EXPRESS',
        nameFr: 'Bizerte Express',
        nameAr: 'بنزرت السريع',
        priority: 100,
        estimatedMinDays: null,
        estimatedMaxDays: null,
        estimatedMinMinutes: 30,
        estimatedMaxMinutes: 50,
        paymentMethod: 'CASH_ON_DELIVERY',
        assignmentMode: 'MANUAL',
        driverCommunication: 'WHATSAPP',
        phoneConfirmationRequired: false,
        manualReviewRequired: false,
        expectedUpdatedAt: unconfiguredZone.updatedAt,
      });
    });
    expect(await within(form).findByText('Configuration de la zone mise à jour.')).toBeVisible();
  });

  it('creates the 8.000 TND zone base rate in integer millimes', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/admin/delivery-config/rates') && method === 'POST') {
        return Promise.resolve(
          json({
            id: 'rate-standard',
            deliveryZoneId: zone.id,
            type: 'BASE',
            name: 'Standard COD 8 TND',
            feeMillimes: 8000,
            priority: 10,
            express: false,
            active: false,
            version: 1,
            validFrom: null,
            validUntil: null,
          }),
        );
      }
      return Promise.resolve(commonRead(url, [], [zone]) ?? json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/delivery');

    const createButton = await screen.findByRole('button', { name: 'Créer le tarif inactif' });
    const form = createButton.closest('form');
    if (!form) throw new Error('Expected the delivery-rate form.');
    await within(form).findByRole('option', { name: 'Livraison nationale standard' });
    await user.selectOptions(within(form).getByLabelText('Zone'), zone.id);
    await user.type(within(form).getByLabelText('Nom du tarif'), 'Standard COD 8 TND');
    const amount = within(form).getByLabelText('Montant du tarif (TND)');
    await user.type(amount, '8,000');
    expect(
      within(form).getByText((_text, element) =>
        Boolean(element?.tagName === 'P' && element.textContent?.includes('8000 millimes')),
      ),
    ).toBeVisible();
    const priority = within(form).getByLabelText('Priorité (la valeur la plus élevée gagne)');
    await user.clear(priority);
    await user.type(priority, '10');
    await user.click(createButton);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith('/admin/delivery-config/rates') && init?.method === 'POST',
      );
      expect(requestBody(call?.[1])).toEqual({
        type: 'BASE',
        priority: 10,
        deliveryZoneId: zone.id,
        name: 'Standard COD 8 TND',
        feeMillimes: 8000,
        express: false,
      });
    });
  });

  it('patches a 4-millime rate to exactly 8000 millimes and refetches delivery data', async () => {
    let currentRates = [rate];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith(`/admin/delivery-config/rates/${rate.id}`) && method === 'PATCH') {
        const updatedRate = { ...rate, feeMillimes: 8000, version: 2 };
        currentRates = [updatedRate];
        return Promise.resolve(json(updatedRate));
      }
      return Promise.resolve(commonRead(url, [], [zone], currentRates) ?? json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/delivery');

    const form = await screen.findByRole('form', {
      name: 'Modifier le montant du tarif Standard COD',
    });
    const amount = within(form).getByLabelText('Montant du tarif (TND)');
    expect(amount).toHaveValue('0,004');
    await user.clear(amount);
    await user.type(amount, '8,000');
    expect(
      within(form).getByText((_text, element) =>
        Boolean(element?.tagName === 'P' && element.textContent?.includes('8000 millimes')),
      ),
    ).toBeVisible();
    await user.click(within(form).getByRole('button', { name: 'Enregistrer le montant' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith(`/admin/delivery-config/rates/${rate.id}`) &&
          init?.method === 'PATCH',
      );
      expect(requestBody(call?.[1])).toEqual({ feeMillimes: 8000, expectedVersion: 1 });
    });
    expect(await within(form).findByText('Montant du tarif mis à jour.')).toBeVisible();
    await waitFor(() => expect(amount).toHaveValue('8,000'));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input, init]) => {
          const url = requestUrl(input);
          return url.includes('/admin/delivery-config/rates?') && (init?.method ?? 'GET') === 'GET';
        }),
      ).toHaveLength(2);
    });
  });

  it('rejects delivery-rate input with more than three decimals without sending a patch', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      void init;
      return Promise.resolve(commonRead(url, [], [zone], [rate]) ?? json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/delivery');

    const form = await screen.findByRole('form', {
      name: 'Modifier le montant du tarif Standard COD',
    });
    const amount = within(form).getByLabelText('Montant du tarif (TND)');
    await user.clear(amount);
    await user.type(amount, '8,0000');
    await user.click(within(form).getByRole('button', { name: 'Enregistrer le montant' }));

    expect(
      await within(form).findByText('Le montant ne peut pas contenir plus de trois décimales.'),
    ).toBeVisible();
    expect(amount).toHaveValue('8,0000');
    await user.clear(amount);
    await user.type(amount, '1000,001');
    await user.click(within(form).getByRole('button', { name: 'Enregistrer le montant' }));
    expect(
      await within(form).findByText('Le montant ne peut pas dépasser 1 000 TND.'),
    ).toBeVisible();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          requestUrl(input).endsWith(`/admin/delivery-config/rates/${rate.id}`) &&
          init?.method === 'PATCH',
      ),
    ).toBe(false);
  });

  it('keeps the edited rate and shows a field-local stale-version error', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith(`/admin/delivery-config/rates/${rate.id}`) && method === 'PATCH') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              statusCode: 409,
              code: 'DELIVERY_RATE_VERSION_CONFLICT',
              message: 'The delivery rate changed.',
              requestId: 'rate-stale-1',
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(commonRead(url, [], [zone], [rate]) ?? json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/delivery');

    const form = await screen.findByRole('form', {
      name: 'Modifier le montant du tarif Standard COD',
    });
    const amount = within(form).getByLabelText('Montant du tarif (TND)');
    await user.clear(amount);
    await user.type(amount, '8');
    await user.click(within(form).getByRole('button', { name: 'Enregistrer le montant' }));

    expect(
      await within(form).findByText(
        'Cette configuration a changé depuis son chargement. Actualisez la page puis réessayez.',
      ),
    ).toBeVisible();
    expect(within(form).getByText('Référence de la demande : rate-stale-1')).toBeVisible();
    expect(amount).toHaveValue('8');
    await waitFor(() => expect(amount).toHaveFocus());
  });

  it('shows the request reference for an unexpected rate-update failure and preserves the form', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith(`/admin/delivery-config/rates/${rate.id}`) && method === 'PATCH') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              statusCode: 503,
              code: 'SERVICE_UNAVAILABLE',
              message: 'The service is temporarily unavailable.',
              requestId: 'rate-service-1',
            }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(commonRead(url, [], [zone], [rate]) ?? json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/delivery');

    const form = await screen.findByRole('form', {
      name: 'Modifier le montant du tarif Standard COD',
    });
    const amount = within(form).getByLabelText('Montant du tarif (TND)');
    await user.clear(amount);
    await user.type(amount, '8.000');
    await user.click(within(form).getByRole('button', { name: 'Enregistrer le montant' }));

    const alert = await within(form).findByRole('alert');
    expect(
      within(alert).getByText('La modification n’a pas pu être enregistrée. Réessayez.'),
    ).toBeVisible();
    expect(within(alert).getByText(/Référence de la demande : rate-service-1/)).toBeVisible();
    expect(amount).toHaveValue('8.000');
  });

  it('normalizes a lowercase pickup code before creating the pickup', async () => {
    const pickup = {
      id: 'pickup-bizerte',
      code: 'BIZERTE',
      nameFr: 'Bizerte',
      nameAr: 'بنزرت',
      address: 'Bizerte centre',
      active: false,
      stateToken: 'a'.repeat(64),
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/admin/delivery-config/pickups') && method === 'POST') {
        return Promise.resolve(json(pickup));
      }
      return Promise.resolve(commonRead(url, [], []) ?? json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/delivery');

    await user.click(await screen.findByText('Créer un point de retrait'));
    const createButton = await screen.findByRole('button', { name: 'Créer le point inactif' });
    const form = createButton.closest('form');
    if (!form) throw new Error('Expected the pickup form.');
    await user.type(within(form).getByLabelText('Code (majuscules)'), 'bizerte');
    await user.type(within(form).getByLabelText('Nom français'), 'Bizerte');
    await user.type(within(form).getByLabelText('Nom arabe'), 'بنزرت');
    await user.type(within(form).getByLabelText('Adresse'), 'Bizerte centre');
    await user.click(createButton);

    expect(await screen.findByText('Point de retrait inactif créé.')).toBeVisible();
    const call = fetchMock.mock.calls.find(
      ([input, init]) =>
        requestUrl(input).endsWith('/admin/delivery-config/pickups') && init?.method === 'POST',
    );
    expect(requestBody(call?.[1])).toEqual({
      code: 'BIZERTE',
      nameFr: 'Bizerte',
      nameAr: 'بنزرت',
      address: 'Bizerte centre',
    });
  });

  it('shows a localized pickup conflict beside the form without the generic retry state', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/admin/delivery-config/pickups') && method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              statusCode: 409,
              code: 'PICKUP_CODE_CONFLICT',
              message: 'The delivery configuration identifier is already assigned.',
              requestId: 'pickup-request-1',
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(commonRead(url, [], []) ?? json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/delivery');

    await user.click(await screen.findByText('Créer un point de retrait'));
    const createButton = await screen.findByRole('button', { name: 'Créer le point inactif' });
    const form = createButton.closest('form');
    if (!form) throw new Error('Expected the pickup form.');
    await user.type(within(form).getByLabelText('Code (majuscules)'), 'BIZERTE');
    await user.type(within(form).getByLabelText('Nom français'), 'Bizerte');
    await user.type(within(form).getByLabelText('Nom arabe'), 'بنزرت');
    await user.type(within(form).getByLabelText('Adresse'), 'Bizerte centre');
    await user.click(createButton);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Ce code de point de retrait est déjà utilisé.')).toBeVisible();
    expect(within(alert).getByText('Référence de la demande : pickup-request-1')).toBeVisible();
    expect(screen.queryByText('Nous rencontrons un problème')).not.toBeInTheDocument();
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('links a named governorate instead of requiring an internal locality identifier', async () => {
    const governorate = { id: 'governorate-bizerte', name: 'Bizerte', supported: false };
    const delegation = { id: 'delegation-bizerte', name: 'Bizerte Nord', supported: false };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/admin/delivery-config/geography/governorates')) {
        return Promise.resolve(json([governorate]));
      }
      if (
        url.endsWith(
          '/admin/delivery-config/geography/governorates/governorate-bizerte/delegations',
        )
      ) {
        return Promise.resolve(json([delegation]));
      }
      if (
        url.endsWith(`/admin/delivery-config/zones/${zone.id}/geography-links`) &&
        method === 'PUT'
      ) {
        return Promise.resolve(json({ ...zone, localityCount: 12 }));
      }
      return Promise.resolve(commonRead(url, [], [zone]) ?? json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/delivery');

    const linkButton = await screen.findByRole('button', { name: 'Ajouter cette couverture' });
    const form = linkButton.closest('form');
    if (!form) throw new Error('Expected the geography form.');
    await within(form).findByRole('option', { name: 'Livraison nationale standard' });
    await within(form).findByRole('option', { name: 'Bizerte' });
    await user.selectOptions(within(form).getByLabelText('Zone'), zone.id);
    await user.selectOptions(within(form).getByLabelText('Gouvernorat'), governorate.id);
    await user.click(linkButton);

    expect(await screen.findByText('Couverture géographique ajoutée à la zone.')).toBeVisible();
    const call = fetchMock.mock.calls.find(
      ([input, init]) =>
        requestUrl(input).endsWith(`/admin/delivery-config/zones/${zone.id}/geography-links`) &&
        init?.method === 'PUT',
    );
    expect(requestBody(call?.[1])).toEqual({
      expectedUpdatedAt: zone.updatedAt,
      confirmed: true,
      scope: 'GOVERNORATE',
      geographyId: governorate.id,
      active: true,
    });
    expect(
      fetchMock.mock.calls.some(([input]) => requestUrl(input).includes('/api/v1/geography/')),
    ).toBe(false);
  });

  it('restricts Bizerte Express to explicit Bizerte delegation coverage', async () => {
    const governorate = { id: 'governorate-bizerte', name: 'Bizerte', supported: false };
    const otherGovernorate = { id: 'governorate-tunis', name: 'Tunis', supported: true };
    const delegation = { id: 'delegation-bizerte-nord', name: 'Bizerte Nord', supported: false };
    const locality = { id: 'locality-bizerte', name: 'Bizerte', supported: false };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/admin/delivery-config/geography/governorates')) {
        return Promise.resolve(json([governorate, otherGovernorate]));
      }
      if (
        url.endsWith(
          '/admin/delivery-config/geography/governorates/governorate-bizerte/delegations',
        )
      ) {
        return Promise.resolve(json([delegation]));
      }
      if (
        url.endsWith(
          '/admin/delivery-config/geography/delegations/delegation-bizerte-nord/localities',
        )
      ) {
        return Promise.resolve(json([locality]));
      }
      if (
        url.endsWith(`/admin/delivery-config/zones/${bizerteZone.id}/geography-links`) &&
        method === 'PUT'
      ) {
        return Promise.resolve(json({ ...bizerteZone, localityCount: 8 }));
      }
      return Promise.resolve(commonRead(url, [], [bizerteZone]) ?? json({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/admin/delivery');

    const linkButton = await screen.findByRole('button', { name: 'Ajouter cette couverture' });
    const form = linkButton.closest('form');
    if (!form) throw new Error('Expected the geography form.');
    await within(form).findByRole('option', { name: 'Bizerte Express' });
    await user.selectOptions(within(form).getByLabelText('Zone'), bizerteZone.id);
    const scope = within(form).getByLabelText('Niveau de couverture');
    expect(scope).toHaveValue('DELEGATION');
    expect(within(scope).getByRole('option', { name: 'Gouvernorat entier' })).toBeDisabled();
    await within(form).findByRole('option', { name: 'Bizerte' });
    expect(within(form).queryByRole('option', { name: 'Tunis' })).not.toBeInTheDocument();
    await user.selectOptions(within(form).getByLabelText('Gouvernorat'), governorate.id);
    await within(form).findByRole('option', { name: 'Bizerte Nord' });
    await user.selectOptions(within(form).getByLabelText('Délégation'), delegation.id);

    expect(
      await within(form).findByText(
        'Cette sélection existe et peut être configurée, mais elle n’est pas encore desservie.',
      ),
    ).toBeVisible();
    await user.click(linkButton);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith(
            `/admin/delivery-config/zones/${bizerteZone.id}/geography-links`,
          ) && init?.method === 'PUT',
      );
      expect(requestBody(call?.[1])).toEqual({
        expectedUpdatedAt: bizerteZone.updatedAt,
        confirmed: true,
        scope: 'DELEGATION',
        geographyId: delegation.id,
        active: true,
      });
    });
  });
});
