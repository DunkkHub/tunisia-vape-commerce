import type { Prisma } from '@prisma/client';

type Transaction = Prisma.TransactionClient;

/**
 * Creates the durable notification and its dispatch event in the same database transaction.
 * The worker bridge remains a recovery path for historical rows created before this invariant.
 */
export async function createNotificationWithOutbox(
  transaction: Transaction,
  data: Prisma.NotificationUncheckedCreateInput,
) {
  const notification = await transaction.notification.create({
    data,
    select: { id: true, channel: true, event: true },
  });
  await transaction.outboxEvent.create({
    data: {
      deterministicKey: `notification-dispatch:v1:${notification.id}`,
      aggregateType: 'Notification',
      aggregateId: notification.id,
      eventType: 'notification.dispatch.requested',
      eventVersion: 1,
      payload: { notificationId: notification.id },
      availableAt: data.scheduledAt ?? new Date(),
    },
  });
  return notification;
}

/**
 * Race-safe variant for coalesced operational alerts. Reusing an idempotency key preserves the
 * original notification and its delivery state; it never requeues or rewrites delivered content.
 */
export async function ensureNotificationWithOutbox(
  transaction: Transaction,
  data: Prisma.NotificationUncheckedCreateInput,
) {
  const notification = await transaction.notification.upsert({
    where: { idempotencyKey: data.idempotencyKey },
    create: data,
    update: {},
    select: { id: true, channel: true, event: true },
  });
  await transaction.outboxEvent.upsert({
    where: { deterministicKey: `notification-dispatch:v1:${notification.id}` },
    create: {
      deterministicKey: `notification-dispatch:v1:${notification.id}`,
      aggregateType: 'Notification',
      aggregateId: notification.id,
      eventType: 'notification.dispatch.requested',
      eventVersion: 1,
      payload: { notificationId: notification.id },
      availableAt: data.scheduledAt ?? new Date(),
    },
    update: {},
  });
  return notification;
}
