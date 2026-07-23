import { Injectable, NotFoundException } from '@nestjs/common';
import type { LegalDocumentType, Prisma } from '@prisma/client';
import type { StorefrontLocale } from '../catalog/catalog.service';
import { PrismaService } from '../database/prisma.service';

const publishedVersionSelect = {
  version: true,
  title: true,
  content: true,
  publishedAt: true,
} satisfies Prisma.LegalDocumentVersionSelect;

type PublishedVersion = Prisma.LegalDocumentVersionGetPayload<{
  select: typeof publishedVersionSelect;
}>;

@Injectable()
export class StorefrontContentService {
  constructor(private readonly prisma: PrismaService) {}

  async legalDocument(slug: string, locale: StorefrontLocale) {
    const document = await this.findPublished(slug, locale, { not: 'OTHER' });
    if (!document) {
      throw new NotFoundException({
        code: 'LEGAL_DOCUMENT_NOT_FOUND',
        message: 'The requested legal document is not available.',
      });
    }
    return {
      data: {
        slug: document.slug,
        title: document.version.title,
        version: String(document.version.version),
        publishedAt: document.version.publishedAt!.toISOString(),
        content: document.version.content,
      },
    };
  }

  async operatorContent(slug: string, locale: StorefrontLocale) {
    const document = await this.findPublished(slug, locale, 'OTHER');
    if (!document) {
      throw new NotFoundException({
        code: 'STOREFRONT_CONTENT_NOT_FOUND',
        message: 'The requested storefront content is not available.',
      });
    }
    return {
      data: {
        title: document.version.title,
        content: document.version.content,
      },
    };
  }

  private async findPublished(
    slug: string,
    locale: StorefrontLocale,
    type: LegalDocumentType | { not: LegalDocumentType },
  ): Promise<{ slug: string; version: PublishedVersion } | null> {
    const now = new Date();
    const document = await this.prisma.legalDocument.findFirst({
      where: { slug, locale, type },
      select: {
        slug: true,
        versions: {
          where: {
            status: 'PUBLISHED',
            publishedAt: { lte: now },
            OR: [{ effectiveAt: null }, { effectiveAt: { lte: now } }],
          },
          orderBy: [{ version: 'desc' }, { id: 'desc' }],
          take: 1,
          select: publishedVersionSelect,
        },
      },
    });
    const version = document?.versions[0];
    return document && version?.publishedAt ? { slug: document.slug, version } : null;
  }
}
