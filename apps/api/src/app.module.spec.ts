import { describe, expect, it } from 'vitest';
import pinoHttp from 'pino-http';
import { HTTP_LOG_REDACTION_PATHS } from './app.module';

describe('API HTTP log redaction', () => {
  it('redacts authentication, session, and CSRF request headers', () => {
    const output: string[] = [];
    const logger = pinoHttp(
      {
        redact: {
          paths: [...HTTP_LOG_REDACTION_PATHS],
          censor: '[REDACTED]',
        },
      },
      { write: (message) => output.push(message) },
    ).logger;

    logger.info({
      req: {
        headers: {
          authorization: 'authorization-secret',
          cookie: 'session-secret',
          'x-csrf-token': 'csrf-secret',
          accept: 'application/json',
        },
      },
    });

    expect(JSON.parse(output.at(-1)!) as Record<string, unknown>).toMatchObject({
      req: {
        headers: {
          authorization: '[REDACTED]',
          cookie: '[REDACTED]',
          'x-csrf-token': '[REDACTED]',
          accept: 'application/json',
        },
      },
    });
  });
});
