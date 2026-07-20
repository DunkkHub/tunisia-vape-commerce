import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { WorkerEnvironment } from './environment.js';
import type { DeliverableNotificationChannel } from './notification-templates.js';
import { WorkerDomainError } from './outbox-contracts.js';

export interface PreparedNotificationMessage {
  notificationId: string;
  channel: DeliverableNotificationChannel;
  event: string;
  locale: string;
  recipient: string;
  subject?: string;
  body: string;
  providerIdempotencyKey: string;
}

export interface NotificationDeliveryResult {
  provider: 'smtp' | 'sms-https-webhook' | 'console-development';
  providerMessageId: string;
}

interface SmtpTransportLike {
  sendMail(input: Record<string, unknown>): Promise<unknown>;
}

export interface NotificationAdapterDependencies {
  smtpTransport?: SmtpTransportLike;
  fetch?: typeof fetch;
}

export interface NotificationAdapter {
  providerFor(channel: DeliverableNotificationChannel): string;
  send(message: PreparedNotificationMessage): Promise<NotificationDeliveryResult>;
}

const smsResponseSchema = z.strictObject({
  messageId: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[\x21-\x7e]+$/),
});

const safeMessageId = (value: unknown, fallback: string): string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 255 &&
  /^[\x20-\x7e]+$/.test(value)
    ? value
    : fallback;

const smtpError = (error: unknown): WorkerDomainError => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['ETIMEDOUT', 'ESOCKET', 'ECONNECTION'].includes(error.code)
  ) {
    return new WorkerDomainError('EMAIL_PROVIDER_TIMEOUT');
  }
  return new WorkerDomainError('EMAIL_PROVIDER_FAILED');
};

const readBoundedJson = async (response: Response): Promise<unknown> => {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) > 4_096) {
    throw new WorkerDomainError('SMS_PROVIDER_RESPONSE_INVALID');
  }
  const body = await response.text();
  if (!body || body.length > 4_096) {
    throw new WorkerDomainError('SMS_PROVIDER_RESPONSE_INVALID');
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new WorkerDomainError('SMS_PROVIDER_RESPONSE_INVALID');
  }
};

export class ProviderNeutralNotificationAdapter implements NotificationAdapter {
  private readonly smtpTransport?: SmtpTransportLike;
  private readonly fetchImplementation: typeof fetch;

  constructor(
    private readonly environment: WorkerEnvironment,
    dependencies: NotificationAdapterDependencies = {},
  ) {
    this.fetchImplementation = dependencies.fetch ?? globalThis.fetch;
    if (['smtp', 'smtp-webhook'].includes(environment.NOTIFICATION_ADAPTER)) {
      this.smtpTransport =
        dependencies.smtpTransport ??
        nodemailer.createTransport({
          host: environment.SMTP_HOST,
          port: environment.SMTP_PORT,
          secure: environment.SMTP_SECURE,
          requireTLS: environment.SMTP_REQUIRE_TLS,
          ...(environment.SMTP_USER
            ? {
                auth: {
                  user: environment.SMTP_USER,
                  pass: environment.SMTP_PASSWORD,
                },
              }
            : {}),
          connectionTimeout: environment.NOTIFICATION_CONNECT_TIMEOUT_MS,
          greetingTimeout: environment.NOTIFICATION_CONNECT_TIMEOUT_MS,
          socketTimeout: environment.NOTIFICATION_REQUEST_TIMEOUT_MS,
          tls: { rejectUnauthorized: true, servername: environment.SMTP_HOST },
        });
    }
  }

  providerFor(channel: DeliverableNotificationChannel): string {
    if (this.environment.NOTIFICATION_ADAPTER === 'disabled') return 'disabled';
    if (channel === 'SMS' && !this.environment.SMS_ENABLED) return 'disabled';
    if (this.environment.NOTIFICATION_ADAPTER === 'smtp-webhook') {
      if (channel === 'EMAIL') return 'smtp';
      if (channel === 'SMS') return 'sms-https-webhook';
      return 'unsupported';
    }
    if (this.environment.NOTIFICATION_ADAPTER === 'smtp') {
      return channel === 'EMAIL' ? 'smtp' : 'console-development';
    }
    if (this.environment.NOTIFICATION_ADAPTER === 'console' && channel === 'CONSOLE') {
      return 'console-development';
    }
    return 'unsupported';
  }

  async send(message: PreparedNotificationMessage): Promise<NotificationDeliveryResult> {
    const provider = this.providerFor(message.channel);
    if (provider === 'smtp') return this.sendEmail(message);
    if (provider === 'sms-https-webhook') return this.sendSms(message);
    if (provider === 'console-development') {
      return {
        provider,
        providerMessageId: `console-${message.providerIdempotencyKey.slice(0, 48)}`,
      };
    }
    if (provider === 'disabled') {
      throw new WorkerDomainError('NOTIFICATION_CHANNEL_DISABLED');
    }
    throw new WorkerDomainError('NOTIFICATION_PROVIDER_NOT_CONFIGURED');
  }

  private async sendEmail(
    message: PreparedNotificationMessage,
  ): Promise<NotificationDeliveryResult> {
    if (!this.smtpTransport || message.channel !== 'EMAIL' || !message.subject) {
      throw new WorkerDomainError('NOTIFICATION_PROVIDER_NOT_CONFIGURED');
    }
    const fromDomain = this.environment.EMAIL_FROM.split('@')[1] ?? 'notification.invalid';
    const deterministicMessageId = `<${message.providerIdempotencyKey}@${fromDomain}>`;
    try {
      const result = (await this.smtpTransport.sendMail({
        from: {
          address: this.environment.EMAIL_FROM,
          name: this.environment.EMAIL_FROM_NAME,
        },
        to: message.recipient,
        subject: message.subject,
        text: message.body,
        messageId: deterministicMessageId,
        headers: {
          'X-Idempotency-Key': message.providerIdempotencyKey,
          'X-Notification-Event': message.event,
        },
      })) as { accepted?: unknown; rejected?: unknown; messageId?: unknown };
      const accepted = Array.isArray(result.accepted) ? result.accepted : [];
      const rejected = Array.isArray(result.rejected) ? result.rejected : [];
      if (accepted.length === 0 || rejected.length > 0) {
        throw new WorkerDomainError('EMAIL_PROVIDER_REJECTED');
      }
      return {
        provider: 'smtp',
        providerMessageId: safeMessageId(result.messageId, deterministicMessageId),
      };
    } catch (error) {
      if (error instanceof WorkerDomainError) throw error;
      throw smtpError(error);
    }
  }

  private async sendSms(message: PreparedNotificationMessage): Promise<NotificationDeliveryResult> {
    if (message.channel !== 'SMS') {
      throw new WorkerDomainError('NOTIFICATION_PROVIDER_NOT_CONFIGURED');
    }
    let response: Response;
    try {
      response = await this.fetchImplementation(this.environment.SMS_WEBHOOK_URL, {
        method: 'POST',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.environment.SMS_WEBHOOK_AUTH_TOKEN}`,
          'content-type': 'application/json',
          'idempotency-key': message.providerIdempotencyKey,
        },
        body: JSON.stringify({
          messageId: message.providerIdempotencyKey,
          to: message.recipient,
          sender: this.environment.SMS_SENDER,
          body: message.body,
          locale: message.locale,
          event: message.event,
        }),
        signal: AbortSignal.timeout(this.environment.NOTIFICATION_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new WorkerDomainError('SMS_PROVIDER_TIMEOUT');
      }
      throw new WorkerDomainError('SMS_PROVIDER_UNAVAILABLE');
    }

    if (!response.ok) {
      throw new WorkerDomainError(
        response.status === 429 || response.status >= 500
          ? 'SMS_PROVIDER_RETRYABLE'
          : 'SMS_PROVIDER_REJECTED',
      );
    }
    const parsed = smsResponseSchema.safeParse(await readBoundedJson(response));
    if (!parsed.success) throw new WorkerDomainError('SMS_PROVIDER_RESPONSE_INVALID');
    return {
      provider: 'sms-https-webhook',
      providerMessageId: parsed.data.messageId,
    };
  }
}
