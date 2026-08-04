import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { sanitizedRequestLog } from './app.module';

describe('HTTP request log sanitization', () => {
  it('removes OAuth codes, state and every other query value from logged URLs', () => {
    const request = {
      method: 'GET',
      url: '/api/v1/auth/customer/google/callback?code=secret-code&state=secret-state',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as IncomingMessage;

    const serialized = sanitizedRequestLog(request);

    expect(serialized.url).toBe('/api/v1/auth/customer/google/callback');
    expect(JSON.stringify(serialized)).not.toContain('secret-code');
    expect(JSON.stringify(serialized)).not.toContain('secret-state');
  });
});
