import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service';
import { StorefrontContentService } from './storefront-content.service';

const publishedVersion = {
  version: 3,
  title: 'Current title',
  content: 'Current published content',
  publishedAt: new Date('2026-07-20T09:00:00Z'),
};

describe('public storefront content service', () => {
  it('returns only a published, effective, locale-matched legal-document version', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      slug: 'terms',
      versions: [publishedVersion],
    });
    const service = new StorefrontContentService({
      legalDocument: { findFirst },
    } as unknown as PrismaService);

    const result = await service.legalDocument('terms', 'fr');

    const query = findFirst.mock.calls[0]![0] as {
      where: unknown;
      select: { versions: { where: unknown; take: number } };
    };
    expect(query.where).toEqual({ slug: 'terms', locale: 'fr', type: { not: 'OTHER' } });
    expect(query.select.versions.where).toMatchObject({
      status: 'PUBLISHED',
      publishedAt: { lte: expect.any(Date) as Date },
      OR: [{ effectiveAt: null }, { effectiveAt: { lte: expect.any(Date) as Date } }],
    });
    expect(query.select.versions.take).toBe(1);
    expect(result.data).toEqual({
      slug: 'terms',
      title: 'Current title',
      version: '3',
      publishedAt: '2026-07-20T09:00:00.000Z',
      content: 'Current published content',
    });
  });

  it('uses type OTHER for operator-managed help content without creating a fallback document', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      slug: 'faq',
      versions: [publishedVersion],
    });
    const service = new StorefrontContentService({
      legalDocument: { findFirst },
    } as unknown as PrismaService);

    const result = await service.operatorContent('faq', 'ar');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'faq', locale: 'ar', type: 'OTHER' } }),
    );
    expect(result.data).toEqual({
      title: 'Current title',
      content: 'Current published content',
    });
  });

  it('returns a stable not-found response when no currently effective version exists', async () => {
    const service = new StorefrontContentService({
      legalDocument: {
        findFirst: vi.fn().mockResolvedValue({ slug: 'privacy', versions: [] }),
      },
    } as unknown as PrismaService);

    const error = await service.legalDocument('privacy', 'fr').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toEqual({
      code: 'LEGAL_DOCUMENT_NOT_FOUND',
      message: 'The requested legal document is not available.',
    });
  });
});
