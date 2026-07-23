import { ConflictException } from '@nestjs/common';
import { Prisma, PublicationStatus } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import { describe, expect, it, vi } from 'vitest';
import { AdminBrandsService, AdminCategoriesService } from './taxonomy.service';

const updatedAt = new Date('2026-07-13T02:00:00.000Z');
const context = {
  userId: 'admin-1',
  requestId: 'request-1',
  ipAddress: '127.0.0.1',
};

const brandRecord = (status: PublicationStatus = PublicationStatus.DRAFT) => ({
  id: 'brand-1',
  name: 'Brand',
  slug: 'brand',
  descriptionFr: null,
  descriptionAr: null,
  publicationStatus: status,
  suspendedAt: null,
  archivedAt: status === PublicationStatus.ARCHIVED ? updatedAt : null,
  deletedAt: null,
  createdAt: new Date('2026-07-13T01:00:00.000Z'),
  updatedAt,
  _count: { products: 0 },
});

const categoryRecord = (status: PublicationStatus = PublicationStatus.DRAFT) => ({
  id: 'category-1',
  parentId: null,
  nameFr: 'Category',
  nameAr: 'فئة',
  slug: 'category',
  descriptionFr: null,
  descriptionAr: null,
  sortOrder: 0,
  publicationStatus: status,
  suspendedAt: null,
  archivedAt: status === PublicationStatus.ARCHIVED ? updatedAt : null,
  deletedAt: null,
  createdAt: new Date('2026-07-13T01:00:00.000Z'),
  updatedAt,
  _count: { products: 0, children: 0 },
});

const responseCode = (error: unknown): string | undefined => {
  if (!(error instanceof ConflictException)) return undefined;
  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? String(response.code)
    : undefined;
};

describe('administrator taxonomy lifecycle', () => {
  it('creates brands as drafts and audits only a safe allowlist', async () => {
    const auditCreate = vi.fn().mockResolvedValue({});
    const transaction = {
      brand: {
        create: vi.fn().mockResolvedValue({ id: 'brand-1' }),
        findFirst: vi.fn().mockResolvedValue(brandRecord()),
      },
      auditLog: { create: auditCreate },
    };
    const service = new AdminBrandsService({
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService);

    const response = await service.create(
      {
        name: ' Brand ',
        slug: 'brand',
        descriptionFr: 'Description that must not be audited',
      },
      context,
    );

    const createInput = transaction.brand.create.mock.calls[0]![0] as {
      data: { publicationStatus: string; name: string };
    };
    expect(createInput.data).toMatchObject({ publicationStatus: 'DRAFT', name: 'Brand' });
    const auditInput = auditCreate.mock.calls[0]![0] as {
      data: { afterSummary: Record<string, unknown> };
    };
    expect(auditInput.data.afterSummary).toEqual({
      slug: 'brand',
      publicationStatus: 'DRAFT',
    });
    expect(response.data.publicationStatus).toBe(PublicationStatus.DRAFT);
  });

  it('refuses to archive a brand while a published product still references it', async () => {
    const transaction = {
      brand: { findFirst: vi.fn().mockResolvedValue(brandRecord(PublicationStatus.PUBLISHED)) },
      product: { count: vi.fn().mockResolvedValue(1) },
    };
    const service = new AdminBrandsService({
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService);

    const error = await service
      .archive('brand-1', updatedAt.toISOString(), context)
      .catch((caught: unknown) => caught);

    expect(responseCode(error)).toBe('BRAND_HAS_PUBLISHED_PRODUCTS');
  });

  it('uses expectedUpdatedAt in the write condition and returns a stable conflict', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const transaction = {
      brand: { findFirst: vi.fn().mockResolvedValue(brandRecord()), updateMany },
      product: { count: vi.fn().mockResolvedValue(0) },
    };
    const service = new AdminBrandsService({
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService);

    const error = await service
      .update('brand-1', { expectedUpdatedAt: updatedAt.toISOString(), name: 'Changed' }, context)
      .catch((caught: unknown) => caught);

    const updateInput = updateMany.mock.calls[0]![0] as { where: { updatedAt: Date } };
    expect(updateInput.where.updatedAt).toEqual(updatedAt);
    expect(responseCode(error)).toBe('BRAND_VERSION_CONFLICT');
  });

  it('maps database uniqueness failures to a stable brand slug conflict', async () => {
    const uniqueError = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '6.19.3',
    });
    const transaction = { brand: { create: vi.fn().mockRejectedValue(uniqueError) } };
    const service = new AdminBrandsService({
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService);

    const error = await service
      .create({ name: 'Brand', slug: 'brand' }, context)
      .catch((caught: unknown) => caught);

    expect(responseCode(error)).toBe('BRAND_SLUG_CONFLICT');
  });

  it('rejects category parent cycles before the update', async () => {
    const updateMany = vi.fn();
    const transaction = {
      category: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(categoryRecord())
          .mockResolvedValueOnce({ parentId: 'category-1' }),
        updateMany,
      },
    };
    const service = new AdminCategoriesService({
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService);

    const error = await service
      .update(
        'category-1',
        { expectedUpdatedAt: updatedAt.toISOString(), parentId: 'category-2' },
        context,
      )
      .catch((caught: unknown) => caught);

    expect(responseCode(error)).toBe('CATEGORY_PARENT_CYCLE');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses category archival while a published child remains', async () => {
    const transaction = {
      category: {
        findFirst: vi.fn().mockResolvedValue(categoryRecord(PublicationStatus.PUBLISHED)),
        count: vi.fn().mockResolvedValue(1),
      },
      product: { count: vi.fn().mockResolvedValue(0) },
    };
    const service = new AdminCategoriesService({
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService);

    const error = await service
      .archive('category-1', updatedAt.toISOString(), context)
      .catch((caught: unknown) => caught);

    expect(responseCode(error)).toBe('CATEGORY_HAS_PUBLISHED_CHILDREN');
  });
});
