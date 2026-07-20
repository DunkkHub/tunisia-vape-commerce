import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { WorkerEnvironment } from './environment.js';
import {
  ConfiguredMediaDeletionAdapter,
  type MediaDeletionAdapter,
  type MediaObjectDeletion,
} from './media-deletion-adapter.js';
import {
  ProviderNeutralNotificationAdapter,
  type NotificationAdapter,
  type NotificationDeliveryResult,
  type PreparedNotificationMessage,
} from './notification-adapter.js';
import { decryptNotificationField } from './notification-crypto.js';
import {
  renderNotificationContent,
  validateNotificationRecipient,
  type DeliverableNotificationChannel,
} from './notification-templates.js';
import {
  OUTBOX_EVENT_TYPES,
  WorkerDomainError,
  exponentialRetryDelay,
  parseEventPayload,
  parseStoredJson,
  safeErrorCode,
} from './outbox-contracts.js';
import type { OutboxRepository } from './outbox-repository.js';

interface OutboxJobData {
  outboxEventId: string;
  eventType: string;
  eventVersion: number;
}

interface LockedEventRow {
  id: string;
  deterministicKey: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  payload: Prisma.JsonValue;
  status: string;
  attemptCount: number;
  maxAttempts: number;
}

interface LockedReservationRow {
  id: string;
  inventoryItemId: string;
}

interface ProcessingResult {
  outcome: 'PROCESSED' | 'ALREADY_PROCESSED' | 'TERMINAL';
  eventType: string;
  affectedCount: number;
}

interface NotificationWork {
  outboxEventId: string;
  notificationId: string;
  attemptId: string;
  attemptNumber: number;
  provider: string;
  channel: DeliverableNotificationChannel;
  event: string;
  locale: string;
  encryptedRecipient: string;
  payload: Prisma.JsonValue;
  idempotencyKey: string;
}

type NotificationClaimResult =
  | { outcome: 'SEND'; work: NotificationWork }
  | {
      outcome: 'ALREADY_PROCESSED' | 'SKIPPED_DISABLED' | 'TERMINAL';
      eventType: string;
    };

type MediaDeletionClaimResult =
  | { outcome: 'DELETE'; eventType: string; work: MediaObjectDeletion }
  | { outcome: 'ALREADY_PROCESSED' | 'TERMINAL'; eventType: string };

export class OutboxProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: OutboxRepository,
    private readonly environment: WorkerEnvironment,
    private readonly logger: Logger,
    private readonly notificationAdapter: NotificationAdapter = new ProviderNeutralNotificationAdapter(
      environment,
    ),
    private readonly mediaDeletionAdapter: MediaDeletionAdapter = new ConfiguredMediaDeletionAdapter(
      environment,
    ),
  ) {}

  async process(job: OutboxJobData): Promise<void> {
    if (job.eventType === OUTBOX_EVENT_TYPES.NOTIFICATION_DISPATCH) {
      await this.processNotification(job);
      return;
    }
    if (job.eventType === OUTBOX_EVENT_TYPES.MEDIA_OBJECT_DELETE) {
      await this.processMediaDeletion(job);
      return;
    }
    try {
      const result = await this.prisma.$transaction(
        (transaction) => this.processTransaction(transaction, job),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 5_000,
          timeout: 15_000,
        },
      );
      this.logger.info(
        {
          outboxEventId: job.outboxEventId,
          eventType: result.eventType,
          outcome: result.outcome,
          affectedCount: result.affectedCount,
        },
        'Outbox event handled',
      );
    } catch (error) {
      const errorCode = safeErrorCode(error);
      const state = await this.repository.scheduleRetry(job.outboxEventId, errorCode);
      this.logger.warn(
        {
          outboxEventId: job.outboxEventId,
          eventType: job.eventType,
          errorCode,
          state,
        },
        'Outbox event deferred',
      );
    }
  }

  private async processMediaDeletion(job: OutboxJobData): Promise<void> {
    let claim: MediaDeletionClaimResult;
    try {
      claim = await this.prisma.$transaction(
        (transaction) => this.claimMediaDeletion(transaction, job),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 5_000,
          timeout: 10_000,
        },
      );
    } catch (error) {
      await this.deferMediaDeletion(job, error, 'Media cleanup claim deferred');
      return;
    }
    if (claim.outcome !== 'DELETE') {
      this.logger.info(
        {
          outboxEventId: job.outboxEventId,
          eventType: claim.eventType,
          outcome: claim.outcome,
          affectedCount: 0,
        },
        'Outbox event handled',
      );
      return;
    }
    try {
      await this.mediaDeletionAdapter.deleteObject(claim.work);
      await this.completeMediaDeletion(job);
      this.logger.info(
        {
          outboxEventId: job.outboxEventId,
          eventType: job.eventType,
          outcome: 'PROCESSED',
          affectedCount: 1,
        },
        'Media object cleanup completed',
      );
    } catch (error) {
      await this.deferMediaDeletion(job, error, 'Media object cleanup deferred');
    }
  }

  private async claimMediaDeletion(
    transaction: Prisma.TransactionClient,
    job: OutboxJobData,
  ): Promise<MediaDeletionClaimResult> {
    const rows = await transaction.$queryRaw<LockedEventRow[]>(Prisma.sql`
      SELECT
        \`id\`, \`deterministicKey\`, \`aggregateType\`, \`aggregateId\`, \`eventType\`,
        \`eventVersion\`, \`payload\`, \`status\`, \`attemptCount\`, \`maxAttempts\`
      FROM \`OutboxEvent\`
      WHERE \`id\` = ${job.outboxEventId}
      FOR UPDATE
    `);
    const event = rows[0];
    if (!event) throw new WorkerDomainError('OUTBOX_EVENT_MISSING');
    if (event.status === 'PROCESSED') {
      return { outcome: 'ALREADY_PROCESSED', eventType: event.eventType };
    }
    if (['DEAD_LETTER', 'CANCELLED'].includes(event.status)) {
      return { outcome: 'TERMINAL', eventType: event.eventType };
    }
    if (event.eventType !== job.eventType || event.eventVersion !== job.eventVersion) {
      throw new WorkerDomainError('OUTBOX_JOB_MISMATCH');
    }
    const parsed = parseEventPayload(
      event.eventType,
      event.eventVersion,
      parseStoredJson(event.payload),
    );
    if (parsed.eventType !== OUTBOX_EVENT_TYPES.MEDIA_OBJECT_DELETE) {
      throw new WorkerDomainError('OUTBOX_HANDLER_ROUTE_MISMATCH');
    }
    if (
      event.aggregateType !== 'ProductImage' ||
      event.deterministicKey !== `media-object-delete:v1:${event.aggregateId}`
    ) {
      throw new WorkerDomainError('OUTBOX_MEDIA_AGGREGATE_MISMATCH');
    }
    await transaction.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: 'PROCESSING',
        leaseOwner: this.environment.WORKER_INSTANCE_ID,
        leaseExpiresAt: new Date(Date.now() + this.environment.OUTBOX_LEASE_MS),
      },
    });
    return { outcome: 'DELETE', eventType: event.eventType, work: parsed.payload };
  }

  private async completeMediaDeletion(job: OutboxJobData): Promise<void> {
    await this.prisma.$transaction(
      async (transaction) => {
        const rows = await transaction.$queryRaw<
          Array<{ status: string; eventType: string; eventVersion: number }>
        >(
          Prisma.sql`
            SELECT \`status\`, \`eventType\`, \`eventVersion\`
            FROM \`OutboxEvent\`
            WHERE \`id\` = ${job.outboxEventId}
            FOR UPDATE
          `,
        );
        const event = rows[0];
        if (!event) throw new WorkerDomainError('OUTBOX_EVENT_MISSING');
        if (event.status === 'PROCESSED') return;
        if (event.eventType !== job.eventType || event.eventVersion !== job.eventVersion) {
          throw new WorkerDomainError('OUTBOX_JOB_MISMATCH');
        }
        await transaction.outboxEvent.update({
          where: { id: job.outboxEventId },
          data: {
            status: 'PROCESSED',
            processedAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
            safeErrorCode: null,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  }

  private async deferMediaDeletion(
    job: OutboxJobData,
    error: unknown,
    message: string,
  ): Promise<void> {
    const errorCode = safeErrorCode(error);
    const state = await this.repository.scheduleRetry(job.outboxEventId, errorCode);
    this.logger.warn(
      { outboxEventId: job.outboxEventId, eventType: job.eventType, errorCode, state },
      message,
    );
  }

  private async processTransaction(
    transaction: Prisma.TransactionClient,
    job: OutboxJobData,
  ): Promise<ProcessingResult> {
    const rows = await transaction.$queryRaw<LockedEventRow[]>(Prisma.sql`
      SELECT
        \`id\`,
        \`deterministicKey\`,
        \`aggregateType\`,
        \`aggregateId\`,
        \`eventType\`,
        \`eventVersion\`,
        \`payload\`,
        \`status\`,
        \`attemptCount\`,
        \`maxAttempts\`
      FROM \`OutboxEvent\`
      WHERE \`id\` = ${job.outboxEventId}
      FOR UPDATE
    `);
    const event = rows[0];
    if (!event) throw new WorkerDomainError('OUTBOX_EVENT_MISSING');
    if (event.status === 'PROCESSED') {
      return {
        outcome: 'ALREADY_PROCESSED',
        eventType: event.eventType,
        affectedCount: 0,
      };
    }
    if (['DEAD_LETTER', 'CANCELLED'].includes(event.status)) {
      return { outcome: 'TERMINAL', eventType: event.eventType, affectedCount: 0 };
    }
    if (event.eventType !== job.eventType || event.eventVersion !== job.eventVersion) {
      throw new WorkerDomainError('OUTBOX_JOB_MISMATCH');
    }
    const parsed = parseEventPayload(
      event.eventType,
      event.eventVersion,
      parseStoredJson(event.payload),
    );
    await transaction.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: 'PROCESSING',
        leaseOwner: this.environment.WORKER_INSTANCE_ID,
        leaseExpiresAt: new Date(Date.now() + this.environment.OUTBOX_LEASE_MS),
      },
    });

    let affectedCount = 0;
    switch (parsed.eventType) {
      case OUTBOX_EVENT_TYPES.RESERVATION_EXPIRY:
        affectedCount = await this.expireReservations(
          transaction,
          event.id,
          parsed.payload.cutoff,
          parsed.payload.batchSize,
        );
        break;
      case OUTBOX_EVENT_TYPES.NOTIFICATION_DISPATCH:
        throw new WorkerDomainError('OUTBOX_HANDLER_ROUTE_MISMATCH');
    }

    await transaction.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        safeErrorCode: null,
      },
    });
    return {
      outcome: 'PROCESSED',
      eventType: event.eventType,
      affectedCount,
    };
  }

  private async expireReservations(
    transaction: Prisma.TransactionClient,
    outboxEventId: string,
    cutoffValue: string,
    batchSize: number,
  ): Promise<number> {
    const cutoff = new Date(cutoffValue);
    if (!Number.isFinite(cutoff.getTime()) || cutoff.getTime() > Date.now() + 5_000) {
      throw new WorkerDomainError('RESERVATION_CUTOFF_INVALID');
    }
    const locked = await transaction.$queryRaw<LockedReservationRow[]>(Prisma.sql`
      SELECT \`id\`, \`inventoryItemId\`
      FROM \`StockReservation\`
      WHERE \`state\` = ${'ACTIVE'} AND \`expiresAt\` <= ${cutoff}
      ORDER BY \`inventoryItemId\` ASC, \`id\` ASC
      LIMIT ${batchSize}
      FOR UPDATE
    `);
    if (locked.length === 0) return 0;
    const inventoryIds = [...new Set(locked.map((row) => row.inventoryItemId))].sort();
    await transaction.$queryRaw(Prisma.sql`
      SELECT \`id\`
      FROM \`InventoryItem\`
      WHERE \`id\` IN (${Prisma.join(inventoryIds)})
      ORDER BY \`id\` ASC
      FOR UPDATE
    `);
    const [reservations, inventoryItems] = await Promise.all([
      transaction.stockReservation.findMany({
        where: {
          id: { in: locked.map((row) => row.id) },
          state: 'ACTIVE',
          expiresAt: { lte: cutoff },
        },
        orderBy: [{ inventoryItemId: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          inventoryItemId: true,
          sourceType: true,
          sourceId: true,
          orderId: true,
          quantity: true,
          expiresAt: true,
        },
      }),
      transaction.inventoryItem.findMany({
        where: { id: { in: inventoryIds } },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          locationId: true,
          batchId: true,
          onHandQuantity: true,
        },
      }),
    ]);
    if (inventoryItems.length !== inventoryIds.length) {
      throw new WorkerDomainError('INVENTORY_ITEM_MISSING');
    }
    const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));
    const releasedAt = new Date();
    let releasedCount = 0;
    for (const reservation of reservations) {
      const inventory = inventoryById.get(reservation.inventoryItemId);
      if (!inventory || reservation.quantity <= 0 || reservation.expiresAt > cutoff) {
        throw new WorkerDomainError('RESERVATION_INVARIANT_BREACH');
      }
      const updated = await transaction.stockReservation.updateMany({
        where: { id: reservation.id, state: 'ACTIVE', expiresAt: { lte: cutoff } },
        data: {
          state: 'EXPIRED',
          activeKey: null,
          releasedAt,
          releaseReason: 'RESERVATION_EXPIRED',
        },
      });
      if (updated.count !== 1) continue;
      await transaction.stockMovement.create({
        data: {
          inventoryItemId: inventory.id,
          locationId: inventory.locationId,
          batchId: inventory.batchId,
          type: 'RESERVATION_RELEASE',
          quantityDelta: 0,
          onHandAfter: inventory.onHandQuantity,
          referenceType: reservation.orderId ? 'ORDER' : reservation.sourceType,
          referenceId: reservation.orderId ?? reservation.sourceId,
          reasonCode: 'RESERVATION_EXPIRED',
          requestId: `outbox:${outboxEventId}`,
          occurredAt: releasedAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'inventory.reservation.expired',
          resourceType: 'StockReservation',
          resourceId: reservation.id,
          outcome: 'SUCCESS',
          requestId: `outbox:${outboxEventId}`,
          beforeSummary: {
            state: 'ACTIVE',
            quantity: reservation.quantity,
            inventoryItemId: reservation.inventoryItemId,
          },
          afterSummary: {
            state: 'EXPIRED',
            physicalQuantityDelta: 0,
          },
          occurredAt: releasedAt,
        },
      });
      releasedCount += 1;
    }
    return releasedCount;
  }

  private async processNotification(job: OutboxJobData): Promise<void> {
    let claim: NotificationClaimResult;
    try {
      claim = await this.prisma.$transaction(
        (transaction) => this.claimNotification(transaction, job),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 5_000,
          timeout: 10_000,
        },
      );
    } catch (error) {
      const errorCode = safeErrorCode(error);
      const state = await this.repository.scheduleRetry(job.outboxEventId, errorCode);
      this.logger.warn(
        { outboxEventId: job.outboxEventId, eventType: job.eventType, errorCode, state },
        'Notification claim deferred',
      );
      return;
    }

    if (claim.outcome !== 'SEND') {
      this.logger.info(
        {
          outboxEventId: job.outboxEventId,
          eventType: claim.eventType,
          outcome: claim.outcome,
          affectedCount: 0,
        },
        'Outbox event handled',
      );
      return;
    }

    const { work } = claim;
    try {
      const message = this.prepareNotification(work);
      const delivery = await this.notificationAdapter.send(message);
      await this.finalizeNotificationSuccess(work, delivery);
      this.logger.info(
        {
          outboxEventId: work.outboxEventId,
          notificationId: work.notificationId,
          attemptNumber: work.attemptNumber,
          channel: work.channel,
          event: work.event,
          provider: delivery.provider,
          outcome: 'DELIVERED',
        },
        'Notification delivered',
      );
    } catch (error) {
      const errorCode = safeErrorCode(error);
      try {
        const state = await this.finalizeNotificationFailure(work, errorCode);
        this.logger.warn(
          {
            outboxEventId: work.outboxEventId,
            notificationId: work.notificationId,
            attemptNumber: work.attemptNumber,
            channel: work.channel,
            event: work.event,
            provider: work.provider,
            errorCode,
            state,
          },
          'Notification delivery deferred',
        );
      } catch (persistenceError) {
        const persistenceCode = safeErrorCode(persistenceError);
        const state = await this.repository.scheduleRetry(work.outboxEventId, persistenceCode);
        this.logger.error(
          {
            outboxEventId: work.outboxEventId,
            notificationId: work.notificationId,
            attemptNumber: work.attemptNumber,
            errorCode: persistenceCode,
            state,
          },
          'Notification result persistence failed',
        );
      }
    }
  }

  private async claimNotification(
    transaction: Prisma.TransactionClient,
    job: OutboxJobData,
  ): Promise<NotificationClaimResult> {
    const rows = await transaction.$queryRaw<LockedEventRow[]>(Prisma.sql`
      SELECT
        \`id\`,
        \`deterministicKey\`,
        \`aggregateType\`,
        \`aggregateId\`,
        \`eventType\`,
        \`eventVersion\`,
        \`payload\`,
        \`status\`,
        \`attemptCount\`,
        \`maxAttempts\`
      FROM \`OutboxEvent\`
      WHERE \`id\` = ${job.outboxEventId}
      FOR UPDATE
    `);
    const event = rows[0];
    if (!event) throw new WorkerDomainError('OUTBOX_EVENT_MISSING');
    if (event.status === 'PROCESSED') {
      return { outcome: 'ALREADY_PROCESSED', eventType: event.eventType };
    }
    if (['DEAD_LETTER', 'CANCELLED'].includes(event.status)) {
      return { outcome: 'TERMINAL', eventType: event.eventType };
    }
    if (event.eventType !== job.eventType || event.eventVersion !== job.eventVersion) {
      throw new WorkerDomainError('OUTBOX_JOB_MISMATCH');
    }
    const parsed = parseEventPayload(
      event.eventType,
      event.eventVersion,
      parseStoredJson(event.payload),
    );
    if (parsed.eventType !== OUTBOX_EVENT_TYPES.NOTIFICATION_DISPATCH) {
      throw new WorkerDomainError('OUTBOX_HANDLER_ROUTE_MISMATCH');
    }
    const notificationId = parsed.payload.notificationId;
    if (
      event.deterministicKey !== `notification-dispatch:v1:${notificationId}` ||
      event.aggregateType !== 'Notification' ||
      event.aggregateId !== notificationId
    ) {
      throw new WorkerDomainError('OUTBOX_NOTIFICATION_AGGREGATE_MISMATCH');
    }

    const notificationLocks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT \`id\`
      FROM \`Notification\`
      WHERE \`id\` = ${notificationId}
      FOR UPDATE
    `);
    if (notificationLocks.length !== 1) throw new WorkerDomainError('NOTIFICATION_MISSING');
    const notification = await transaction.notification.findUnique({
      where: { id: notificationId },
      select: {
        id: true,
        idempotencyKey: true,
        event: true,
        channel: true,
        encryptedRecipient: true,
        locale: true,
        payload: true,
        status: true,
      },
    });
    if (!notification) throw new WorkerDomainError('NOTIFICATION_MISSING');

    if (notification.status === 'DELIVERED' || notification.status === 'CANCELLED') {
      await transaction.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          safeErrorCode: null,
        },
      });
      return { outcome: 'ALREADY_PROCESSED', eventType: event.eventType };
    }
    if (notification.status === 'DEAD_LETTER') {
      await transaction.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'DEAD_LETTER',
          deadLetteredAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          safeErrorCode: 'NOTIFICATION_DEAD_LETTER',
        },
      });
      return { outcome: 'TERMINAL', eventType: event.eventType };
    }

    const channel = this.notificationChannel(notification.channel);
    const attempts = await transaction.notificationDeliveryAttempt.aggregate({
      where: { notificationId },
      _max: { attemptNumber: true },
    });
    const attemptNumber = (attempts._max.attemptNumber ?? 0) + 1;
    await transaction.notificationDeliveryAttempt.updateMany({
      where: { notificationId, status: 'PROCESSING' },
      data: {
        status: 'FAILED',
        safeErrorCode: 'NOTIFICATION_ATTEMPT_LEASE_EXPIRED',
        nextRetryAt: null,
      },
    });
    const provider = this.notificationAdapter.providerFor(channel).slice(0, 100);
    if (provider === 'disabled') {
      const processedAt = new Date();
      await transaction.notificationDeliveryAttempt.create({
        data: {
          notificationId,
          attemptNumber,
          provider,
          status: 'CANCELLED',
          safeErrorCode: 'NOTIFICATION_CHANNEL_DISABLED',
        },
      });
      await transaction.notification.update({
        where: { id: notificationId },
        data: { status: 'CANCELLED' },
      });
      await transaction.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          processedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          safeErrorCode: 'NOTIFICATION_CHANNEL_DISABLED',
        },
      });
      return { outcome: 'SKIPPED_DISABLED', eventType: event.eventType };
    }
    const attempt = await transaction.notificationDeliveryAttempt.create({
      data: {
        notificationId,
        attemptNumber,
        provider,
        status: 'PROCESSING',
      },
      select: { id: true },
    });
    await transaction.notification.update({
      where: { id: notificationId },
      data: { status: 'PROCESSING' },
    });
    await transaction.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: 'PROCESSING',
        leaseOwner: this.environment.WORKER_INSTANCE_ID,
        leaseExpiresAt: new Date(Date.now() + this.environment.OUTBOX_LEASE_MS),
      },
    });
    return {
      outcome: 'SEND',
      work: {
        outboxEventId: event.id,
        notificationId,
        attemptId: attempt.id,
        attemptNumber,
        provider,
        channel,
        event: notification.event,
        locale: notification.locale,
        encryptedRecipient: notification.encryptedRecipient ?? '',
        payload: notification.payload,
        idempotencyKey: notification.idempotencyKey,
      },
    };
  }

  private prepareNotification(work: NotificationWork): PreparedNotificationMessage {
    const recipient =
      work.channel === 'CONSOLE'
        ? ''
        : decryptNotificationField(work.encryptedRecipient, this.environment.FIELD_ENCRYPTION_KEY);
    validateNotificationRecipient(work.channel, recipient);
    const content = renderNotificationContent({
      event: work.event,
      channel: work.channel,
      locale: work.locale,
      payload: work.payload,
      webUrl: this.environment.WEB_URL,
      encryptionKey: this.environment.FIELD_ENCRYPTION_KEY,
    });
    return {
      notificationId: work.notificationId,
      channel: work.channel,
      event: work.event,
      locale: work.locale,
      recipient,
      ...content,
      providerIdempotencyKey: createHash('sha256')
        .update(`notification:v1:${work.idempotencyKey}`, 'utf8')
        .digest('hex'),
    };
  }

  private async finalizeNotificationSuccess(
    work: NotificationWork,
    delivery: NotificationDeliveryResult,
  ): Promise<void> {
    if (delivery.provider !== work.provider) {
      throw new WorkerDomainError('NOTIFICATION_PROVIDER_MISMATCH');
    }
    const providerMessageId = this.providerMessageId(delivery.providerMessageId);
    const now = new Date();
    await this.prisma.$transaction(
      async (transaction) => {
        await this.lockNotificationResultRows(transaction, work);
        const notification = await transaction.notification.findUnique({
          where: { id: work.notificationId },
          select: { status: true },
        });
        if (!notification) throw new WorkerDomainError('NOTIFICATION_MISSING');
        if (notification.status === 'CANCELLED') {
          await transaction.notificationDeliveryAttempt.updateMany({
            where: { id: work.attemptId, notificationId: work.notificationId },
            data: {
              status: 'DELIVERED',
              providerMessageId,
              safeErrorCode: 'NOTIFICATION_CANCELLED_AFTER_PROVIDER_ACCEPTED',
            },
          });
        } else if (notification.status === 'DELIVERED') {
          await transaction.notificationDeliveryAttempt.updateMany({
            where: { id: work.attemptId, notificationId: work.notificationId },
            data: {
              status: 'DELIVERED',
              providerMessageId,
              safeErrorCode: 'NOTIFICATION_ALREADY_DELIVERED',
            },
          });
        } else {
          await transaction.notification.update({
            where: { id: work.notificationId },
            data: { status: 'DELIVERED', deliveredAt: now },
          });
          const attempt = await transaction.notificationDeliveryAttempt.updateMany({
            where: {
              id: work.attemptId,
              notificationId: work.notificationId,
              status: 'PROCESSING',
            },
            data: {
              status: 'DELIVERED',
              providerMessageId,
              safeErrorCode: null,
              nextRetryAt: null,
            },
          });
          if (attempt.count !== 1) {
            throw new WorkerDomainError('NOTIFICATION_ATTEMPT_STATE_CONFLICT');
          }
        }
        await transaction.outboxEvent.update({
          where: { id: work.outboxEventId },
          data: {
            status: 'PROCESSED',
            processedAt: now,
            leaseOwner: null,
            leaseExpiresAt: null,
            safeErrorCode: null,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  }

  private async finalizeNotificationFailure(
    work: NotificationWork,
    errorCode: string,
  ): Promise<'RETRY' | 'DEAD_LETTER' | 'TERMINAL'> {
    const now = new Date();
    return this.prisma.$transaction(
      async (transaction) => {
        const event = await this.lockNotificationResultRows(transaction, work);
        const notification = await transaction.notification.findUnique({
          where: { id: work.notificationId },
          select: { status: true },
        });
        if (!notification) throw new WorkerDomainError('NOTIFICATION_MISSING');
        if (
          event.status === 'PROCESSED' ||
          event.status === 'DEAD_LETTER' ||
          event.status === 'CANCELLED' ||
          notification.status === 'DELIVERED' ||
          notification.status === 'CANCELLED'
        ) {
          await transaction.notificationDeliveryAttempt.updateMany({
            where: { id: work.attemptId, notificationId: work.notificationId },
            data: {
              status: 'FAILED',
              safeErrorCode: errorCode.slice(0, 100),
              nextRetryAt: null,
            },
          });
          if (notification.status === 'DELIVERED' && event.status !== 'PROCESSED') {
            await transaction.outboxEvent.update({
              where: { id: event.id },
              data: {
                status: 'PROCESSED',
                processedAt: now,
                leaseOwner: null,
                leaseExpiresAt: null,
                safeErrorCode: null,
              },
            });
          }
          return 'TERMINAL';
        }

        const deadLetter = event.attemptCount >= event.maxAttempts;
        const nextRetryAt = deadLetter
          ? null
          : new Date(
              now.getTime() +
                exponentialRetryDelay(
                  event.attemptCount,
                  this.environment.OUTBOX_RETRY_BASE_MS,
                  this.environment.OUTBOX_RETRY_MAX_MS,
                ),
            );
        const attempt = await transaction.notificationDeliveryAttempt.updateMany({
          where: {
            id: work.attemptId,
            notificationId: work.notificationId,
            status: 'PROCESSING',
          },
          data: {
            status: deadLetter ? 'DEAD_LETTER' : 'FAILED',
            safeErrorCode: errorCode.slice(0, 100),
            nextRetryAt,
          },
        });
        if (attempt.count !== 1) {
          throw new WorkerDomainError('NOTIFICATION_ATTEMPT_STATE_CONFLICT');
        }
        await transaction.notification.update({
          where: { id: work.notificationId },
          data: { status: deadLetter ? 'DEAD_LETTER' : 'FAILED' },
        });
        await transaction.outboxEvent.update({
          where: { id: event.id },
          data: deadLetter
            ? {
                status: 'DEAD_LETTER',
                deadLetteredAt: now,
                safeErrorCode: errorCode.slice(0, 100),
                leaseOwner: null,
                leaseExpiresAt: null,
              }
            : {
                status: 'RETRY',
                availableAt: nextRetryAt!,
                safeErrorCode: errorCode.slice(0, 100),
                leaseOwner: null,
                leaseExpiresAt: null,
              },
        });
        return deadLetter ? 'DEAD_LETTER' : 'RETRY';
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  }

  private async lockNotificationResultRows(
    transaction: Prisma.TransactionClient,
    work: NotificationWork,
  ): Promise<LockedEventRow> {
    const events = await transaction.$queryRaw<LockedEventRow[]>(Prisma.sql`
      SELECT
        \`id\`,
        \`deterministicKey\`,
        \`aggregateType\`,
        \`aggregateId\`,
        \`eventType\`,
        \`eventVersion\`,
        \`payload\`,
        \`status\`,
        \`attemptCount\`,
        \`maxAttempts\`
      FROM \`OutboxEvent\`
      WHERE \`id\` = ${work.outboxEventId}
      FOR UPDATE
    `);
    const event = events[0];
    if (!event) throw new WorkerDomainError('OUTBOX_EVENT_MISSING');
    const notifications = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT \`id\`
      FROM \`Notification\`
      WHERE \`id\` = ${work.notificationId}
      FOR UPDATE
    `);
    if (notifications.length !== 1) throw new WorkerDomainError('NOTIFICATION_MISSING');
    return event;
  }

  private notificationChannel(value: string): DeliverableNotificationChannel {
    if (value === 'EMAIL' || value === 'SMS' || value === 'CONSOLE') return value;
    throw new WorkerDomainError('NOTIFICATION_CHANNEL_UNSUPPORTED');
  }

  private providerMessageId(value: string): string {
    if (!value || value.length > 255 || !/^[\x20-\x7e]+$/.test(value)) {
      throw new WorkerDomainError('NOTIFICATION_PROVIDER_RESPONSE_INVALID');
    }
    return value;
  }
}
