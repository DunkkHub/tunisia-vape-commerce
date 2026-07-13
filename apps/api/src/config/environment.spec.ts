import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment';

describe('launch environment defaults', () => {
  it('uses the approved open launch flags while retaining operational policy gates', () => {
    const environment = validateEnvironment({});

    expect(environment).toMatchObject({
      CHECKOUT_ENABLED: true,
      LEGAL_REVIEW_COMPLETED: true,
      MAINTENANCE_MODE: false,
      PRELAUNCH_MODE: false,
      MINIMUM_PURCHASE_AGE: 18,
      HEALTHCHECK_TIMEOUT_MS: 2_000,
      WORKER_HEARTBEAT_MAX_AGE_SECONDS: 60,
      EXPECTED_MIGRATION_NAME: '20260713010000_durable_outbox',
    });
  });
});
