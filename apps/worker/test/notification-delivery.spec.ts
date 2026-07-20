import { createCipheriv, createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parseWorkerEnvironment, type WorkerEnvironment } from '../src/environment.js';
import {
  ProviderNeutralNotificationAdapter,
  type NotificationAdapter,
  type PreparedNotificationMessage,
} from '../src/notification-adapter.js';
import { WorkerDomainError, OUTBOX_EVENT_TYPES } from '../src/outbox-contracts.js';
import { OutboxProcessor } from '../src/outbox-processor.js';

const encryptionKey = 'notification-test-key-'.repeat(3);

const encryptField = (value: string): string => {
  const key = createHash('sha256').update(encryptionKey, 'utf8').digest();
  const initializationVector = Buffer.alloc(12, 7);
  const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  key.fill(0);
  return [
    initializationVector.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
};

const localSmtpEnvironment = (): WorkerEnvironment =>
  parseWorkerEnvironment({
    DATABASE_URL: 'mysql://worker:secret@localhost:3306/store',
    REDIS_URL: 'redis://localhost:6379/15',
    WEB_URL: 'http://localhost:5173',
    FIELD_ENCRYPTION_KEY: encryptionKey,
    WORKER_INSTANCE_ID: 'worker-test-1',
    NOTIFICATION_ADAPTER: 'smtp',
    SMS_ENABLED: 'false',
    SMTP_HOST: 'mailpit',
    SMTP_PORT: '1025',
    EMAIL_FROM: 'no-reply@local.test',
  });

const productionInput = (): Record<string, string> => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'mysql://worker:secret@mysql.internal:3306/store',
  REDIS_URL: 'rediss://redis.internal:6379/0',
  WEB_URL: 'https://store.example.com',
  FIELD_ENCRYPTION_KEY: 'production-field-key-material-'.repeat(2),
  WORKER_INSTANCE_ID: 'worker-production-1',
  NOTIFICATION_ADAPTER: 'smtp-webhook',
  SMS_ENABLED: 'true',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_REQUIRE_TLS: 'true',
  SMTP_USER: 'smtp-user',
  SMTP_PASSWORD: 'smtp-password-with-32-characters',
  EMAIL_FROM: 'no-reply@example.com',
  SMS_WEBHOOK_URL: 'https://sms.example.com/v1/messages',
  SMS_WEBHOOK_AUTH_TOKEN: 'sms-provider-token-with-32-characters',
  SMS_SENDER: 'TunisiaVape',
});

const productionEnvironment = (): WorkerEnvironment => parseWorkerEnvironment(productionInput());

const eventRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-a',
  deterministicKey: 'notification-dispatch:v1:notification-a',
  aggregateType: 'Notification',
  aggregateId: 'notification-a',
  eventType: OUTBOX_EVENT_TYPES.NOTIFICATION_DISPATCH,
  eventVersion: 1,
  payload: { notificationId: 'notification-a' },
  status: 'PUBLISHED',
  attemptCount: 1,
  maxAttempts: 8,
  ...overrides,
});

const notificationRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'notification-a',
  idempotencyKey: 'password-reset:user-a:key-a',
  event: 'PASSWORD_RESET',
  channel: 'EMAIL',
  encryptedRecipient: encryptField('customer@example.com'),
  locale: 'fr-TN',
  payload: {
    encryptedResetToken: encryptField('reset-token-value-that-is-at-least-thirty-two-characters'),
    expiresInMinutes: 30,
  },
  status: 'QUEUED',
  ...overrides,
});

const claimTransaction = (event = eventRow(), notification = notificationRow()) => ({
  $queryRaw: vi
    .fn()
    .mockResolvedValueOnce([event])
    .mockResolvedValueOnce([{ id: notification.id }]),
  notification: {
    findUnique: vi.fn().mockResolvedValue(notification),
    update: vi.fn().mockResolvedValue({}),
  },
  notificationDeliveryAttempt: {
    aggregate: vi.fn().mockResolvedValue({ _max: { attemptNumber: null } }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({ id: 'attempt-a' }),
  },
  outboxEvent: { update: vi.fn().mockResolvedValue({}) },
});

const resultTransaction = (
  event = eventRow({ status: 'PROCESSING' }),
  notificationStatus = 'PROCESSING',
) => ({
  $queryRaw: vi
    .fn()
    .mockResolvedValueOnce([event])
    .mockResolvedValueOnce([{ id: 'notification-a' }]),
  notification: {
    findUnique: vi.fn().mockResolvedValue({ status: notificationStatus }),
    update: vi.fn().mockResolvedValue({}),
  },
  notificationDeliveryAttempt: {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  outboxEvent: { update: vi.fn().mockResolvedValue({}) },
});

const logger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('notification environment validation', () => {
  it('rejects disabled email or partially configured enabled SMS in production', () => {
    expect(() =>
      parseWorkerEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'mysql://worker:secret@mysql.internal:3306/store',
        NOTIFICATION_ADAPTER: 'disabled',
      }),
    ).toThrow();
    expect(() =>
      parseWorkerEnvironment({
        ...productionInput(),
        SMS_WEBHOOK_URL: 'http://sms.example.com/v1/messages',
      }),
    ).toThrow();
  });

  it('accepts production email delivery without SMS credentials when SMS is disabled', () => {
    const input = productionInput();
    input.SMS_ENABLED = 'false';
    delete input.SMS_WEBHOOK_URL;
    delete input.SMS_WEBHOOK_AUTH_TOKEN;
    delete input.SMS_SENDER;

    expect(parseWorkerEnvironment(input)).toMatchObject({
      NOTIFICATION_ADAPTER: 'smtp-webhook',
      SMS_ENABLED: false,
      SMTP_HOST: 'smtp.example.com',
      SMS_WEBHOOK_URL: '',
      SMS_WEBHOOK_AUTH_TOKEN: '',
    });
  });

  it('does not let disabled SMS relax production email requirements', () => {
    const input = productionInput();
    input.SMS_ENABLED = 'false';
    delete input.SMS_WEBHOOK_URL;
    delete input.SMS_WEBHOOK_AUTH_TOKEN;
    delete input.SMTP_PASSWORD;

    expect(() => parseWorkerEnvironment(input)).toThrow();
  });

  it('accepts complete production SMTP and HTTPS SMS configuration', () => {
    expect(productionEnvironment()).toMatchObject({
      NOTIFICATION_ADAPTER: 'smtp-webhook',
      SMS_ENABLED: true,
      SMTP_REQUIRE_TLS: true,
      SMTP_HOST: 'smtp.example.com',
      SMS_WEBHOOK_URL: 'https://sms.example.com/v1/messages',
    });
  });
});

describe('provider-neutral notification adapter', () => {
  it('terminates every channel cleanly when notification delivery is globally disabled', async () => {
    const adapter = new ProviderNeutralNotificationAdapter(
      parseWorkerEnvironment({
        DATABASE_URL: 'mysql://worker:secret@localhost:3306/store',
        NOTIFICATION_ADAPTER: 'disabled',
      }),
    );

    expect(adapter.providerFor('EMAIL')).toBe('disabled');
    expect(adapter.providerFor('SMS')).toBe('disabled');
    await expect(
      adapter.send({
        notificationId: 'notification-disabled',
        channel: 'EMAIL',
        event: 'ORDER_RECEIVED',
        locale: 'fr-TN',
        recipient: 'customer@example.test',
        subject: 'Commande reçue',
        body: 'Message désactivé.',
        providerIdempotencyKey: 'disabled-notification-key',
      }),
    ).rejects.toMatchObject({ safeCode: 'NOTIFICATION_CHANNEL_DISABLED' });
  });

  it('sends local email through SMTP with a deterministic provider message ID', async () => {
    const sendMail = vi.fn().mockResolvedValue({
      accepted: ['customer@example.com'],
      rejected: [],
      messageId: '<provider-message@example.test>',
    });
    const adapter = new ProviderNeutralNotificationAdapter(localSmtpEnvironment(), {
      smtpTransport: { sendMail },
    });

    await expect(
      adapter.send({
        notificationId: 'notification-a',
        channel: 'EMAIL',
        event: 'PASSWORD_RESET',
        locale: 'fr-TN',
        recipient: 'customer@example.com',
        subject: 'Reset',
        body: 'Safe body',
        providerIdempotencyKey: 'a'.repeat(64),
      }),
    ).resolves.toEqual({
      provider: 'smtp',
      providerMessageId: '<provider-message@example.test>',
    });
    const smtpRequest = sendMail.mock.calls[0]?.[0] as {
      to: string;
      messageId: string;
      headers: Record<string, string>;
    };
    expect(smtpRequest.to).toBe('customer@example.com');
    expect(smtpRequest.messageId).toBe(`<${'a'.repeat(64)}@local.test>`);
    expect(smtpRequest.headers['X-Idempotency-Key']).toBe('a'.repeat(64));
  });

  it('sends production SMS over HTTPS with auth and idempotency but no redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messageId: 'provider-sms-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = new ProviderNeutralNotificationAdapter(productionEnvironment(), {
      smtpTransport: { sendMail: vi.fn() },
      fetch: fetchMock,
    });

    await expect(
      adapter.send({
        notificationId: 'notification-a',
        channel: 'SMS',
        event: 'ORDER_CONFIRMED',
        locale: 'ar-TN',
        recipient: '+21620111222',
        body: 'تم تأكيد الطلب.',
        providerIdempotencyKey: 'b'.repeat(64),
      }),
    ).resolves.toEqual({
      provider: 'sms-https-webhook',
      providerMessageId: 'provider-sms-1',
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(request.headers).toMatchObject({
      authorization: `Bearer ${productionEnvironment().SMS_WEBHOOK_AUTH_TOKEN}`,
      'idempotency-key': 'b'.repeat(64),
    });
    expect(request.body).toContain('+21620111222');
  });

  it('fails closed without calling an SMS provider when SMS is disabled', async () => {
    const input = productionInput();
    input.SMS_ENABLED = 'false';
    delete input.SMS_WEBHOOK_URL;
    delete input.SMS_WEBHOOK_AUTH_TOKEN;
    const fetchMock = vi.fn();
    const adapter = new ProviderNeutralNotificationAdapter(parseWorkerEnvironment(input), {
      smtpTransport: { sendMail: vi.fn() },
      fetch: fetchMock,
    });

    expect(adapter.providerFor('SMS')).toBe('disabled');
    await expect(
      adapter.send({
        notificationId: 'notification-a',
        channel: 'SMS',
        event: 'ORDER_CONFIRMED',
        locale: 'fr-TN',
        recipient: '+21620111222',
        body: 'Commande confirmee.',
        providerIdempotencyKey: 'c'.repeat(64),
      }),
    ).rejects.toMatchObject({ safeCode: 'NOTIFICATION_CHANNEL_DISABLED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('notification outbox processing', () => {
  it('decrypts only for delivery, records success, and never logs recipient or reset token', async () => {
    const claim = claimTransaction();
    const result = resultTransaction();
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementationOnce(async (callback: (value: typeof claim) => Promise<unknown>) =>
          callback(claim),
        )
        .mockImplementationOnce(async (callback: (value: typeof result) => Promise<unknown>) =>
          callback(result),
        ),
    };
    const repository = { scheduleRetry: vi.fn() };
    const send = vi.fn().mockResolvedValue({ provider: 'smtp', providerMessageId: '<message-a>' });
    const adapter: NotificationAdapter = {
      providerFor: vi.fn().mockReturnValue('smtp'),
      send,
    };
    const log = logger();
    const processor = new OutboxProcessor(
      prisma as never,
      repository as never,
      localSmtpEnvironment(),
      log as never,
      adapter,
    );

    await processor.process({
      outboxEventId: 'event-a',
      eventType: OUTBOX_EVENT_TYPES.NOTIFICATION_DISPATCH,
      eventVersion: 1,
    });

    const prepared = send.mock.calls[0]?.[0] as PreparedNotificationMessage;
    expect(prepared.recipient).toBe('customer@example.com');
    expect(prepared.body).toContain('/password-reset/confirm?token=');
    expect(prepared.providerIdempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    const notificationUpdate = result.notification.update.mock.calls[0]?.[0] as {
      data: { status: string };
    };
    expect(notificationUpdate.data.status).toBe('DELIVERED');
    const attemptUpdate = result.notificationDeliveryAttempt.updateMany.mock.calls[0]?.[0] as {
      data: { status: string; providerMessageId: string };
    };
    expect(attemptUpdate.data).toMatchObject({
      status: 'DELIVERED',
      providerMessageId: '<message-a>',
    });
    const outboxUpdate = result.outboxEvent.update.mock.calls[0]?.[0] as {
      data: { status: string };
    };
    expect(outboxUpdate.data.status).toBe('PROCESSED');
    const logs = JSON.stringify({ info: log.info.mock.calls, warn: log.warn.mock.calls });
    expect(logs).not.toContain('customer@example.com');
    expect(logs).not.toContain('reset-token-value');
    expect(logs).not.toContain(notificationRow().encryptedRecipient);
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
  });

  it('records a retryable provider failure on the attempt, notification, and outbox', async () => {
    const claim = claimTransaction(
      eventRow({ attemptCount: 2, maxAttempts: 4 }),
      notificationRow({
        event: 'ORDER_CONFIRMED',
        channel: 'SMS',
        encryptedRecipient: encryptField('+21620111222'),
        payload: { orderNumber: 'TJ-2026-00000001' },
      }),
    );
    const result = resultTransaction(
      eventRow({ status: 'PROCESSING', attemptCount: 2, maxAttempts: 4 }),
    );
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementationOnce(async (callback: (value: typeof claim) => Promise<unknown>) =>
          callback(claim),
        )
        .mockImplementationOnce(async (callback: (value: typeof result) => Promise<unknown>) =>
          callback(result),
        ),
    };
    const adapter: NotificationAdapter = {
      providerFor: vi.fn().mockReturnValue('console-development'),
      send: vi.fn().mockRejectedValue(new WorkerDomainError('SMS_PROVIDER_RETRYABLE')),
    };
    const processor = new OutboxProcessor(
      prisma as never,
      { scheduleRetry: vi.fn() } as never,
      localSmtpEnvironment(),
      logger() as never,
      adapter,
    );

    await processor.process({
      outboxEventId: 'event-a',
      eventType: OUTBOX_EVENT_TYPES.NOTIFICATION_DISPATCH,
      eventVersion: 1,
    });

    const attemptUpdate = result.notificationDeliveryAttempt.updateMany.mock.calls[0]?.[0] as {
      data: { status: string; safeErrorCode: string; nextRetryAt: Date };
    };
    expect(attemptUpdate.data).toMatchObject({
      status: 'FAILED',
      safeErrorCode: 'SMS_PROVIDER_RETRYABLE',
    });
    expect(attemptUpdate.data.nextRetryAt).toBeInstanceOf(Date);
    const notificationUpdate = result.notification.update.mock.calls[0]?.[0] as {
      data: { status: string };
    };
    expect(notificationUpdate.data.status).toBe('FAILED');
    const outboxUpdate = result.outboxEvent.update.mock.calls[0]?.[0] as {
      data: { status: string; availableAt: Date };
    };
    expect(outboxUpdate.data.status).toBe('RETRY');
    expect(outboxUpdate.data.availableAt).toBeInstanceOf(Date);
  });

  it('dead-letters both records when the final provider attempt fails', async () => {
    const claim = claimTransaction(eventRow({ attemptCount: 3, maxAttempts: 3 }));
    const result = resultTransaction(
      eventRow({ status: 'PROCESSING', attemptCount: 3, maxAttempts: 3 }),
    );
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementationOnce(async (callback: (value: typeof claim) => Promise<unknown>) =>
          callback(claim),
        )
        .mockImplementationOnce(async (callback: (value: typeof result) => Promise<unknown>) =>
          callback(result),
        ),
    };
    const adapter: NotificationAdapter = {
      providerFor: vi.fn().mockReturnValue('smtp'),
      send: vi.fn().mockRejectedValue(new WorkerDomainError('EMAIL_PROVIDER_FAILED')),
    };
    const processor = new OutboxProcessor(
      prisma as never,
      { scheduleRetry: vi.fn() } as never,
      localSmtpEnvironment(),
      logger() as never,
      adapter,
    );

    await processor.process({
      outboxEventId: 'event-a',
      eventType: OUTBOX_EVENT_TYPES.NOTIFICATION_DISPATCH,
      eventVersion: 1,
    });

    const attemptUpdate = result.notificationDeliveryAttempt.updateMany.mock.calls[0]?.[0] as {
      data: { status: string };
    };
    expect(attemptUpdate.data.status).toBe('DEAD_LETTER');
    const notificationUpdate = result.notification.update.mock.calls[0]?.[0] as {
      data: { status: string };
    };
    expect(notificationUpdate.data.status).toBe('DEAD_LETTER');
    const outboxUpdate = result.outboxEvent.update.mock.calls[0]?.[0] as {
      data: { status: string };
    };
    expect(outboxUpdate.data.status).toBe('DEAD_LETTER');
  });

  it('treats an already delivered notification as an idempotent no-op', async () => {
    const claim = claimTransaction(eventRow(), notificationRow({ status: 'DELIVERED' }));
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof claim) => Promise<unknown>) =>
        callback(claim),
      ),
    };
    const send = vi.fn();
    const adapter: NotificationAdapter = {
      providerFor: vi.fn(),
      send,
    };
    const processor = new OutboxProcessor(
      prisma as never,
      { scheduleRetry: vi.fn() } as never,
      localSmtpEnvironment(),
      logger() as never,
      adapter,
    );

    await processor.process({
      outboxEventId: 'event-a',
      eventType: OUTBOX_EVENT_TYPES.NOTIFICATION_DISPATCH,
      eventVersion: 1,
    });

    expect(send).not.toHaveBeenCalled();
    expect(claim.notificationDeliveryAttempt.create).not.toHaveBeenCalled();
    const outboxUpdate = claim.outboxEvent.update.mock.calls[0]?.[0] as {
      data: { status: string };
    };
    expect(outboxUpdate.data.status).toBe('PROCESSED');
  });

  it('cancels queued SMS cleanly when the channel is disabled', async () => {
    const claim = claimTransaction(
      eventRow(),
      notificationRow({
        event: 'ORDER_CONFIRMED',
        channel: 'SMS',
        encryptedRecipient: 'must-not-be-decrypted',
        payload: { orderNumber: 'TJ-2026-00000001' },
      }),
    );
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof claim) => Promise<unknown>) =>
        callback(claim),
      ),
    };
    const send = vi.fn();
    const adapter: NotificationAdapter = {
      providerFor: vi.fn().mockReturnValue('disabled'),
      send,
    };
    const repository = { scheduleRetry: vi.fn() };
    const processor = new OutboxProcessor(
      prisma as never,
      repository as never,
      localSmtpEnvironment(),
      logger() as never,
      adapter,
    );

    await processor.process({
      outboxEventId: 'event-a',
      eventType: OUTBOX_EVENT_TYPES.NOTIFICATION_DISPATCH,
      eventVersion: 1,
    });

    expect(send).not.toHaveBeenCalled();
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
    expect(claim.notificationDeliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notificationId: 'notification-a',
        provider: 'disabled',
        status: 'CANCELLED',
        safeErrorCode: 'NOTIFICATION_CHANNEL_DISABLED',
      }) as object,
    });
    expect(claim.notification.update).toHaveBeenCalledWith({
      where: { id: 'notification-a' },
      data: { status: 'CANCELLED' },
    });
    expect(claim.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-a' },
      data: expect.objectContaining({
        status: 'PROCESSED',
        safeErrorCode: 'NOTIFICATION_CHANNEL_DISABLED',
      }) as object,
    });
  });
});
