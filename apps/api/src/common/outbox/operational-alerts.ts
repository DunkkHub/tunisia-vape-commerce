import { NotificationChannel, type Prisma } from '@prisma/client';
import type { CryptoService } from '../security/crypto.service';
import { ensureNotificationWithOutbox } from './notification-outbox';

type Transaction = Prisma.TransactionClient;
type OperationalAlertKind = 'security' | 'low-stock' | 'order';

const recipientKey: Record<OperationalAlertKind, string> = {
  security: 'notifications.security_alert_email',
  'low-stock': 'notifications.low_stock_alert_email',
  order: 'notifications.order_alert_email',
};

export async function createOperationalAlertWithOutbox(
  transaction: Transaction,
  crypto: CryptoService,
  input: {
    kind: OperationalAlertKind;
    event: 'SECURITY_ALERT' | 'LOW_STOCK_ALERT' | 'ADMIN_ORDER_CREATED';
    idempotencyKey: string;
    payload: Prisma.InputJsonValue;
    scheduledAt: Date;
    enabledKey?: string;
  },
): Promise<boolean> {
  const settings = await transaction.storeSetting.findMany({
    where: {
      key: {
        in: [
          recipientKey[input.kind],
          'notifications.operational_alert_locale',
          ...(input.enabledKey ? [input.enabledKey] : []),
        ],
      },
    },
    select: { key: true, value: true },
  });
  const values = new Map(settings.map((setting) => [setting.key, setting.value]));
  if (input.enabledKey && values.get(input.enabledKey) !== true) return false;
  const configuredRecipient = values.get(recipientKey[input.kind]);
  const recipient = typeof configuredRecipient === 'string' ? configuredRecipient.trim() : '';
  if (!recipient) return false;
  const locale = values.get('notifications.operational_alert_locale') === 'ar' ? 'ar-TN' : 'fr-TN';

  await ensureNotificationWithOutbox(transaction, {
    idempotencyKey: input.idempotencyKey,
    event: input.event,
    channel: NotificationChannel.EMAIL,
    recipientHash: crypto.hashToken(recipient.toLocaleLowerCase('en-US')),
    encryptedRecipient: crypto.encrypt(recipient.toLocaleLowerCase('en-US')),
    locale,
    payload: input.payload,
    scheduledAt: input.scheduledAt,
  });
  return true;
}
