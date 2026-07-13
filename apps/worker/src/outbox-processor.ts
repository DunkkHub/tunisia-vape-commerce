import { Prisma, type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { WorkerEnvironment } from './environment.js';
import {
  OUTBOX_EVENT_TYPES,
  WorkerDomainError,
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
  eventType: string;
  eventVersion: number;
  payload: Prisma.JsonValue;
  status: string;
}

interface LockedReservationRow {
  id: string;
  inventoryItemId: string;
}

interface ProcessingResult {
  outcome: 'PROCESSED' | 'ALREADY_PROCESSED' | 'TERMINAL';
  eventType: string;
  affectedCount: number;
  notification?: { id: string; channel: string; event: string };
}

export class OutboxProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: OutboxRepository,
    private readonly environment: WorkerEnvironment,
    private readonly logger: Logger,
  ) {}

  async process(job: OutboxJobData): Promise<void> {
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
          ...(result.notification ? { notification: result.notification } : {}),
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

  private async processTransaction(
    transaction: Prisma.TransactionClient,
    job: OutboxJobData,
  ): Promise<ProcessingResult> {
    const rows = await transaction.$queryRaw<LockedEventRow[]>(Prisma.sql`
      SELECT \`id\`, \`eventType\`, \`eventVersion\`, \`payload\`, \`status\`
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
    let notification: ProcessingResult['notification'];
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
        notification = await this.dispatchNotification(transaction, parsed.payload.notificationId);
        affectedCount = notification ? 1 : 0;
        break;
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
      ...(notification ? { notification } : {}),
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

  private async dispatchNotification(
    transaction: Prisma.TransactionClient,
    notificationId: string,
  ): Promise<{ id: string; channel: string; event: string } | undefined> {
    const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT \`id\`
      FROM \`Notification\`
      WHERE \`id\` = ${notificationId}
      FOR UPDATE
    `);
    if (locked.length !== 1) throw new WorkerDomainError('NOTIFICATION_MISSING');
    const notification = await transaction.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, channel: true, event: true, status: true },
    });
    if (!notification) throw new WorkerDomainError('NOTIFICATION_MISSING');
    if (notification.status === 'DELIVERED' || notification.status === 'CANCELLED')
      return undefined;
    if (this.environment.NOTIFICATION_ADAPTER !== 'console' || notification.channel !== 'CONSOLE') {
      throw new WorkerDomainError('NOTIFICATION_PROVIDER_NOT_CONFIGURED');
    }
    const attempts = await transaction.notificationDeliveryAttempt.aggregate({
      where: { notificationId },
      _max: { attemptNumber: true },
    });
    const attemptNumber = (attempts._max.attemptNumber ?? 0) + 1;
    await transaction.notification.update({
      where: { id: notification.id },
      data: { status: 'DELIVERED', deliveredAt: new Date() },
    });
    await transaction.notificationDeliveryAttempt.create({
      data: {
        notificationId: notification.id,
        attemptNumber,
        provider: 'console-development',
        status: 'DELIVERED',
      },
    });
    return {
      id: notification.id,
      channel: notification.channel,
      event: notification.event,
    };
  }
}
