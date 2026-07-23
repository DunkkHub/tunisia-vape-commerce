import { z } from 'zod';
import { decryptNotificationField } from './notification-crypto.js';
import { WorkerDomainError } from './outbox-contracts.js';

export type DeliverableNotificationChannel = 'EMAIL' | 'SMS' | 'CONSOLE';

export interface NotificationContent {
  subject?: string;
  body: string;
}

const orderPayloadSchema = z.object({
  orderNumber: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/),
});

const passwordResetPayloadSchema = z.object({
  encryptedResetToken: z.string().min(1).max(16_384),
  expiresInMinutes: z.number().int().min(1).max(1_440),
});

const securityAlertPayloadSchema = z.object({
  alertCode: z.enum(['ADMIN_LOGIN_LOCKED', 'ADMIN_LOGIN_SUSPENDED']),
  occurredAt: z.iso.datetime({ offset: true }),
});

const lowStockAlertPayloadSchema = z.object({
  sku: z.string().min(1).max(100),
  nameFr: z.string().min(1).max(255),
  nameAr: z.string().min(1).max(255),
  remainingQuantity: z.number().int().min(0).max(2_147_483_647),
  threshold: z.number().int().min(0).max(2_147_483_647),
  observedAt: z.iso.datetime({ offset: true }),
});

const emailRecipientSchema = z.email().max(320);
const tunisianPhoneSchema = z.string().regex(/^\+216[24579]\d{7}$/);

const parsePayload = (payload: unknown): unknown => {
  if (typeof payload !== 'string') return payload;
  if (payload.length > 16_384) throw new WorkerDomainError('NOTIFICATION_PAYLOAD_INVALID');
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new WorkerDomainError('NOTIFICATION_PAYLOAD_INVALID');
  }
};

const localizedOrderCopy = {
  ORDER_RECEIVED: {
    fr: ['Commande reçue', 'Votre commande {orderNumber} a bien été reçue.'],
    ar: ['تم استلام الطلب', 'تم استلام طلبك {orderNumber}.'],
  },
  ORDER_CONFIRMED: {
    fr: ['Commande confirmée', 'Votre commande {orderNumber} est confirmée.'],
    ar: ['تم تأكيد الطلب', 'تم تأكيد طلبك {orderNumber}.'],
  },
  ORDER_ON_HOLD: {
    fr: ['Commande en attente', 'Votre commande {orderNumber} est temporairement en attente.'],
    ar: ['الطلب قيد الانتظار', 'طلبك {orderNumber} قيد الانتظار مؤقتًا.'],
  },
  ORDER_PREPARING: {
    fr: ['Commande en préparation', 'Votre commande {orderNumber} est en préparation.'],
    ar: ['جاري تجهيز الطلب', 'جاري تجهيز طلبك {orderNumber}.'],
  },
  HANDED_TO_COURIER: {
    fr: ['Commande remise au livreur', 'Votre commande {orderNumber} a été remise au livreur.'],
    ar: ['تم تسليم الطلب للمندوب', 'تم تسليم طلبك {orderNumber} إلى مندوب التوصيل.'],
  },
  OUT_FOR_DELIVERY: {
    fr: ['Commande en livraison', 'Votre commande {orderNumber} est en cours de livraison.'],
    ar: ['الطلب في طريقه إليك', 'طلبك {orderNumber} في طريقه إليك.'],
  },
  DELIVERY_ATTEMPTED: {
    fr: [
      'Tentative de livraison',
      'Une tentative de livraison a été enregistrée pour {orderNumber}.',
    ],
    ar: ['محاولة توصيل', 'تم تسجيل محاولة توصيل للطلب {orderNumber}.'],
  },
  DELIVERY_RESCHEDULED: {
    fr: ['Livraison reprogrammée', 'La livraison de {orderNumber} a été reprogrammée.'],
    ar: ['تمت إعادة جدولة التوصيل', 'تمت إعادة جدولة توصيل الطلب {orderNumber}.'],
  },
  ORDER_DELIVERED: {
    fr: ['Commande livrée', 'Votre commande {orderNumber} a été livrée.'],
    ar: ['تم توصيل الطلب', 'تم توصيل طلبك {orderNumber}.'],
  },
  DELIVERY_REFUSED: {
    fr: ['Livraison refusée', 'Le refus de livraison de {orderNumber} a été enregistré.'],
    ar: ['تم رفض التوصيل', 'تم تسجيل رفض توصيل الطلب {orderNumber}.'],
  },
  DELIVERY_FAILED: {
    fr: ['Échec de livraison', 'La livraison de {orderNumber} n’a pas abouti.'],
    ar: ['تعذر التوصيل', 'تعذر توصيل الطلب {orderNumber}.'],
  },
  ORDER_CANCELLED: {
    fr: ['Commande annulée', 'Votre commande {orderNumber} a été annulée.'],
    ar: ['تم إلغاء الطلب', 'تم إلغاء طلبك {orderNumber}.'],
  },
  RETURN_UPDATE: {
    fr: ['Mise à jour du retour', 'Le retour de la commande {orderNumber} a été mis à jour.'],
    ar: ['تحديث الإرجاع', 'تم تحديث إرجاع الطلب {orderNumber}.'],
  },
} as const;

type OrderNotificationEvent = keyof typeof localizedOrderCopy;

const localeKey = (locale: string): 'fr' | 'ar' =>
  locale.trim().toLowerCase().startsWith('ar') ? 'ar' : 'fr';

const isOrderNotificationEvent = (event: string): event is OrderNotificationEvent =>
  Object.hasOwn(localizedOrderCopy, event);

const plainText = (value: string): string => value.replace(/[\r\n\t]+/g, ' ').trim();

export const validateNotificationRecipient = (
  channel: DeliverableNotificationChannel,
  recipient: string,
): void => {
  if (channel === 'CONSOLE') return;
  const result =
    channel === 'EMAIL'
      ? emailRecipientSchema.safeParse(recipient)
      : tunisianPhoneSchema.safeParse(recipient);
  if (!result.success) throw new WorkerDomainError('NOTIFICATION_RECIPIENT_INVALID');
};

export const renderNotificationContent = (input: {
  event: string;
  channel: DeliverableNotificationChannel;
  locale: string;
  payload: unknown;
  webUrl: string;
  encryptionKey: string;
}): NotificationContent => {
  const language = localeKey(input.locale);
  const payload = parsePayload(input.payload);

  if (input.event === 'PASSWORD_RESET') {
    if (input.channel !== 'EMAIL') {
      throw new WorkerDomainError('NOTIFICATION_CHANNEL_UNSUPPORTED');
    }
    const parsed = passwordResetPayloadSchema.safeParse(payload);
    if (!parsed.success) throw new WorkerDomainError('NOTIFICATION_PAYLOAD_INVALID');
    const resetToken = decryptNotificationField(
      parsed.data.encryptedResetToken,
      input.encryptionKey,
    );
    if (resetToken.length < 32 || resetToken.length > 256) {
      throw new WorkerDomainError('NOTIFICATION_PAYLOAD_INVALID');
    }
    const resetUrl = new URL('/password-reset/confirm', input.webUrl);
    resetUrl.searchParams.set('token', resetToken);
    return language === 'ar'
      ? {
          subject: 'إعادة تعيين كلمة المرور',
          body: `استخدم هذا الرابط لإعادة تعيين كلمة المرور خلال ${parsed.data.expiresInMinutes} دقيقة:\n${resetUrl.toString()}\nإذا لم تطلب ذلك، فتجاهل هذه الرسالة.`,
        }
      : {
          subject: 'Réinitialisation de votre mot de passe',
          body: `Utilisez ce lien pour réinitialiser votre mot de passe dans les ${parsed.data.expiresInMinutes} prochaines minutes :\n${resetUrl.toString()}\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message.`,
        };
  }

  if (input.event === 'SECURITY_ALERT') {
    if (input.channel !== 'EMAIL') {
      throw new WorkerDomainError('NOTIFICATION_CHANNEL_UNSUPPORTED');
    }
    const parsed = securityAlertPayloadSchema.safeParse(payload);
    if (!parsed.success) throw new WorkerDomainError('NOTIFICATION_PAYLOAD_INVALID');
    return language === 'ar'
      ? {
          subject: 'تنبيه أمني للمتجر',
          body: `تم تسجيل حدث أمني (${parsed.data.alertCode}) في ${parsed.data.occurredAt}. راجع سجل التدقيق والأمان في لوحة الإدارة.`,
        }
      : {
          subject: 'Alerte de sécurité de la boutique',
          body: `Un événement de sécurité (${parsed.data.alertCode}) a été enregistré à ${parsed.data.occurredAt}. Consultez les journaux d’audit et de sécurité dans l’administration.`,
        };
  }

  if (input.event === 'LOW_STOCK_ALERT') {
    if (input.channel !== 'EMAIL') {
      throw new WorkerDomainError('NOTIFICATION_CHANNEL_UNSUPPORTED');
    }
    const parsed = lowStockAlertPayloadSchema.safeParse(payload);
    if (!parsed.success) throw new WorkerDomainError('NOTIFICATION_PAYLOAD_INVALID');
    const name = plainText(language === 'ar' ? parsed.data.nameAr : parsed.data.nameFr);
    const sku = plainText(parsed.data.sku);
    return language === 'ar'
      ? {
          subject: 'تنبيه مخزون منخفض',
          body: `المخزون المتاح للمنتج ${name} (${sku}) هو ${parsed.data.remainingQuantity}، وحد التنبيه ${parsed.data.threshold}. وقت الرصد: ${parsed.data.observedAt}.`,
        }
      : {
          subject: 'Alerte de stock faible',
          body: `Le stock disponible de ${name} (${sku}) est de ${parsed.data.remainingQuantity}, pour un seuil de ${parsed.data.threshold}. Observation : ${parsed.data.observedAt}.`,
        };
  }

  if (!isOrderNotificationEvent(input.event)) {
    throw new WorkerDomainError('NOTIFICATION_TEMPLATE_UNSUPPORTED');
  }
  const parsed = orderPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new WorkerDomainError('NOTIFICATION_PAYLOAD_INVALID');
  const [subject, body] = localizedOrderCopy[input.event][language];
  return {
    ...(input.channel === 'EMAIL' ? { subject } : {}),
    body: body.replace('{orderNumber}', parsed.data.orderNumber),
  };
};
