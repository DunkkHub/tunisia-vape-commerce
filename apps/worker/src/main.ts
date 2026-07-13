import { Queue, Worker, type Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { bullConnectionFromUrl, parseWorkerEnvironment } from './environment.js';
import { outboxJobSchema, safeErrorCode } from './outbox-contracts.js';
import { OutboxProcessor } from './outbox-processor.js';
import { OutboxPublisher, type OutboxJobData } from './outbox-publisher.js';
import { OutboxRepository } from './outbox-repository.js';
import { OutboxSources } from './outbox-sources.js';

const environment = parseWorkerEnvironment(process.env);
const logger = pino({
  level: environment.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      'token',
      'cookie',
      'authorization',
      '*.password',
      '*.token',
      '*.cookie',
      '*.authorization',
      'job.data.payload',
      'payload',
    ],
    censor: '[REDACTED]',
  },
});
const prisma = new PrismaClient();
const connection = bullConnectionFromUrl(environment.REDIS_URL);
const queue = new Queue<OutboxJobData>(environment.OUTBOX_QUEUE_NAME, { connection });
const repository = new OutboxRepository(
  prisma,
  environment.WORKER_INSTANCE_ID,
  environment.OUTBOX_BATCH_SIZE,
  environment.OUTBOX_LEASE_MS,
  environment.OUTBOX_PUBLISHED_LEASE_MS,
  environment.OUTBOX_RETRY_BASE_MS,
  environment.OUTBOX_RETRY_MAX_MS,
);
const processor = new OutboxProcessor(prisma, repository, environment, logger);
const publisher = new OutboxPublisher(repository, queue, logger);
const sources = new OutboxSources(prisma, environment);

const worker = new Worker<OutboxJobData>(
  environment.OUTBOX_QUEUE_NAME,
  async (job: Job<OutboxJobData>) => {
    const data = outboxJobSchema.parse(job.data);
    await processor.process(data);
  },
  {
    connection,
    concurrency: environment.OUTBOX_CONCURRENCY,
    lockDuration: environment.OUTBOX_LEASE_MS,
    limiter: { max: 100, duration: 1_000 },
  },
);

let stopping = false;
let pollInProgress = false;
let sourceInProgress = false;
let lastPollSucceeded = true;
let pollTimer: NodeJS.Timeout | undefined;
let sourceTimer: NodeJS.Timeout | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;

const poll = async (): Promise<void> => {
  if (stopping || pollInProgress) return;
  pollInProgress = true;
  try {
    await publisher.pollOnce();
    lastPollSucceeded = true;
  } catch (error) {
    lastPollSucceeded = false;
    logger.error({ errorCode: safeErrorCode(error) }, 'Outbox poll failed');
  } finally {
    pollInProgress = false;
  }
};

const scheduleSources = async (): Promise<void> => {
  if (stopping || sourceInProgress) return;
  sourceInProgress = true;
  try {
    await sources.enqueueScheduledWork();
  } catch (error) {
    logger.error({ errorCode: safeErrorCode(error) }, 'Outbox source scheduling failed');
  } finally {
    sourceInProgress = false;
  }
};

const heartbeat = async (): Promise<void> => {
  if (stopping) return;
  try {
    await prisma.systemHealthRecord.create({
      data: {
        component: 'durable-outbox-worker',
        instanceId: environment.WORKER_INSTANCE_ID,
        status: lastPollSucceeded && worker.isRunning() ? 'HEALTHY' : 'DEGRADED',
        details: {
          schemaVersion: 1,
          queue: environment.OUTBOX_QUEUE_NAME,
          polling: !pollInProgress,
          sourceScheduling: !sourceInProgress,
          notificationAdapter: environment.NOTIFICATION_ADAPTER,
        },
      },
    });
  } catch (error) {
    logger.error({ errorCode: safeErrorCode(error) }, 'Worker heartbeat failed');
  }
};

worker.on('completed', (job) =>
  logger.debug({ jobId: job.id, outboxEventId: job.data.outboxEventId }, 'Outbox job completed'),
);
worker.on('failed', (job, error) =>
  logger.error(
    {
      jobId: job?.id,
      outboxEventId: job?.data.outboxEventId,
      errorCode: safeErrorCode(error),
    },
    'Outbox job failed before durable retry scheduling',
  ),
);
worker.on('error', (error) =>
  logger.error({ errorCode: safeErrorCode(error) }, 'Outbox worker error'),
);

const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  if (pollTimer) clearInterval(pollTimer);
  if (sourceTimer) clearInterval(sourceTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  logger.info({ signal }, 'Durable outbox worker shutting down');
  const drainDeadline = Date.now() + 5_000;
  while ((pollInProgress || sourceInProgress) && Date.now() < drainDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await worker.close();
  await queue.close();
  await prisma.$disconnect();
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

const start = async (): Promise<void> => {
  await prisma.$connect();
  await queue.waitUntilReady();
  await scheduleSources();
  await poll();
  await heartbeat();
  pollTimer = setInterval(() => void poll(), environment.OUTBOX_POLL_INTERVAL_MS);
  sourceTimer = setInterval(
    () => void scheduleSources(),
    environment.RESERVATION_EXPIRY_INTERVAL_MS,
  );
  heartbeatTimer = setInterval(() => void heartbeat(), environment.WORKER_HEARTBEAT_INTERVAL_MS);
  logger.info(
    {
      component: 'durable-outbox-worker',
      instanceId: environment.WORKER_INSTANCE_ID,
      queue: environment.OUTBOX_QUEUE_NAME,
      notificationAdapter: environment.NOTIFICATION_ADAPTER,
    },
    'Durable outbox worker started',
  );
};

void start().catch(async (error: unknown) => {
  logger.fatal({ errorCode: safeErrorCode(error) }, 'Durable outbox worker startup failed');
  if (pollTimer) clearInterval(pollTimer);
  if (sourceTimer) clearInterval(sourceTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  await worker.close(true).catch(() => undefined);
  await queue.close().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
