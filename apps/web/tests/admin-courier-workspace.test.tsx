import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AdminCourierAssignmentOption,
  AdminCourierRecord,
  AdminDeliveryDetail,
  AdminDeliveryZoneConfig,
} from '../src/api/types';
import { parseOptionalCourierFeeTnd } from '../src/pages/admin/courier-fee';
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
  id: 'zone-bizerte',
  code: 'BIZERTE_EXPRESS',
  nameFr: 'Bizerte Express',
  nameAr: 'بنزرت السريع',
  priority: 100,
  active: true,
  supported: true,
  temporarilySuspended: false,
  phoneConfirmationRequired: false,
  manualReviewRequired: false,
  minOrderMillimes: null,
  maxCodMillimes: null,
  freeDeliveryThresholdMillimes: null,
  estimatedMinDays: null,
  estimatedMaxDays: null,
  estimatedMinMinutes: 30,
  estimatedMaxMinutes: 50,
  paymentMethod: 'CASH_ON_DELIVERY',
  assignmentMode: 'MANUAL',
  driverCommunication: 'WHATSAPP',
  localityCount: 8,
  activeRateCount: 1,
  createdAt: '2026-08-04T08:00:00.000Z',
  updatedAt: '2026-08-04T08:00:00.000Z',
};

const courierA: AdminCourierRecord = {
  id: 'courier-a',
  code: 'BIZ-01',
  name: 'Amine',
  companyName: 'Bizerte Express',
  status: 'ACTIVE',
  availabilityStatus: 'AVAILABLE',
  contactName: 'Amine Ben Ali',
  phoneE164: '+21620111111',
  whatsappPhoneE164: '+21620111111',
  email: null,
  defaultFeeMillimes: 8_000,
  maximumActiveDeliveries: 12,
  whatsappTemplate: 'Commande {{orderNumber}}',
  notes: 'Quart de matin',
  integrations: [{ type: 'MANUAL', name: 'Manual administrator operations', active: true }],
  coverageMode: 'ZONES',
  coverageZones: [
    {
      deliveryZoneId: zone.id,
      code: zone.code,
      nameFr: zone.nameFr,
      nameAr: zone.nameAr,
      active: true,
      zoneActive: true,
      zoneSupported: true,
      zoneTemporarilySuspended: false,
      feeMillimes: 7_500,
      localityCount: 8,
      createdAt: '2026-08-04T08:00:00.000Z',
      updatedAt: '2026-08-04T08:00:00.000Z',
    },
  ],
  activeDeliveryCount: 3,
  deliveryCount: 21,
  manifestCount: 2,
  createdAt: '2026-08-04T08:00:00.000Z',
  updatedAt: '2026-08-04T08:00:00.000Z',
};

const courierB: AdminCourierRecord = {
  ...courierA,
  id: 'courier-b',
  code: 'NAT-02',
  name: 'Sami',
  companyName: 'National Manual',
  defaultFeeMillimes: 9_000,
  maximumActiveDeliveries: 2,
  coverageMode: 'UNRESTRICTED',
  coverageZones: [],
  activeDeliveryCount: 2,
  deliveryCount: 8,
  manifestCount: 0,
};

const delivery: AdminDeliveryDetail = {
  id: 'delivery-1',
  orderId: 'order-1',
  orderNumber: 'CMD-001',
  orderStatus: 'ASSIGNED_TO_COURIER',
  paymentStatus: 'COD_PENDING',
  expectedCodMillimes: 164_004,
  status: 'ASSIGNED_TO_COURIER',
  courier: { id: courierA.id, code: courierA.code, name: courierA.name },
  trackingNumber: 'TRACK-001',
  courierFeeMillimes: 7_500,
  assignedAt: '2026-08-04T09:00:00.000Z',
  handedToCourierAt: null,
  deliveredAt: null,
  nextAttemptAt: null,
  internalNotes: null,
  customerVisibleNotes: null,
  ageVerificationResult: 'PENDING',
  ageVerificationRequired: true,
  cashCollectedResult: null,
  version: 2,
  attempts: [],
  events: [],
};

const assignmentOptions: AdminCourierAssignmentOption[] = [
  {
    id: courierA.id,
    code: courierA.code,
    name: courierA.name,
    availabilityStatus: 'AVAILABLE',
    activeDeliveryCount: 3,
    maximumActiveDeliveries: 12,
    assignable: true,
    requiresWarningAcknowledgement: false,
    unavailableReason: null,
    warnings: [],
  },
  {
    id: courierB.id,
    code: courierB.code,
    name: courierB.name,
    availabilityStatus: 'AVAILABLE',
    activeDeliveryCount: 2,
    maximumActiveDeliveries: 2,
    assignable: true,
    requiresWarningAcknowledgement: true,
    unavailableReason: null,
    warnings: ['COURIER_OUTSIDE_DELIVERY_ZONE', 'COURIER_CAPACITY_EXCEEDED'],
  },
];

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON body.');
  return JSON.parse(init.body) as Record<string, unknown>;
}

function baseRead(url: string, couriers: AdminCourierRecord[] = [courierA, courierB]) {
  if (url.includes('/auth/admin/session')) return json({ user: adminUser });
  if (url.includes('/admin/delivery-config/zones?')) return json(page([zone]));
  if (url.includes('/admin/delivery-config/rates?')) return json(page([]));
  if (url.includes('/admin/delivery-config/pickups?')) return json(page([]));
  if (url.endsWith('/admin/delivery-config/geography/governorates')) return json([]);
  if (url.includes('/admin/deliveries/courier-records?')) return json(page(couriers));
  if (url.includes('/admin/deliveries/couriers?deliveryId=')) return json(assignmentOptions);
  if (url.endsWith('/admin/deliveries/couriers')) return json(assignmentOptions);
  if (url.includes('/admin/deliveries/manifests?')) return json(page([]));
  if (url.includes('/admin/deliveries?')) {
    return json(
      page([
        {
          id: delivery.id,
          trackingNumber: delivery.trackingNumber,
          zoneName: zone.nameFr,
          courierName: courierA.name,
          status: delivery.status,
        },
      ]),
    );
  }
  if (url.endsWith(`/admin/deliveries/${delivery.id}`)) return json(delivery);
  return json({});
}

async function openOperations() {
  renderRoute('/admin/delivery');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Gérer les livraisons/ }));
  return user;
}

beforeEach(() => {
  document.documentElement.lang = 'fr';
  document.cookie = 'vape_admin_csrf=test-admin-csrf; Path=/';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('courier fee parsing', () => {
  it('converts optional TND input into integer millimes without floating point', () => {
    expect(parseOptionalCourierFeeTnd('8,000')).toEqual({ value: 8_000, error: null });
    expect(parseOptionalCourierFeeTnd('0.004')).toEqual({ value: 4, error: null });
    expect(parseOptionalCourierFeeTnd('')).toEqual({ value: null, error: null });
    expect(parseOptionalCourierFeeTnd('8.0001')).toEqual({ value: null, error: 'precision' });
    expect(parseOptionalCourierFeeTnd('-1')).toEqual({ value: null, error: 'nonNegative' });
  });
});

describe('administrator courier workspace', () => {
  it('creates a bounded manual courier profile with capacity, WhatsApp and zone fee', async () => {
    const records: AdminCourierRecord[] = [];
    const created: AdminCourierRecord = {
      ...courierA,
      id: 'courier-created',
      code: 'BIZ-NEW',
      name: 'Nouveau livreur',
      activeDeliveryCount: 0,
      deliveryCount: 0,
      manifestCount: 0,
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith('/admin/deliveries/courier-records') && init?.method === 'POST') {
        records.push(created);
        return Promise.resolve(json(created));
      }
      return Promise.resolve(baseRead(url, records));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = await openOperations();
    await user.click(await screen.findByText('Créer le livreur', { selector: 'summary strong' }));
    const createButton = await screen.findByRole('button', { name: 'Créer le livreur' });
    const form = createButton.closest('form');
    if (!form) throw new Error('Expected courier creation form.');

    await user.type(within(form).getByLabelText('Code'), 'biz-new');
    await user.type(within(form).getByLabelText('Nom du livreur'), 'Nouveau livreur');
    await user.type(within(form).getByLabelText('Société'), 'Bizerte Express');
    await user.type(within(form).getByLabelText('Numéro WhatsApp'), '+21620123456');
    await user.type(within(form).getByLabelText('Coût interne par défaut (TND)'), '8,000');
    await user.type(within(form).getByLabelText('Capacité maximale active'), '12');
    await user.click(within(form).getByRole('checkbox', { name: /Bizerte Express/ }));
    await user.type(within(form).getByLabelText('Coût interne de cette zone (TND)'), '7,500');
    await user.click(createButton);

    expect(await screen.findByText('Livreur créé : BIZ-NEW · Nouveau livreur.')).toBeVisible();
    const call = fetchMock.mock.calls.find(
      ([input, init]) =>
        requestUrl(input).endsWith('/admin/deliveries/courier-records') && init?.method === 'POST',
    );
    expect(requestBody(call?.[1])).toMatchObject({
      code: 'BIZ-NEW',
      name: 'Nouveau livreur',
      companyName: 'Bizerte Express',
      whatsappPhoneE164: '+21620123456',
      defaultFeeMillimes: 8_000,
      maximumActiveDeliveries: 12,
      coverageZones: [{ deliveryZoneId: zone.id, active: true, feeMillimes: 7_500 }],
      confirmation: 'CREATE_MANUAL_COURIER',
    });
  });

  it('requires both server warnings before reassigning a delivery', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith(`/admin/deliveries/${delivery.id}/reassign`) && init?.method === 'POST') {
        return Promise.resolve(
          json({
            ...delivery,
            courier: { id: courierB.id, code: courierB.code, name: courierB.name },
            version: delivery.version + 1,
          }),
        );
      }
      return Promise.resolve(baseRead(url));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = await openOperations();
    await user.click(await screen.findByRole('button', { name: 'Gérer' }));
    const detailHeading = await screen.findByRole('heading', { name: /CMD-001/ });
    const detail = detailHeading.closest('section');
    if (!detail) throw new Error('Expected delivery detail.');

    await user.selectOptions(within(detail).getByLabelText('Livreur actif'), courierB.id);
    const submit = within(detail).getByRole('button', { name: 'Réassigner' });
    expect(submit).toBeDisabled();
    await user.click(
      within(detail).getByRole('checkbox', {
        name: /exceptionnellement desservir cette zone/,
      }),
    );
    expect(submit).toBeDisabled();
    await user.click(
      within(detail).getByRole('checkbox', { name: /dépassement exceptionnel de la capacité/ }),
    );
    await user.type(
      within(detail).getByLabelText('Motif obligatoire de la réaffectation'),
      'Renfort nécessaire',
    );
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith(`/admin/deliveries/${delivery.id}/reassign`) &&
          init?.method === 'POST',
      );
      expect(requestBody(call?.[1])).toMatchObject({
        expectedVersion: 2,
        courierId: courierB.id,
        reason: 'Renfort nécessaire',
        acknowledgedWarnings: ['COURIER_OUTSIDE_DELIVERY_ZONE', 'COURIER_CAPACITY_EXCEEDED'],
      });
    });
  });

  it('filters courier records and updates availability, capacity and zone fees', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (
        url.endsWith(`/admin/deliveries/courier-records/${courierA.id}`) &&
        init?.method === 'PATCH'
      ) {
        return Promise.resolve(
          json({
            ...courierA,
            availabilityStatus: 'OFF_DUTY',
            maximumActiveDeliveries: 8,
            coverageZones: [{ ...courierA.coverageZones[0], feeMillimes: 7_750 }],
          }),
        );
      }
      return Promise.resolve(baseRead(url));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = await openOperations();

    const filters = await screen.findByRole('form', { name: 'Filtres des livreurs' });
    await user.type(within(filters).getByLabelText('Rechercher un livreur'), 'Amine');
    await user.selectOptions(within(filters).getByLabelText('Statut'), 'ACTIVE');
    await user.selectOptions(
      within(filters).getByLabelText('Disponibilité opérationnelle'),
      'OFF_DUTY',
    );
    await user.click(within(filters).getByRole('button', { name: 'Appliquer les filtres' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = new URL(requestUrl(input), 'http://local.test');
          return (
            url.pathname.endsWith('/admin/deliveries/courier-records') &&
            url.searchParams.get('q') === 'Amine' &&
            url.searchParams.get('status') === 'ACTIVE' &&
            url.searchParams.get('availabilityStatus') === 'OFF_DUTY'
          );
        }),
      ).toBe(true);
    });

    const courierHeading = await screen.findByRole('heading', { name: 'Amine' });
    const card = courierHeading.closest('article');
    if (!card) throw new Error('Expected courier card.');
    await user.click(within(card).getByText('Modifier la fiche', { selector: 'summary strong' }));
    const save = within(card).getByRole('button', { name: 'Enregistrer le livreur' });
    const form = save.closest('form');
    if (!form) throw new Error('Expected courier edit form.');
    await user.selectOptions(
      within(form).getByLabelText('Disponibilité opérationnelle'),
      'OFF_DUTY',
    );
    await user.clear(within(form).getByLabelText('Capacité maximale active'));
    await user.type(within(form).getByLabelText('Capacité maximale active'), '8');
    await user.clear(within(form).getByLabelText('Coût interne de cette zone (TND)'));
    await user.type(within(form).getByLabelText('Coût interne de cette zone (TND)'), '7,750');
    await user.click(save);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith(`/admin/deliveries/courier-records/${courierA.id}`) &&
          init?.method === 'PATCH',
      );
      expect(requestBody(call?.[1])).toMatchObject({
        expectedUpdatedAt: courierA.updatedAt,
        availabilityStatus: 'OFF_DUTY',
        maximumActiveDeliveries: 8,
        coverageZones: [{ deliveryZoneId: zone.id, active: true, feeMillimes: 7_750 }],
        confirmation: 'UPDATE_MANUAL_COURIER',
      });
    });
  });

  it('requires a reason and sends the explicit confirmation when unassigning', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith(`/admin/deliveries/${delivery.id}/unassign`) && init?.method === 'POST') {
        return Promise.resolve(
          json({ ...delivery, courier: null, status: 'READY_FOR_PICKUP', version: 3 }),
        );
      }
      return Promise.resolve(baseRead(url));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = await openOperations();
    await user.click(await screen.findByRole('button', { name: 'Gérer' }));
    const detailHeading = await screen.findByRole('heading', { name: /CMD-001/ });
    const detail = detailHeading.closest('section');
    if (!detail) throw new Error('Expected delivery detail.');

    const reason = within(detail).getByLabelText('Motif obligatoire du retrait');
    const submit = within(detail).getByRole('button', { name: 'Retirer le livreur' });
    expect(submit).toBeEnabled();
    await user.type(reason, 'Livreur indisponible');
    await user.click(submit);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith(`/admin/deliveries/${delivery.id}/unassign`) &&
          init?.method === 'POST',
      );
      expect(requestBody(call?.[1])).toEqual({
        expectedVersion: 2,
        reason: 'Livreur indisponible',
        confirmation: 'UNASSIGN_COURIER',
      });
    });
  });

  it('previews, copies, opens and records only a server-rendered manual WhatsApp message', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const preview = {
      courierId: courierA.id,
      courierName: courierA.name,
      phoneE164: '+21620111111',
      renderedMessage: 'Commande CMD-001\nMontant à encaisser : 164,004 TND',
      url: 'https://wa.me/21620111111?text=Commande%20CMD-001',
      manualOnly: true as const,
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith(`/admin/deliveries/${delivery.id}/courier-whatsapp`)) {
        return Promise.resolve(json(preview));
      }
      if (
        url.endsWith(`/admin/deliveries/${delivery.id}/courier-contacted`) &&
        init?.method === 'POST'
      ) {
        return Promise.resolve(json({ ...delivery, version: delivery.version + 1 }));
      }
      if (
        url.endsWith(`/admin/deliveries/${delivery.id}/internal-notes`) &&
        init?.method === 'PATCH'
      ) {
        return Promise.resolve(
          json({ ...delivery, internalNotes: 'Appeler avant le départ', version: 3 }),
        );
      }
      return Promise.resolve(baseRead(url));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = await openOperations();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await user.click(await screen.findByRole('button', { name: 'Gérer' }));
    const detailHeading = await screen.findByRole('heading', { name: /CMD-001/ });
    const detail = detailHeading.closest('section');
    if (!detail) throw new Error('Expected delivery detail.');

    await user.click(within(detail).getByRole('button', { name: 'Prévisualiser le message' }));
    expect(await within(detail).findByText('Envoi manuel uniquement')).toBeVisible();
    expect(within(detail).getByText(/Montant à encaisser/)).toBeVisible();
    const openLink = within(detail).getByRole('link', { name: 'Ouvrir WhatsApp' });
    expect(openLink).toHaveAttribute('href', preview.url);
    expect(openLink).toHaveAttribute('target', '_blank');
    await user.click(within(detail).getByRole('button', { name: 'Copier le message' }));
    expect(writeText).toHaveBeenCalledWith(preview.renderedMessage);
    await user.click(within(detail).getByRole('button', { name: 'Marquer le contact effectué' }));
    await waitFor(() => {
      expect(
        within(detail).queryByRole('link', { name: 'Ouvrir WhatsApp' }),
      ).not.toBeInTheDocument();
    });

    const notes = within(detail).getByLabelText('Notes internes');
    await user.type(notes, 'Appeler avant le départ');
    await user.click(within(detail).getByRole('button', { name: 'Enregistrer les notes' }));

    await waitFor(() => {
      const contactCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith(`/admin/deliveries/${delivery.id}/courier-contacted`) &&
          init?.method === 'POST',
      );
      expect(requestBody(contactCall?.[1])).toEqual({
        expectedVersion: 2,
        confirmation: 'RECORD_COURIER_WHATSAPP_CONTACT',
      });
      const notesCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith(`/admin/deliveries/${delivery.id}/internal-notes`) &&
          init?.method === 'PATCH',
      );
      expect(requestBody(notesCall?.[1])).toEqual({
        expectedVersion: 2,
        internalNotes: 'Appeler avant le départ',
      });
    });
  });

  it('ignores a WhatsApp preview that resolves after selecting another delivery', async () => {
    const secondDelivery: AdminDeliveryDetail = {
      ...delivery,
      id: 'delivery-2',
      orderId: 'order-2',
      orderNumber: 'CMD-002',
      trackingNumber: 'TRACK-002',
    };
    const stalePreview = {
      courierId: courierA.id,
      courierName: courierA.name,
      phoneE164: '+21620111111',
      renderedMessage: 'Commande CMD-001 - confidentiel',
      url: 'https://wa.me/21620111111?text=Commande%20CMD-001',
      manualOnly: true as const,
    };
    let resolvePreview: ((response: Response) => void) | undefined;
    const pendingPreview = new Promise<Response>((resolve) => {
      resolvePreview = resolve;
    });
    const deliveryList = [delivery, secondDelivery].map((item) => ({
      id: item.id,
      trackingNumber: item.trackingNumber,
      zoneName: zone.nameFr,
      courierName: courierA.name,
      status: item.status,
    }));
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith(`/admin/deliveries/${delivery.id}/courier-whatsapp`)) {
        return pendingPreview;
      }
      if (url.includes('/admin/deliveries?')) return Promise.resolve(json(page(deliveryList)));
      if (url.endsWith(`/admin/deliveries/${secondDelivery.id}`)) {
        return Promise.resolve(json(secondDelivery));
      }
      return Promise.resolve(baseRead(url));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = await openOperations();
    const manageButtons = await screen.findAllByRole('button', { name: 'Gérer' });

    await user.click(manageButtons[0]!);
    const firstHeading = await screen.findByRole('heading', { name: /CMD-001/ });
    const firstDetail = firstHeading.closest('section');
    if (!firstDetail) throw new Error('Expected first delivery detail.');
    await user.click(within(firstDetail).getByRole('button', { name: 'Prévisualiser le message' }));

    await user.click(manageButtons[1]!);
    const secondHeading = await screen.findByRole('heading', { name: /CMD-002/ });
    const secondDetail = secondHeading.closest('section');
    if (!secondDetail) throw new Error('Expected second delivery detail.');
    resolvePreview?.(json(stalePreview));

    await waitFor(() => {
      expect(
        within(secondDetail).getByRole('button', { name: 'Prévisualiser le message' }),
      ).toBeEnabled();
    });
    expect(within(secondDetail).queryByText(stalePreview.renderedMessage)).not.toBeInTheDocument();
    expect(
      within(secondDetail).queryByRole('link', { name: 'Ouvrir WhatsApp' }),
    ).not.toBeInTheDocument();
  });
});
