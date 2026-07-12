import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { z } from 'zod';

const environmentSchema = z.object({
  REDIS_URL: z.url().default('redis://localhost:6379'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SMS_PROVIDER: z.enum(['console', 'disabled']).default('console'),
});

const environment = environmentSchema.parse(process.env);
const logger = pino({
  level: environment.LOG_LEVEL,
  redact: ['job.data.password', 'job.data.token'],
});
const redisUrl = new URL(environment.REDIS_URL);
const connection = {
  host: redisUrl.hostname,
  port: Number.parseInt(redisUrl.port || '6379', 10),
  ...(redisUrl.username ? { username: decodeURIComponent(redisUrl.username) } : {}),
  ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
  ...(redisUrl.pathname.length > 1 ? { db: Number.parseInt(redisUrl.pathname.slice(1), 10) } : {}),
  ...(redisUrl.protocol === 'rediss:' ? { tls: {} } : {}),
};

interface NotificationJob {
  notificationId: string;
  channel: 'email' | 'sms';
  recipient: string;
  template: string;
  locale: 'fr' | 'ar';
}

const handleNotification = (job: Job<NotificationJob>): Promise<void> => {
  const safeRecipient = job.data.recipient.replace(/(^.).+(@.*$)/, '$1***$2');
  logger.info(
    {
      jobId: job.id,
      notificationId: job.data.notificationId,
      channel: job.data.channel,
      template: job.data.template,
      recipient: safeRecipient,
    },
    'Processing notification',
  );

  if (job.data.channel === 'sms' && environment.SMS_PROVIDER === 'disabled') {
    throw new Error('SMS adapter is disabled');
  }
  return Promise.resolve();
};

const worker = new Worker<NotificationJob>('notifications', handleNotification, {
  connection,
  concurrency: 10,
  limiter: { max: 100, duration: 1_000 },
});

worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Notification completed'));
worker.on('failed', (job, error) =>
  logger.error({ jobId: job?.id, error: error.message }, 'Notification failed'),
);
worker.on('error', (error) => logger.error({ error: error.message }, 'Worker error'));

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Worker shutting down');
  await worker.close();
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info('Notification worker started');
