import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { deterministicJobId, parseEventPayload, safeErrorCode } from './outbox-contracts.js';
import type { OutboxRepository } from './outbox-repository.js';

export interface OutboxJobData {
  outboxEventId: string;
  eventType: string;
  eventVersion: number;
}

export class OutboxPublisher {
  private polling = false;

  constructor(
    private readonly repository: OutboxRepository,
    private readonly queue: Queue<OutboxJobData>,
    private readonly logger: Logger,
  ) {}

  async pollOnce(now = new Date()): Promise<number> {
    if (this.polling) return 0;
    this.polling = true;
    try {
      const events = await this.repository.claimAvailable(now);
      for (const event of events) {
        const jobId = deterministicJobId(event.deterministicKey);
        try {
          parseEventPayload(event.eventType, event.eventVersion, event.payload);
          await this.queue.add(
            'outbox-event',
            {
              outboxEventId: event.id,
              eventType: event.eventType,
              eventVersion: event.eventVersion,
            },
            {
              jobId,
              attempts: 1,
              removeOnComplete: true,
              removeOnFail: true,
            },
          );
          await this.repository.markPublished(event.id, jobId);
          this.logger.debug(
            {
              outboxEventId: event.id,
              eventType: event.eventType,
              attemptCount: event.attemptCount,
              jobId,
            },
            'Outbox event published',
          );
        } catch (error) {
          const errorCode = safeErrorCode(error);
          const state = await this.repository.scheduleRetry(event.id, errorCode);
          this.logger.warn(
            {
              outboxEventId: event.id,
              eventType: event.eventType,
              attemptCount: event.attemptCount,
              errorCode,
              state,
            },
            'Outbox publication deferred',
          );
        }
      }
      return events.length;
    } finally {
      this.polling = false;
    }
  }
}
