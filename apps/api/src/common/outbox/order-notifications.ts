import {
  DeliveryStatus,
  NotificationChannel,
  NotificationEvent,
  type Prisma,
} from '@prisma/client';
import type { CryptoService } from '../security/crypto.service';
import { createNotificationWithOutbox } from './notification-outbox';

type Transaction = Prisma.TransactionClient;

export interface OrderNotificationTarget {
  id: string;
  orderNumber: string;
  customerEmailSnapshot: string | null;
  customerPhoneSnapshot: string;
  locale: string;
}

export const notificationEventForDeliveryStatus = (
  status: DeliveryStatus,
): NotificationEvent | null => {
  const events: Partial<Record<DeliveryStatus, NotificationEvent>> = {
    [DeliveryStatus.CONFIRMED]: NotificationEvent.ORDER_CONFIRMED,
    [DeliveryStatus.ON_HOLD]: NotificationEvent.ORDER_ON_HOLD,
    [DeliveryStatus.PREPARING]: NotificationEvent.ORDER_PREPARING,
    [DeliveryStatus.HANDED_TO_COURIER]: NotificationEvent.HANDED_TO_COURIER,
    [DeliveryStatus.OUT_FOR_DELIVERY]: NotificationEvent.OUT_FOR_DELIVERY,
    [DeliveryStatus.DELIVERY_ATTEMPTED]: NotificationEvent.DELIVERY_ATTEMPTED,
    [DeliveryStatus.RESCHEDULED]: NotificationEvent.DELIVERY_RESCHEDULED,
    [DeliveryStatus.DELIVERED]: NotificationEvent.ORDER_DELIVERED,
    [DeliveryStatus.REFUSED]: NotificationEvent.DELIVERY_REFUSED,
    [DeliveryStatus.FAILED]: NotificationEvent.DELIVERY_FAILED,
    [DeliveryStatus.RETURN_TO_SENDER]: NotificationEvent.RETURN_UPDATE,
    [DeliveryStatus.RETURNED]: NotificationEvent.RETURN_UPDATE,
  };
  return events[status] ?? null;
};

export async function createOrderNotificationsWithOutbox(
  transaction: Transaction,
  crypto: CryptoService,
  input: {
    order: OrderNotificationTarget;
    event: NotificationEvent;
    scheduledAt: Date;
    idempotencyDiscriminator?: string;
  },
): Promise<void> {
  const discriminator = input.idempotencyDiscriminator ?? input.event.toLocaleLowerCase('en-US');
  const payload = { orderNumber: input.order.orderNumber };
  const email = input.order.customerEmailSnapshot?.trim().toLocaleLowerCase('en-US') ?? '';
  const smsSetting = await transaction.storeSetting.findUnique({
    where: { key: 'notifications.customer_order_sms.enabled' },
    select: { value: true },
  });
  const smsEnabled = smsSetting?.value === true;

  if (email) {
    await createNotificationWithOutbox(transaction, {
      orderId: input.order.id,
      idempotencyKey: `order:${input.order.id}:${discriminator}:email`,
      event: input.event,
      channel: NotificationChannel.EMAIL,
      recipientHash: crypto.hashToken(email),
      encryptedRecipient: crypto.encrypt(email),
      locale: input.order.locale,
      payload,
      scheduledAt: input.scheduledAt,
    });
  }

  if (smsEnabled) {
    await createNotificationWithOutbox(transaction, {
      orderId: input.order.id,
      idempotencyKey: `order:${input.order.id}:${discriminator}:sms`,
      event: input.event,
      channel: NotificationChannel.SMS,
      recipientHash: crypto.hashToken(input.order.customerPhoneSnapshot),
      encryptedRecipient: crypto.encrypt(input.order.customerPhoneSnapshot),
      locale: input.order.locale,
      payload,
      scheduledAt: input.scheduledAt,
    });
  }
}
