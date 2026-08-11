import { AgeVerificationResult, DeliveryAttemptOutcome, DeliveryStatus } from '@prisma/client';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../common/security/crypto.service';
import type { PrismaService } from '../database/prisma.service';
import { AdminDeliveriesService } from './admin-deliveries.service';

// Vitest's asymmetric matcher helpers are typed as `any`; keep that boundary in one test helper.
// eslint-disable-next-line @typescript-eslint/no-unsafe-return
const containing = <T extends object>(shape: T): T => expect.objectContaining(shape as never);
const matchingString = (pattern: string | RegExp): string => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return typeof pattern === 'string'
    ? expect.stringContaining(pattern)
    : expect.stringMatching(pattern);
};

const request = {
  auth: { userId: 'admin-id' },
  requestId: 'request-id',
  ip: '127.0.0.1',
  socket: {},
  get: vi.fn().mockReturnValue('vitest'),
} as unknown as Request;

const crypto = {
  hashToken: vi.fn().mockReturnValue('a'.repeat(64)),
  encrypt: vi.fn().mockReturnValue('encrypted-recipient'),
} as unknown as CryptoService;

const operationDelivery = (status: DeliveryStatus = DeliveryStatus.PREPARING) => ({
  id: 'delivery-id',
  orderId: 'order-id',
  courierId: null as string | null,
  status,
  trackingNumber: null,
  courierFeeMillimes: null,
  internalNotes: null as string | null,
  ageVerificationRequired: true,
  ageVerificationResult: AgeVerificationResult.PENDING as AgeVerificationResult,
  version: 4,
  order: {
    id: 'order-id',
    orderNumber: 'TN-000001',
    customerEmailSnapshot: 'customer@example.test',
    customerPhoneSnapshot: '+21620111222',
    customerNameSnapshot: 'Customer Name',
    customerId: 'customer-id',
    status,
    paymentStatus: 'CASH_EXPECTED',
    expectedCodMillimes: 12_000,
    minimumAgeSnapshot: 18,
    deliveryMethodType: 'COURIER',
    deliveryZoneId: 'zone-id',
    deliveryInstructions: 'Call on arrival',
    version: 7,
    customer: { locale: 'fr' },
  },
  attempts: [],
  cashCollections: [],
});

const detailDelivery = (status: DeliveryStatus, courier = false) => ({
  id: 'delivery-id',
  orderId: 'order-id',
  status,
  trackingNumber: null,
  courierFeeMillimes: null,
  assignedAt: courier ? new Date('2026-07-13T10:00:00.000Z') : null,
  handedToCourierAt: null,
  deliveredAt: null,
  nextAttemptAt: null,
  internalNotes: null,
  customerVisibleNotes: null,
  ageVerificationRequired: true,
  ageVerificationResult: AgeVerificationResult.PENDING,
  cashCollectedResult: null,
  version: 5,
  createdAt: new Date('2026-07-13T09:00:00.000Z'),
  updatedAt: new Date('2026-07-13T10:00:00.000Z'),
  courier: courier ? { id: 'courier-id', code: 'MANUAL-1', name: 'Manual courier' } : null,
  order: {
    orderNumber: 'TN-000001',
    status,
    paymentStatus: 'CASH_EXPECTED',
    expectedCodMillimes: 12_000,
  },
  attempts: [],
  events: [],
  _count: { attempts: 0, events: 0 },
});

const whatsappDelivery = () => ({
  id: 'delivery-id',
  status: DeliveryStatus.PREPARING,
  version: 4,
  courierId: 'courier-id',
  courier: {
    id: 'courier-id',
    name: 'Manual courier',
    status: 'ACTIVE',
    phoneE164: '+21620111222',
    whatsappPhoneE164: '+21622123456',
    whatsappTemplate:
      'Commande {{orderNumber}} — {{customerName}} — {{deliveryAddress}} — {{amountToCollect}}',
  },
  order: {
    orderNumber: 'TN-000001',
    customerNameSnapshot: 'Amel Ben Salah',
    customerPhoneSnapshot: '+21620111222',
    expectedCodMillimes: 12_345,
    deliveryInstructions: 'Téléphoner avant arrivée',
    addressSnapshots: [
      {
        governorateName: 'Bizerte',
        delegationName: 'Bizerte Nord',
        localityName: 'La Corniche',
        postalCode: '7000',
        street: '1 Rue du Port',
        building: null,
        floor: null,
        apartment: null,
        landmark: 'Phare',
        instructions: null,
      },
    ],
  },
});

const transactionBase = (
  operation = operationDelivery(),
  detail?: ReturnType<typeof detailDelivery>,
) => ({
  $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked-id' }]),
  delivery: {
    findUnique: vi
      .fn()
      .mockResolvedValueOnce({ orderId: 'order-id' })
      .mockResolvedValueOnce(operation)
      .mockResolvedValueOnce(detail),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn().mockResolvedValue(0),
  },
  order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  courier: {
    findFirst: vi.fn().mockResolvedValue({
      id: 'courier-id',
      availabilityStatus: 'AVAILABLE',
      defaultFeeMillimes: 7_000,
      maximumActiveDeliveries: null,
      deliveryZones: [],
    }),
  },
  deliveryManifestItem: { count: vi.fn().mockResolvedValue(0) },
  deliveryEvent: { create: vi.fn().mockResolvedValue({}) },
  orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
  deliveryAttempt: {
    create: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
  },
  ageVerificationEvent: {
    create: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
  },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  storeSetting: { findUnique: vi.fn().mockResolvedValue(null) },
  notification: {
    create: vi.fn().mockResolvedValue({
      id: 'notification-id',
      channel: 'EMAIL',
      event: 'DELIVERY_FAILED',
    }),
  },
  outboxEvent: { create: vi.fn().mockResolvedValue({}) },
});

const serviceFor = <T extends ReturnType<typeof transactionBase>>(transaction: T) => {
  const prisma = {
    $transaction: vi.fn((callback: (tx: T) => unknown) => Promise.resolve(callback(transaction))),
  } as unknown as PrismaService;
  return new AdminDeliveriesService(prisma, crypto);
};

describe('manual administrator delivery service', () => {
  it('assigns only an active courier with optimistic versioning and immutable events', async () => {
    const transaction = transactionBase(
      operationDelivery(DeliveryStatus.PREPARING),
      detailDelivery(DeliveryStatus.PREPARING, true),
    );
    const service = serviceFor(transaction);

    await expect(
      service.assign('delivery-id', { expectedVersion: 4, courierId: 'courier-id' }, request),
    ).resolves.toMatchObject({
      data: { id: 'delivery-id', courier: { id: 'courier-id' }, version: 5 },
    });
    const updateCall = transaction.delivery.updateMany.mock.calls[0]?.[0] as {
      where: { id: string; version: number };
      data: { courierId: string; version: { increment: number } };
    };
    expect(updateCall).toMatchObject({
      where: { id: 'delivery-id', version: 4 },
      data: { courierId: 'courier-id', version: { increment: 1 } },
    });
    expect(transaction.deliveryEvent.create).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });

  it('hard-rejects an off-duty courier before assignment mutation', async () => {
    const transaction = transactionBase(operationDelivery(DeliveryStatus.PREPARING));
    transaction.courier.findFirst.mockResolvedValue({
      id: 'courier-id',
      availabilityStatus: 'OFF_DUTY',
      defaultFeeMillimes: 7_000,
      maximumActiveDeliveries: null,
      deliveryZones: [],
    });
    const service = serviceFor(transaction);

    await expect(
      service.assign('delivery-id', { expectedVersion: 4, courierId: 'courier-id' }, request),
    ).rejects.toMatchObject({ response: { code: 'COURIER_OFF_DUTY' } });
    expect(transaction.delivery.updateMany).not.toHaveBeenCalled();
  });

  it('hard-rejects an inactive courier before assignment mutation', async () => {
    const transaction = transactionBase(operationDelivery(DeliveryStatus.PREPARING));
    transaction.courier.findFirst.mockResolvedValue(null);
    const service = serviceFor(transaction);

    await expect(
      service.assign('delivery-id', { expectedVersion: 4, courierId: 'courier-id' }, request),
    ).rejects.toMatchObject({ response: { code: 'COURIER_UNAVAILABLE' } });
    expect(transaction.delivery.updateMany).not.toHaveBeenCalled();
  });

  it('requires an explicit acknowledgement before an outside-zone assignment', async () => {
    const transaction = transactionBase(operationDelivery(DeliveryStatus.PREPARING));
    transaction.courier.findFirst.mockResolvedValue({
      id: 'courier-id',
      availabilityStatus: 'AVAILABLE',
      defaultFeeMillimes: 7_000,
      maximumActiveDeliveries: null,
      deliveryZones: [{ deliveryZoneId: 'other-zone', active: true, feeMillimes: 9_000 }],
    });
    const service = serviceFor(transaction);

    await expect(
      service.assign('delivery-id', { expectedVersion: 4, courierId: 'courier-id' }, request),
    ).rejects.toMatchObject({
      response: {
        code: 'COURIER_ASSIGNMENT_WARNING_ACKNOWLEDGEMENT_REQUIRED',
        warnings: ['COURIER_OUTSIDE_DELIVERY_ZONE'],
      },
    });
    expect(transaction.delivery.updateMany).not.toHaveBeenCalled();
  });

  it('audits an acknowledged coverage override and derives only the internal courier fee', async () => {
    const transaction = transactionBase(
      operationDelivery(DeliveryStatus.PREPARING),
      detailDelivery(DeliveryStatus.PREPARING, true),
    );
    transaction.courier.findFirst.mockResolvedValue({
      id: 'courier-id',
      availabilityStatus: 'AVAILABLE',
      defaultFeeMillimes: 7_000,
      maximumActiveDeliveries: null,
      deliveryZones: [{ deliveryZoneId: 'other-zone', active: true, feeMillimes: 9_000 }],
    });
    const service = serviceFor(transaction);

    await service.assign(
      'delivery-id',
      {
        expectedVersion: 4,
        courierId: 'courier-id',
        acknowledgedWarnings: ['COURIER_OUTSIDE_DELIVERY_ZONE'],
      },
      request,
    );

    expect(transaction.delivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ courierFeeMillimes: 7_000 }),
      }),
    );
    expect(transaction.deliveryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({
          payload: containing({
            operationalWarnings: ['COURIER_OUTSIDE_DELIVERY_ZONE'],
            acknowledgedWarnings: ['COURIER_OUTSIDE_DELIVERY_ZONE'],
            internalFeeSource: 'DEFAULT',
          }),
        }),
      }),
    );
  });

  it('uses the active matching zone fee instead of the courier default internal cost', async () => {
    const transaction = transactionBase(
      operationDelivery(DeliveryStatus.PREPARING),
      detailDelivery(DeliveryStatus.PREPARING, true),
    );
    transaction.courier.findFirst.mockResolvedValue({
      id: 'courier-id',
      availabilityStatus: 'AVAILABLE',
      defaultFeeMillimes: 8_000,
      maximumActiveDeliveries: null,
      deliveryZones: [{ deliveryZoneId: 'zone-id', active: true, feeMillimes: 6_500 }],
    });
    const service = serviceFor(transaction);

    await service.assign('delivery-id', { expectedVersion: 4, courierId: 'courier-id' }, request);

    expect(transaction.delivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ courierFeeMillimes: 6_500 }),
      }),
    );
    expect(transaction.deliveryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ payload: containing({ internalFeeSource: 'ZONE' }) }),
      }),
    );
  });

  it('requires acknowledgement when the locked active-delivery count reaches capacity', async () => {
    const transaction = transactionBase(operationDelivery(DeliveryStatus.PREPARING));
    transaction.delivery.count.mockResolvedValue(2);
    transaction.courier.findFirst.mockResolvedValue({
      id: 'courier-id',
      availabilityStatus: 'AVAILABLE',
      defaultFeeMillimes: 7_000,
      maximumActiveDeliveries: 2,
      deliveryZones: [],
    });
    const service = serviceFor(transaction);

    await expect(
      service.assign('delivery-id', { expectedVersion: 4, courierId: 'courier-id' }, request),
    ).rejects.toMatchObject({
      response: {
        code: 'COURIER_ASSIGNMENT_WARNING_ACKNOWLEDGEMENT_REQUIRED',
        warnings: ['COURIER_CAPACITY_EXCEEDED'],
      },
    });
  });

  it('reassigns with reasoned immutable history', async () => {
    const operation = { ...operationDelivery(DeliveryStatus.PREPARING), courierId: 'old-courier' };
    const transaction = transactionBase(operation, detailDelivery(DeliveryStatus.PREPARING, true));
    const service = serviceFor(transaction);

    await service.reassign(
      'delivery-id',
      {
        expectedVersion: 4,
        courierId: 'courier-id',
        reason: 'Courier route changed before handoff.',
      },
      request,
    );

    expect(transaction.deliveryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({
          reasonCode: 'COURIER_REASSIGNED',
          note: 'Courier route changed before handoff.',
          payload: containing({ previousCourierId: 'old-courier' }),
        }),
      }),
    );
  });

  it('unassigns only before custody and clears courier-specific operational fields', async () => {
    const operation = { ...operationDelivery(DeliveryStatus.PREPARING), courierId: 'courier-id' };
    const transaction = transactionBase(operation, detailDelivery(DeliveryStatus.PREPARING));
    const service = serviceFor(transaction);

    await service.unassign(
      'delivery-id',
      {
        expectedVersion: 4,
        reason: 'Customer requested a different delivery window.',
        confirmation: 'UNASSIGN_COURIER',
      },
      request,
    );

    expect(transaction.deliveryManifestItem.count).toHaveBeenCalledOnce();
    expect(transaction.delivery.updateMany).toHaveBeenCalledWith({
      where: { id: 'delivery-id', version: 4 },
      data: {
        courierId: null,
        trackingNumber: null,
        courierFeeMillimes: null,
        assignedAt: null,
        version: { increment: 1 },
      },
    });
    expect(transaction.deliveryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ reasonCode: 'COURIER_UNASSIGNED' }),
      }),
    );
  });

  it('updates internal notes without copying their content into the audit record', async () => {
    const operation = {
      ...operationDelivery(DeliveryStatus.PREPARING),
      internalNotes: 'Old private note',
    };
    const transaction = transactionBase(operation, detailDelivery(DeliveryStatus.PREPARING));
    const service = serviceFor(transaction);

    await service.updateInternalNotes(
      'delivery-id',
      { expectedVersion: 4, internalNotes: 'Call only after 18:00' },
      request,
    );

    expect(transaction.delivery.updateMany).toHaveBeenCalledWith({
      where: { id: 'delivery-id', version: 4 },
      data: { internalNotes: 'Call only after 18:00', version: { increment: 1 } },
    });
    expect(transaction.deliveryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({ reasonCode: 'INTERNAL_NOTES_UPDATED' }),
      }),
    );
    const auditInput = transaction.auditLog.create.mock.calls[0]?.[0] as unknown as {
      data: { beforeSummary: unknown; afterSummary: unknown };
    };
    expect(auditInput.data).toMatchObject({
      beforeSummary: { notesPresent: true },
      afterSummary: { notesPresent: true, notesLength: 21 },
    });
    expect(JSON.stringify(auditInput)).not.toContain('Call only after 18:00');
  });

  it('builds a validated manual WhatsApp preview from immutable order snapshots', async () => {
    const transaction = {
      delivery: { findUnique: vi.fn().mockResolvedValue(whatsappDelivery()) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    } as unknown as PrismaService;
    const service = new AdminDeliveriesService(prisma, crypto);

    await expect(service.getCourierWhatsApp('delivery-id', request)).resolves.toMatchObject({
      data: {
        courierId: 'courier-id',
        phoneE164: '+21622123456',
        manualOnly: true,
        renderedMessage: matchingString('12.345 TND'),
        url: matchingString(/^https:\/\/wa\.me\/21622123456\?text=/),
      },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    const auditInput = transaction.auditLog.create.mock.calls[0]?.[0] as unknown as {
      data: { afterSummary: unknown };
    };
    expect(auditInput.data.afterSummary).toMatchObject({
      courierId: 'courier-id',
      channel: 'WHATSAPP',
      manualOnly: true,
      messageTemplateHash: 'a'.repeat(64),
    });
    expect(JSON.stringify(auditInput)).not.toContain('12.345 TND');
    expect(JSON.stringify(auditInput)).not.toContain('+21655123456');
  });

  it('rejects WhatsApp previews for terminal delivery history', async () => {
    const transaction = {
      delivery: {
        findUnique: vi.fn().mockResolvedValue({
          ...whatsappDelivery(),
          status: DeliveryStatus.DELIVERED,
        }),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    } as unknown as PrismaService;
    const service = new AdminDeliveriesService(prisma, crypto);

    await expect(service.getCourierWhatsApp('delivery-id', request)).rejects.toMatchObject({
      response: { code: 'DELIVERY_COURIER_CONTACT_NOT_ALLOWED' },
    });
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects WhatsApp previews for an inactive assigned courier', async () => {
    const transaction = {
      delivery: {
        findUnique: vi.fn().mockResolvedValue({
          ...whatsappDelivery(),
          courier: { ...whatsappDelivery().courier, status: 'SUSPENDED' },
        }),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    } as unknown as PrismaService;
    const service = new AdminDeliveriesService(prisma, crypto);

    await expect(service.getCourierWhatsApp('delivery-id', request)).rejects.toMatchObject({
      response: { code: 'COURIER_UNAVAILABLE' },
    });
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('records courier contact as an audited event without a provider send path', async () => {
    const operation = { ...operationDelivery(DeliveryStatus.PREPARING), courierId: 'courier-id' };
    const detail = detailDelivery(DeliveryStatus.PREPARING, true);
    const transaction = transactionBase(operation, detail);
    transaction.delivery.findUnique
      .mockReset()
      .mockResolvedValueOnce({ orderId: 'order-id' })
      .mockResolvedValueOnce(operation)
      .mockResolvedValueOnce(whatsappDelivery())
      .mockResolvedValueOnce(detail);
    const service = serviceFor(transaction);

    await service.recordCourierWhatsAppContact(
      'delivery-id',
      {
        expectedVersion: 4,
        confirmation: 'RECORD_COURIER_WHATSAPP_CONTACT',
      },
      request,
    );

    expect(transaction.deliveryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: containing({
          reasonCode: 'COURIER_CONTACTED',
          payload: containing({ channel: 'WHATSAPP', manualOnly: true }),
        }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });

  it('rejects OTHER_FAILED without a meaningful explanation', async () => {
    const transaction = transactionBase(operationDelivery(DeliveryStatus.OUT_FOR_DELIVERY));
    const service = serviceFor(transaction);

    await expect(
      service.recordAttempt(
        'delivery-id',
        { expectedVersion: 4, outcome: DeliveryAttemptOutcome.OTHER_FAILED },
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'OTHER_FAILURE_EXPLANATION_REQUIRED' } });
    expect(transaction.deliveryAttempt.create).not.toHaveBeenCalled();
  });

  it('records failed age verification as terminal failure evidence', async () => {
    const transaction = transactionBase(
      operationDelivery(DeliveryStatus.OUT_FOR_DELIVERY),
      detailDelivery(DeliveryStatus.FAILED),
    );
    const service = serviceFor(transaction);

    await expect(
      service.recordAttempt(
        'delivery-id',
        {
          expectedVersion: 4,
          outcome: DeliveryAttemptOutcome.FAILED_AGE_VERIFICATION,
          explanation: 'Recipient did not satisfy the required age verification.',
        },
        request,
      ),
    ).resolves.toMatchObject({ data: { status: 'FAILED' } });
    const attemptCall = transaction.deliveryAttempt.create.mock.calls[0]?.[0] as {
      data: { outcome: string; ageVerificationResult: string };
    };
    expect(attemptCall.data).toMatchObject({
      outcome: 'FAILED_AGE_VERIFICATION',
      ageVerificationResult: 'FAILED',
    });
    const ageCall = transaction.ageVerificationEvent.create.mock.calls[0]?.[0] as {
      data: { phase: string; result: string };
    };
    expect(ageCall.data).toMatchObject({ phase: 'DELIVERY', result: 'FAILED' });
    const orderUpdateCall = transaction.order.updateMany.mock.calls[0]?.[0] as {
      data: { status: string; version: { increment: number } };
    };
    expect(orderUpdateCall.data).toEqual({ status: 'FAILED', version: { increment: 1 } });
  });

  it('never permits delivery completion after a negative age result', async () => {
    const operation = {
      ...operationDelivery(DeliveryStatus.OUT_FOR_DELIVERY),
      courierId: 'courier-id',
      ageVerificationResult: AgeVerificationResult.FAILED,
    };
    const transaction = transactionBase(operation);
    const service = serviceFor(transaction);

    await expect(
      service.complete(
        'delivery-id',
        {
          expectedVersion: 4,
          ageVerificationResult: 'PASSED',
          confirmation: 'COMPLETE_DELIVERY',
        },
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'AGE_VERIFICATION_FAILURE_TERMINAL' } });
    expect(transaction.delivery.updateMany).not.toHaveBeenCalled();
    expect(transaction.deliveryAttempt.create).not.toHaveBeenCalled();
  });

  it('completes delivery from an exact independently resolved collection adjustment', async () => {
    const operation = {
      ...operationDelivery(DeliveryStatus.OUT_FOR_DELIVERY),
      courierId: 'courier-id',
      order: {
        ...operationDelivery(DeliveryStatus.OUT_FOR_DELIVERY).order,
        paymentStatus: 'CASH_COLLECTED_BY_COURIER',
      },
      cashCollections: [
        {
          id: 'collection-id',
          status: 'COLLECTED',
          expectedMillimes: 12_000,
          collectedMillimes: 11_000,
          discrepancy: {
            cashCollectionId: 'collection-id',
            status: 'RESOLVED',
            expectedMillimes: 12_000,
            actualMillimes: 11_000,
            differenceMillimes: -1_000,
          },
        },
      ],
    };
    const transaction = transactionBase(
      operation as ReturnType<typeof operationDelivery>,
      detailDelivery(DeliveryStatus.DELIVERED, true),
    );
    const service = serviceFor(transaction);

    await expect(
      service.complete(
        'delivery-id',
        {
          expectedVersion: 4,
          ageVerificationResult: 'PASSED',
          confirmation: 'COMPLETE_DELIVERY',
        },
        request,
      ),
    ).resolves.toMatchObject({ data: { status: 'DELIVERED' } });
    expect(transaction.deliveryAttempt.create).toHaveBeenCalledWith(
      containing({ data: containing({ cashCollectedMillimes: 12_000 }) }),
    );
  });

  it('keeps a written-off collection discrepancy ineligible for delivery completion', async () => {
    const operation = {
      ...operationDelivery(DeliveryStatus.OUT_FOR_DELIVERY),
      courierId: 'courier-id',
      order: {
        ...operationDelivery(DeliveryStatus.OUT_FOR_DELIVERY).order,
        paymentStatus: 'RECONCILIATION_DISCREPANCY',
      },
      cashCollections: [
        {
          id: 'collection-id',
          status: 'PARTIALLY_COLLECTED',
          expectedMillimes: 12_000,
          collectedMillimes: 11_000,
          discrepancy: {
            cashCollectionId: 'collection-id',
            status: 'WRITTEN_OFF',
            expectedMillimes: 12_000,
            actualMillimes: 11_000,
            differenceMillimes: -1_000,
          },
        },
      ],
    };
    const transaction = transactionBase(operation as ReturnType<typeof operationDelivery>);
    const service = serviceFor(transaction);

    await expect(
      service.complete(
        'delivery-id',
        {
          expectedVersion: 4,
          ageVerificationResult: 'PASSED',
          confirmation: 'COMPLETE_DELIVERY',
        },
        request,
      ),
    ).rejects.toMatchObject({
      response: { code: 'COD_COLLECTION_DISCREPANCY_UNRESOLVED' },
    });
    expect(transaction.deliveryAttempt.create).not.toHaveBeenCalled();
    expect(transaction.delivery.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale expected version before any mutation', async () => {
    const transaction = transactionBase();
    const service = serviceFor(transaction);

    await expect(
      service.transition(
        'delivery-id',
        { expectedVersion: 3, targetStatus: DeliveryStatus.READY_FOR_PICKUP },
        request,
      ),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(transaction.delivery.updateMany).not.toHaveBeenCalled();
  });
});
