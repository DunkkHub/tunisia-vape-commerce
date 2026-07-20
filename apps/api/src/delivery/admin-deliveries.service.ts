import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgeVerificationResult,
  CashCollectionStatus,
  DeliveryAttemptOutcome,
  DeliveryMethodType,
  DeliveryStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import type { Request } from 'express';
import {
  createOrderNotificationsWithOutbox,
  notificationEventForDeliveryStatus,
} from '../common/outbox/order-notifications';
import { CryptoService } from '../common/security/crypto.service';
import { PrismaService } from '../database/prisma.service';
import type {
  AssignDeliveryDto,
  CompleteDeliveryDto,
  CompleteDeliveryReturnDto,
  ReassignDeliveryDto,
  RecordDeliveryAttemptDto,
  TransitionDeliveryDto,
} from './dto/admin-delivery.dto';
import {
  ATTEMPT_OUTCOME_STATUS,
  canTransitionDelivery,
  DELIVERY_ASSIGNMENT_STATUSES,
} from './delivery-transition-policy';

const DELIVERY_DETAIL_SELECT = {
  id: true,
  orderId: true,
  status: true,
  trackingNumber: true,
  courierFeeMillimes: true,
  assignedAt: true,
  handedToCourierAt: true,
  deliveredAt: true,
  nextAttemptAt: true,
  internalNotes: true,
  customerVisibleNotes: true,
  ageVerificationRequired: true,
  ageVerificationResult: true,
  cashCollectedResult: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  courier: { select: { id: true, code: true, name: true } },
  order: {
    select: {
      orderNumber: true,
      status: true,
      paymentStatus: true,
      expectedCodMillimes: true,
    },
  },
  attempts: {
    orderBy: [{ attemptNumber: 'desc' }, { id: 'desc' }],
    take: 100,
    select: {
      id: true,
      attemptNumber: true,
      outcome: true,
      ageVerificationResult: true,
      notes: true,
      nextAttemptAt: true,
      attemptedAt: true,
    },
  },
  events: {
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      source: true,
      reasonCode: true,
      note: true,
      occurredAt: true,
    },
  },
  _count: { select: { attempts: true, events: true } },
} as const satisfies Prisma.DeliverySelect;

const DELIVERY_OPERATION_SELECT = {
  id: true,
  orderId: true,
  courierId: true,
  status: true,
  trackingNumber: true,
  courierFeeMillimes: true,
  ageVerificationRequired: true,
  ageVerificationResult: true,
  version: true,
  order: {
    select: {
      id: true,
      orderNumber: true,
      customerEmailSnapshot: true,
      customerPhoneSnapshot: true,
      customerId: true,
      status: true,
      paymentStatus: true,
      expectedCodMillimes: true,
      minimumAgeSnapshot: true,
      deliveryMethodType: true,
      version: true,
      customer: { select: { locale: true } },
    },
  },
  attempts: {
    orderBy: { attemptNumber: 'desc' },
    take: 1,
    select: { attemptNumber: true },
  },
  cashCollections: {
    select: { status: true, collectedMillimes: true },
  },
} as const satisfies Prisma.DeliverySelect;

type DeliveryDetail = Prisma.DeliveryGetPayload<{ select: typeof DELIVERY_DETAIL_SELECT }>;
type DeliveryOperation = Prisma.DeliveryGetPayload<{ select: typeof DELIVERY_OPERATION_SELECT }>;
type Transaction = Prisma.TransactionClient;

const NEGATIVE_AGE_RESULTS = [
  AgeVerificationResult.FAILED,
  AgeVerificationResult.REFUSED,
  AgeVerificationResult.UNABLE_TO_VERIFY,
] as const;

const NEGATIVE_AGE_RESULT_SET = new Set<AgeVerificationResult>(NEGATIVE_AGE_RESULTS);

const COURIER_REQUIRED_TARGETS = new Set<DeliveryStatus>([
  DeliveryStatus.ASSIGNED_TO_COURIER,
  DeliveryStatus.HANDED_TO_COURIER,
]);

const EXPLANATION_REQUIRED_TARGETS = new Set<DeliveryStatus>([
  DeliveryStatus.ON_HOLD,
  DeliveryStatus.RETURN_TO_SENDER,
]);

const COLLECTED_CASH_STATUSES = new Set<CashCollectionStatus>([
  CashCollectionStatus.COLLECTED,
  CashCollectionStatus.REMITTED,
]);

const CASH_PAYMENT_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.CASH_COLLECTED_BY_COURIER,
  PaymentStatus.CASH_COLLECTED_AT_STORE,
  PaymentStatus.CASH_REMITTED,
]);

@Injectable()
export class AdminDeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async listCouriers() {
    const couriers = await this.prisma.courier.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true, code: true, name: true },
    });
    return { data: couriers };
  }

  async get(id: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id },
      select: DELIVERY_DETAIL_SELECT,
    });
    if (!delivery) throw this.notFound();
    return { data: this.serialize(delivery) };
  }

  assign(id: string, input: AssignDeliveryDto, request: Request) {
    return this.assignment('assign', id, input, request);
  }

  reassign(id: string, input: ReassignDeliveryDto, request: Request) {
    return this.assignment('reassign', id, input, request);
  }

  private async assignment(
    action: 'assign' | 'reassign',
    id: string,
    input: AssignDeliveryDto | ReassignDeliveryDto,
    request: Request,
  ) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const delivery = await this.lockDelivery(transaction, id);
        this.assertVersion(delivery, input.expectedVersion);
        if (delivery.order.deliveryMethodType !== DeliveryMethodType.COURIER) {
          throw this.stateConflict('COURIER_ASSIGNMENT_NOT_APPLICABLE');
        }
        if (
          !DELIVERY_ASSIGNMENT_STATUSES.has(delivery.status) ||
          delivery.order.status !== delivery.status
        ) {
          throw this.stateConflict('COURIER_ASSIGNMENT_NOT_ALLOWED');
        }
        if (action === 'assign' && delivery.courierId) {
          throw this.stateConflict('DELIVERY_ALREADY_ASSIGNED');
        }
        if (action === 'reassign') {
          if (!delivery.courierId) throw this.stateConflict('DELIVERY_NOT_ASSIGNED');
          if (delivery.courierId === input.courierId) {
            throw this.stateConflict('DELIVERY_COURIER_UNCHANGED');
          }
          this.requireExplanation(
            (input as ReassignDeliveryDto).reason,
            'REASSIGNMENT_REASON_REQUIRED',
          );
        }

        await transaction.$queryRaw(
          Prisma.sql`SELECT id FROM Courier WHERE id = ${input.courierId} FOR UPDATE`,
        );
        const courier = await transaction.courier.findFirst({
          where: { id: input.courierId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!courier) {
          throw this.conflict('COURIER_UNAVAILABLE', 'The selected courier is unavailable.');
        }

        const now = new Date();
        const updated = await transaction.delivery.updateMany({
          where: { id: delivery.id, version: input.expectedVersion },
          data: {
            courierId: courier.id,
            assignedAt: now,
            ...(input.trackingNumber !== undefined
              ? { trackingNumber: input.trackingNumber.trim() }
              : {}),
            ...(input.courierFeeMillimes !== undefined
              ? { courierFeeMillimes: input.courierFeeMillimes }
              : {}),
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw this.versionConflict();
        const note =
          action === 'reassign' ? (input as ReassignDeliveryDto).reason.trim() : input.note?.trim();
        await Promise.all([
          transaction.deliveryEvent.create({
            data: {
              deliveryId: delivery.id,
              fromStatus: delivery.status,
              toStatus: delivery.status,
              actorUserId: request.auth!.userId,
              source: 'MANUAL_ADMIN',
              reasonCode: action === 'assign' ? 'COURIER_ASSIGNED' : 'COURIER_REASSIGNED',
              note: note ?? null,
              payload: {
                previousCourierId: delivery.courierId,
                courierId: courier.id,
              },
              requestId: request.requestId,
            },
          }),
          this.audit(transaction, request, delivery, `delivery.courier.${action}ed`, {
            before: {
              courierId: delivery.courierId,
              status: delivery.status,
              version: delivery.version,
            },
            after: {
              courierId: courier.id,
              status: delivery.status,
              version: delivery.version + 1,
            },
          }),
        ]);
        return { data: this.serialize(await this.requireDetail(transaction, delivery.id)) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.conflict(
          'TRACKING_NUMBER_CONFLICT',
          'The tracking number is already assigned to another delivery.',
        );
      }
      throw error;
    }
  }

  async transition(id: string, input: TransitionDeliveryDto, request: Request) {
    return this.prisma.$transaction(async (transaction) => {
      const delivery = await this.lockDelivery(transaction, id);
      this.assertVersion(delivery, input.expectedVersion);
      if (
        !canTransitionDelivery(delivery.status, input.targetStatus) ||
        delivery.order.status !== delivery.status
      ) {
        throw this.stateConflict('DELIVERY_TRANSITION_NOT_ALLOWED');
      }
      if (COURIER_REQUIRED_TARGETS.has(input.targetStatus) && !delivery.courierId) {
        throw this.stateConflict('DELIVERY_COURIER_REQUIRED');
      }
      if (EXPLANATION_REQUIRED_TARGETS.has(input.targetStatus)) {
        this.requireExplanation(input.explanation, 'DELIVERY_EXPLANATION_REQUIRED');
      }
      const now = new Date();
      await this.updateMirroredStatus(transaction, delivery, input.targetStatus, {
        ...(input.targetStatus === DeliveryStatus.HANDED_TO_COURIER
          ? { handedToCourierAt: now }
          : {}),
        ...(input.targetStatus === DeliveryStatus.OUT_FOR_DELIVERY ? { nextAttemptAt: null } : {}),
      });
      await this.recordTransition(transaction, request, delivery, input.targetStatus, {
        reasonCode: input.reasonCode?.trim() || 'MANUAL_TRANSITION',
        note: input.explanation?.trim() ?? null,
        action: 'delivery.status.changed',
      });
      return { data: this.serialize(await this.requireDetail(transaction, delivery.id)) };
    });
  }

  async recordAttempt(id: string, input: RecordDeliveryAttemptDto, request: Request) {
    return this.prisma.$transaction(async (transaction) => {
      const delivery = await this.lockDelivery(transaction, id);
      this.assertVersion(delivery, input.expectedVersion);
      if (
        delivery.status !== DeliveryStatus.OUT_FOR_DELIVERY ||
        delivery.order.status !== OrderStatus.OUT_FOR_DELIVERY
      ) {
        throw this.stateConflict('DELIVERY_ATTEMPT_NOT_ALLOWED');
      }
      if (input.outcome === DeliveryAttemptOutcome.OTHER_FAILED) {
        this.requireExplanation(input.explanation, 'OTHER_FAILURE_EXPLANATION_REQUIRED');
      }
      const now = new Date();
      let nextAttemptAt: Date | null = null;
      if (input.outcome === DeliveryAttemptOutcome.RESCHEDULED) {
        if (!input.nextAttemptAt) {
          throw this.badRequest(
            'NEXT_ATTEMPT_REQUIRED',
            'A future next-attempt time is required for rescheduling.',
          );
        }
        nextAttemptAt = new Date(input.nextAttemptAt);
        if (nextAttemptAt.getTime() <= now.getTime()) {
          throw this.badRequest(
            'NEXT_ATTEMPT_INVALID',
            'The next-attempt time must be in the future.',
          );
        }
      } else if (input.nextAttemptAt) {
        throw this.badRequest(
          'NEXT_ATTEMPT_NOT_APPLICABLE',
          'A next-attempt time is accepted only for a rescheduled attempt.',
        );
      }
      const target = ATTEMPT_OUTCOME_STATUS[input.outcome];
      if (!canTransitionDelivery(delivery.status, target)) {
        throw this.stateConflict('DELIVERY_ATTEMPT_OUTCOME_NOT_ALLOWED');
      }
      const ageResult =
        input.outcome === DeliveryAttemptOutcome.FAILED_AGE_VERIFICATION
          ? AgeVerificationResult.FAILED
          : delivery.ageVerificationResult;
      const attemptNumber = (delivery.attempts[0]?.attemptNumber ?? 0) + 1;

      await transaction.deliveryAttempt.create({
        data: {
          deliveryId: delivery.id,
          attemptNumber,
          attemptedAt: now,
          outcome: input.outcome,
          notes: input.explanation?.trim() ?? null,
          nextAttemptAt,
          ageVerificationResult: ageResult,
          cashExpectedMillimes: delivery.order.expectedCodMillimes,
          recordedByUserId: request.auth!.userId,
        },
      });
      if (input.outcome === DeliveryAttemptOutcome.FAILED_AGE_VERIFICATION) {
        await transaction.ageVerificationEvent.create({
          data: {
            customerId: delivery.order.customerId,
            orderId: delivery.order.id,
            deliveryId: delivery.id,
            phase: 'DELIVERY',
            result: 'FAILED',
            minimumAge: delivery.order.minimumAgeSnapshot,
            method: 'MANUAL_ADMIN',
            reasonCode: 'FAILED_AGE_VERIFICATION',
            verifierUserId: request.auth!.userId,
          },
        });
      }
      await this.updateMirroredStatus(transaction, delivery, target, {
        nextAttemptAt,
        ageVerificationResult: ageResult,
      });
      await this.recordTransition(transaction, request, delivery, target, {
        reasonCode: input.outcome,
        note: input.explanation?.trim() ?? null,
        action: 'delivery.attempt.recorded',
      });
      return { data: this.serialize(await this.requireDetail(transaction, delivery.id)) };
    });
  }

  async complete(id: string, input: CompleteDeliveryDto, request: Request) {
    return this.prisma.$transaction(async (transaction) => {
      const delivery = await this.lockDelivery(transaction, id);
      this.assertVersion(delivery, input.expectedVersion);
      const expectedSourceStatus =
        delivery.order.deliveryMethodType === DeliveryMethodType.STORE_PICKUP
          ? DeliveryStatus.READY_FOR_PICKUP
          : DeliveryStatus.OUT_FOR_DELIVERY;
      if (
        delivery.status !== expectedSourceStatus ||
        delivery.order.status !== expectedSourceStatus ||
        !canTransitionDelivery(delivery.status, DeliveryStatus.DELIVERED)
      ) {
        throw this.stateConflict('DELIVERY_COMPLETION_NOT_ALLOWED');
      }
      if (delivery.order.deliveryMethodType === DeliveryMethodType.COURIER && !delivery.courierId) {
        throw this.stateConflict('DELIVERY_COURIER_REQUIRED');
      }
      if (
        (delivery.ageVerificationRequired &&
          input.ageVerificationResult !== AgeVerificationResult.PASSED) ||
        (!delivery.ageVerificationRequired &&
          input.ageVerificationResult !== AgeVerificationResult.NOT_REQUIRED)
      ) {
        throw this.conflict(
          'AGE_VERIFICATION_RESULT_INVALID',
          'The age-verification result does not satisfy this delivery requirement.',
        );
      }
      if (NEGATIVE_AGE_RESULT_SET.has(delivery.ageVerificationResult)) {
        throw this.conflict(
          'AGE_VERIFICATION_FAILURE_TERMINAL',
          'A failed age-verification delivery cannot be completed.',
        );
      }
      const negativeEvidence = await Promise.all([
        transaction.deliveryAttempt.count({
          where: { deliveryId: delivery.id, outcome: 'FAILED_AGE_VERIFICATION' },
        }),
        transaction.ageVerificationEvent.count({
          where: {
            deliveryId: delivery.id,
            phase: 'DELIVERY',
            result: { in: [...NEGATIVE_AGE_RESULTS] },
          },
        }),
      ]);
      if (negativeEvidence.some((count) => count > 0)) {
        throw this.conflict(
          'AGE_VERIFICATION_FAILURE_TERMINAL',
          'A failed age-verification delivery cannot be completed.',
        );
      }
      const collectedMillimes = delivery.cashCollections
        .filter(({ status }) => COLLECTED_CASH_STATUSES.has(status))
        .reduce((total, collection) => total + collection.collectedMillimes, 0);
      if (
        delivery.order.expectedCodMillimes > 0 &&
        (collectedMillimes !== delivery.order.expectedCodMillimes ||
          !CASH_PAYMENT_STATUSES.has(delivery.order.paymentStatus))
      ) {
        throw this.conflict(
          'COD_COLLECTION_REQUIRED',
          'The exact cash collection must be durably recorded before delivery completion.',
        );
      }

      const now = new Date();
      const attemptNumber = (delivery.attempts[0]?.attemptNumber ?? 0) + 1;
      await Promise.all([
        transaction.deliveryAttempt.create({
          data: {
            deliveryId: delivery.id,
            attemptNumber,
            attemptedAt: now,
            outcome: 'DELIVERED',
            ageVerificationResult: input.ageVerificationResult,
            cashExpectedMillimes: delivery.order.expectedCodMillimes,
            cashCollectedMillimes: collectedMillimes,
            recordedByUserId: request.auth!.userId,
          },
        }),
        transaction.ageVerificationEvent.create({
          data: {
            customerId: delivery.order.customerId,
            orderId: delivery.order.id,
            deliveryId: delivery.id,
            phase: 'DELIVERY',
            result: input.ageVerificationResult,
            minimumAge: delivery.order.minimumAgeSnapshot,
            method: 'MANUAL_ADMIN',
            verifierUserId: request.auth!.userId,
          },
        }),
      ]);
      await this.updateMirroredStatus(transaction, delivery, DeliveryStatus.DELIVERED, {
        deliveredAt: now,
        ageVerificationResult: input.ageVerificationResult,
        cashCollectedResult: delivery.order.expectedCodMillimes > 0 ? true : null,
        nextAttemptAt: null,
      });
      await this.recordTransition(transaction, request, delivery, DeliveryStatus.DELIVERED, {
        reasonCode: 'MANUAL_DELIVERY_COMPLETED',
        note: null,
        action: 'delivery.completed',
      });
      return { data: this.serialize(await this.requireDetail(transaction, delivery.id)) };
    });
  }

  async completeReturn(id: string, input: CompleteDeliveryReturnDto, request: Request) {
    return this.prisma.$transaction(async (transaction) => {
      const delivery = await this.lockDelivery(transaction, id);
      this.assertVersion(delivery, input.expectedVersion);
      this.requireExplanation(input.reason, 'RETURN_EXPLANATION_REQUIRED');
      if (
        delivery.status !== DeliveryStatus.RETURN_TO_SENDER ||
        delivery.order.status !== OrderStatus.RETURN_TO_SENDER ||
        !canTransitionDelivery(delivery.status, DeliveryStatus.RETURNED)
      ) {
        throw this.stateConflict('DELIVERY_RETURN_COMPLETION_NOT_ALLOWED');
      }
      await this.updateMirroredStatus(transaction, delivery, DeliveryStatus.RETURNED, {});
      await this.recordTransition(transaction, request, delivery, DeliveryStatus.RETURNED, {
        reasonCode: 'RETURN_RECEIVED',
        note: input.reason.trim(),
        action: 'delivery.return.completed',
      });
      return { data: this.serialize(await this.requireDetail(transaction, delivery.id)) };
    });
  }

  private async lockDelivery(transaction: Transaction, id: string): Promise<DeliveryOperation> {
    const reference = await transaction.delivery.findUnique({
      where: { id },
      select: { orderId: true },
    });
    if (!reference) throw this.notFound();
    await transaction.$queryRaw(
      Prisma.sql`SELECT id FROM \`Order\` WHERE id = ${reference.orderId} FOR UPDATE`,
    );
    const locked = await transaction.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM Delivery WHERE id = ${id} FOR UPDATE`,
    );
    if (locked.length !== 1) throw this.notFound();
    const delivery = await transaction.delivery.findUnique({
      where: { id },
      select: DELIVERY_OPERATION_SELECT,
    });
    if (!delivery) throw this.notFound();
    return delivery;
  }

  private async updateMirroredStatus(
    transaction: Transaction,
    delivery: DeliveryOperation,
    target: DeliveryStatus,
    deliveryData: Prisma.DeliveryUpdateManyMutationInput,
  ): Promise<void> {
    const [deliveryUpdated, orderUpdated] = await Promise.all([
      transaction.delivery.updateMany({
        where: { id: delivery.id, status: delivery.status, version: delivery.version },
        data: { ...deliveryData, status: target, version: { increment: 1 } },
      }),
      transaction.order.updateMany({
        where: {
          id: delivery.order.id,
          status: delivery.order.status,
          version: delivery.order.version,
        },
        data: { status: target, version: { increment: 1 } },
      }),
    ]);
    if (deliveryUpdated.count !== 1 || orderUpdated.count !== 1) throw this.versionConflict();
  }

  private async recordTransition(
    transaction: Transaction,
    request: Request,
    delivery: DeliveryOperation,
    target: DeliveryStatus,
    input: { reasonCode: string; note: string | null; action: string },
  ): Promise<void> {
    const events: Promise<unknown>[] = [
      transaction.deliveryEvent.create({
        data: {
          deliveryId: delivery.id,
          fromStatus: delivery.status,
          toStatus: target,
          actorUserId: request.auth!.userId,
          source: 'MANUAL_ADMIN',
          reasonCode: input.reasonCode,
          note: input.note,
          requestId: request.requestId,
        },
      }),
      transaction.orderStatusHistory.create({
        data: {
          orderId: delivery.order.id,
          fromStatus: delivery.order.status,
          toStatus: target,
          reasonCode: input.reasonCode,
          note: input.note,
          changedByUserId: request.auth!.userId,
          requestId: request.requestId,
        },
      }),
      this.audit(transaction, request, delivery, input.action, {
        before: { status: delivery.status, version: delivery.version },
        after: { status: target, version: delivery.version + 1 },
      }),
    ];
    const notificationEvent = notificationEventForDeliveryStatus(target);
    if (notificationEvent) {
      events.push(
        createOrderNotificationsWithOutbox(transaction, this.crypto, {
          order: {
            id: delivery.order.id,
            orderNumber: delivery.order.orderNumber,
            customerEmailSnapshot: delivery.order.customerEmailSnapshot,
            customerPhoneSnapshot: delivery.order.customerPhoneSnapshot,
            locale: delivery.order.customer?.locale === 'ar' ? 'ar-TN' : 'fr-TN',
          },
          event: notificationEvent,
          scheduledAt: new Date(),
          idempotencyDiscriminator: `delivery:${target.toLocaleLowerCase('en-US')}:v${delivery.order.version + 1}`,
        }),
      );
    }
    await Promise.all(events);
  }

  private audit(
    transaction: Transaction,
    request: Request,
    delivery: DeliveryOperation,
    action: string,
    summary: { before: Prisma.InputJsonValue; after: Prisma.InputJsonValue },
  ) {
    return transaction.auditLog.create({
      data: {
        actorUserId: request.auth!.userId,
        actorType: 'ADMIN',
        action,
        resourceType: 'Delivery',
        resourceId: delivery.id,
        outcome: 'SUCCESS',
        requestId: request.requestId,
        ipAddress: (request.ip ?? request.socket.remoteAddress ?? 'unknown').slice(0, 45),
        userAgent: request.get('user-agent')?.slice(0, 512) ?? null,
        beforeSummary: summary.before,
        afterSummary: summary.after,
      },
    });
  }

  private async requireDetail(transaction: Transaction, id: string): Promise<DeliveryDetail> {
    const delivery = await transaction.delivery.findUnique({
      where: { id },
      select: DELIVERY_DETAIL_SELECT,
    });
    if (!delivery) throw this.notFound();
    return delivery;
  }

  private serialize(delivery: DeliveryDetail) {
    return {
      id: delivery.id,
      orderId: delivery.orderId,
      orderNumber: delivery.order.orderNumber,
      orderStatus: delivery.order.status,
      paymentStatus: delivery.order.paymentStatus,
      expectedCodMillimes: delivery.order.expectedCodMillimes,
      status: delivery.status,
      courier: delivery.courier,
      trackingNumber: delivery.trackingNumber,
      courierFeeMillimes: delivery.courierFeeMillimes,
      assignedAt: delivery.assignedAt?.toISOString() ?? null,
      handedToCourierAt: delivery.handedToCourierAt?.toISOString() ?? null,
      deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
      nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
      internalNotes: delivery.internalNotes,
      customerVisibleNotes: delivery.customerVisibleNotes,
      ageVerificationRequired: delivery.ageVerificationRequired,
      ageVerificationResult: delivery.ageVerificationResult,
      cashCollectedResult: delivery.cashCollectedResult,
      version: delivery.version,
      attempts: [...delivery.attempts].reverse().map((attempt) => ({
        ...attempt,
        attemptedAt: attempt.attemptedAt.toISOString(),
        nextAttemptAt: attempt.nextAttemptAt?.toISOString() ?? null,
      })),
      events: [...delivery.events].reverse().map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
      })),
      historyTruncated:
        delivery._count.attempts > delivery.attempts.length ||
        delivery._count.events > delivery.events.length,
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
    };
  }

  private assertVersion(delivery: DeliveryOperation, expectedVersion: number): void {
    if (delivery.version !== expectedVersion) throw this.versionConflict();
  }

  private requireExplanation(value: string | undefined, code: string): void {
    if (!value || value.trim().length < 4) {
      throw this.badRequest(code, 'A meaningful explanation is required for this action.');
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'DELIVERY_NOT_FOUND',
      message: 'The delivery was not found.',
    });
  }

  private versionConflict(): ConflictException {
    return this.conflict('VERSION_CONFLICT', 'The delivery has changed. Refresh and try again.');
  }

  private stateConflict(code: string): ConflictException {
    return this.conflict(code, 'The delivery cannot perform that action from its current state.');
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }

  private badRequest(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message });
  }
}
