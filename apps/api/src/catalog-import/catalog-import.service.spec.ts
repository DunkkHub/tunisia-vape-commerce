import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import type { CatalogImportRowInput } from './catalog-import-contract';
import { payloadHash } from './catalog-identity';
import { CatalogImportService } from './catalog-import.service';

const actor = {
  userId: 'administrator-1',
  requestId: 'request-1',
};

const options = {
  importKey: 'catalog-concurrent-apply-v1',
  format: 'JSON' as const,
  source: 'ADMIN_UPLOAD' as const,
  partialMode: false,
  overridePrice: false,
  overrideStatus: false,
  overrideImages: false,
};

const storedPayload = {
  schemaVersion: '1.0' as const,
  rows: [
    {
      rowNumber: 1,
      input: {} as CatalogImportRowInput,
      issues: [],
    },
  ],
};

const hash = payloadHash({ storedPayload, options });
const createdAt = new Date('2026-07-23T10:00:00.000Z');
const preview = {
  id: 'preview-batch',
  importKey: options.importKey,
  dryRun: true,
  payloadHash: hash,
  format: options.format,
  source: options.source,
  schemaVersion: '1.0',
  status: 'PREVIEW_VALID' as const,
  partialMode: false,
  overridePrice: false,
  overrideStatus: false,
  overrideImages: false,
  rowCount: 1,
  appliedCount: 0,
  payload: storedPayload as Prisma.InputJsonValue,
  result: {},
  previewBatchId: null,
  createdByUserId: actor.userId,
  createdAt,
  completedAt: createdAt,
  rolledBackAt: null,
};

const winner = {
  ...preview,
  id: 'applied-batch',
  dryRun: false,
  status: 'APPLIED_WITH_WARNINGS' as const,
  appliedCount: 1,
  previewBatchId: preview.id,
  rows: [],
};

const uniqueError = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate catalogue apply key', {
    code: 'P2002',
    clientVersion: '6.19.3',
  });

const serviceWithWinner = (appliedWinner: typeof winner | null) => {
  const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(appliedWinner);
  const transaction = vi.fn().mockRejectedValue(uniqueError());
  const service = new CatalogImportService({
    catalogImportBatch: {
      findFirst: vi.fn().mockResolvedValue(preview),
      findUnique,
    },
    $transaction: transaction,
  } as unknown as PrismaService);
  return { service, findUnique, transaction };
};

describe('CatalogImportService concurrent apply replay', () => {
  it('returns the committed matching winner after losing the apply-key race', async () => {
    const { service, findUnique, transaction } = serviceWithWinner(winner);

    await expect(service.apply(preview.id, actor)).resolves.toMatchObject({
      data: {
        id: winner.id,
        importKey: winner.importKey,
        payloadHash: hash,
        status: 'APPLIED_WITH_WARNINGS',
      },
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(findUnique).toHaveBeenLastCalledWith({
      where: { importKey_dryRun: { importKey: options.importKey, dryRun: false } },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
  });

  it('rejects a concurrently committed winner whose payload fingerprint differs', async () => {
    const { service } = serviceWithWinner({ ...winner, payloadHash: 'f'.repeat(64) });

    await expect(service.apply(preview.id, actor)).rejects.toMatchObject({
      response: { code: 'CATALOG_IMPORT_KEY_REUSED' },
    });
  });

  it('does not misclassify an unrelated unique failure as an idempotent replay', async () => {
    const { service } = serviceWithWinner(null);

    await expect(service.apply(preview.id, actor)).rejects.toMatchObject({
      response: { code: 'CATALOG_IMPORT_APPLY_FAILED' },
    });
  });
});
