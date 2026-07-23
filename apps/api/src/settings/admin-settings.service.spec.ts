import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AdminSettingsService } from './admin-settings.service';

const request = {
  auth: { userId: 'admin-user-1' },
  requestId: 'request-1',
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
  get: vi.fn((name: string) => (name === 'user-agent' ? 'settings-export-test' : undefined)),
} as unknown as Request;

const transaction = (storeRows: unknown[], complianceRows: unknown[]) => ({
  storeSetting: { findMany: vi.fn().mockResolvedValue(storeRows) },
  complianceSetting: { findMany: vi.fn().mockResolvedValue(complianceRows) },
  auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
});

const serviceFor = (database: ReturnType<typeof transaction>) =>
  new AdminSettingsService({
    $transaction: vi.fn((operation: (client: typeof database) => unknown) =>
      Promise.resolve(operation(database)),
    ),
  } as never);

describe('administrator settings configuration export', () => {
  it('returns a deterministic bounded document and excludes marked or defensively sensitive values', async () => {
    const database = transaction(
      [
        {
          id: 'store-1',
          key: 'checkout.enabled',
          valueType: 'BOOLEAN',
          value: true,
          secret: false,
        },
        {
          id: 'store-2',
          key: 'smtp.password',
          valueType: 'STRING',
          value: 'must-not-leak',
          secret: false,
        },
        {
          id: 'store-3',
          key: 'provider.value',
          valueType: 'STRING',
          value: 'also-must-not-leak',
          secret: true,
        },
        {
          id: 'store-4',
          key: 'public.presentation',
          valueType: 'JSON',
          value: { zeta: 1, alpha: { zebra: 2, beta: 3 } },
          secret: false,
        },
      ],
      [
        {
          id: 'compliance-1',
          key: 'minimum_purchase_age',
          valueType: 'INTEGER',
          value: 18,
        },
        {
          id: 'compliance-2',
          key: 'vendor.api_key',
          valueType: 'STRING',
          value: 'must-not-leak',
        },
      ],
    );

    const response = await serviceFor(database).exportConfiguration(request);
    const { checksumSha256, ...document } = response.data;

    expect(document).toEqual({
      format: 'tunisia-vape-store-configuration',
      schemaVersion: 1,
      store: [
        { key: 'checkout.enabled', valueType: 'BOOLEAN', value: true },
        {
          key: 'public.presentation',
          valueType: 'JSON',
          value: { alpha: { beta: 3, zebra: 2 }, zeta: 1 },
        },
      ],
      compliance: [{ key: 'minimum_purchase_age', valueType: 'INTEGER', value: 18 }],
      excludedSecretCount: 3,
    });
    expect(JSON.stringify(response)).not.toContain('must-not-leak');
    expect(checksumSha256).toBe(
      createHash('sha256').update(JSON.stringify(document)).digest('hex'),
    );
    expect(database.auditLog.create).toHaveBeenCalledOnce();
    const auditInput: unknown = database.auditLog.create.mock.calls[0]?.[0];
    expect(auditInput).toMatchObject({
      data: {
        actorUserId: 'admin-user-1',
        action: 'store.configuration.export',
        resourceType: 'StoreConfiguration',
        resourceId: 'safe-settings-v1',
        afterSummary: {
          storeSettingCount: 2,
          complianceSettingCount: 1,
          excludedSecretCount: 3,
          checksumSha256,
        },
      },
    });
  });

  it('fails closed before export and audit when either scope exceeds its record bound', async () => {
    const storeRows = Array.from({ length: 501 }, (_, index) => ({
      id: `store-${index}`,
      key: `public.setting.${index}`,
      valueType: 'BOOLEAN',
      value: true,
      secret: false,
    }));
    const database = transaction(storeRows, []);

    await expect(serviceFor(database).exportConfiguration(request)).rejects.toMatchObject({
      response: { code: 'SETTINGS_EXPORT_TOO_LARGE' },
    });
    expect(database.auditLog.create).not.toHaveBeenCalled();
  });
});
