import type { PrismaClient } from '@prisma/client';
import type { WorkerEnvironment } from './environment.js';
import { OUTBOX_EVENT_TYPES } from './outbox-contracts.js';

export class OutboxSources {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly environment: WorkerEnvironment,
  ) {}

  async enqueueScheduledWork(now = new Date()): Promise<void> {
    await this.enqueueReservationExpiry(now);
    if (this.environment.NOTIFICATION_BRIDGE_ENABLED) {
      await this.bridgeNotifications(now);
    }
  }

  private async enqueueReservationExpiry(now: Date): Promise<void> {
    const bucket = Math.floor(now.getTime() / this.environment.RESERVATION_EXPIRY_INTERVAL_MS);
    const deterministicKey = `reservation-expiry:v1:${bucket}`;
    await this.prisma.outboxEvent.upsert({
      where: { deterministicKey },
      update: {},
      create: {
        deterministicKey,
        aggregateType: 'Inventory',
        aggregateId: 'reservations',
        eventType: OUTBOX_EVENT_TYPES.RESERVATION_EXPIRY,
        eventVersion: 1,
        payload: {
          cutoff: now.toISOString(),
          batchSize: this.environment.RESERVATION_EXPIRY_BATCH_SIZE,
        },
        maxAttempts: this.environment.OUTBOX_MAX_ATTEMPTS,
        availableAt: now,
      },
    });
  }

  private async bridgeNotifications(now: Date): Promise<void> {
    const notifications = await this.prisma.notification.findMany({
      where: { status: 'QUEUED', scheduledAt: { lte: now } },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: this.environment.OUTBOX_BATCH_SIZE,
      select: { id: true },
    });
    for (const notification of notifications) {
      await this.prisma.outboxEvent.upsert({
        where: { deterministicKey: `notification-dispatch:v1:${notification.id}` },
        update: {},
        create: {
          deterministicKey: `notification-dispatch:v1:${notification.id}`,
          aggregateType: 'Notification',
          aggregateId: notification.id,
          eventType: OUTBOX_EVENT_TYPES.NOTIFICATION_DISPATCH,
          eventVersion: 1,
          payload: { notificationId: notification.id },
          maxAttempts: this.environment.OUTBOX_MAX_ATTEMPTS,
          availableAt: now,
        },
      });
    }
  }
}
