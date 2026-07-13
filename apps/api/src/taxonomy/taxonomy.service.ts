import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { statusBecomesNonPublic, taxonomySortOrder } from './taxonomy-policy';
import type {
  CategoryListQueryDto,
  CreateBrandDto,
  CreateCategoryDto,
  MutableTaxonomyStatus,
  TaxonomyListQueryDto,
  UpdateBrandDto,
  UpdateCategoryDto,
} from './dto/taxonomy.dto';

export interface TaxonomyMutationContext {
  userId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const BRAND_SELECT = {
  id: true,
  name: true,
  slug: true,
  descriptionFr: true,
  descriptionAr: true,
  publicationStatus: true,
  suspendedAt: true,
  archivedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: { where: { deletedAt: null } } } },
} as const satisfies Prisma.BrandSelect;

const CATEGORY_SELECT = {
  id: true,
  parentId: true,
  nameFr: true,
  nameAr: true,
  slug: true,
  descriptionFr: true,
  descriptionAr: true,
  sortOrder: true,
  publicationStatus: true,
  suspendedAt: true,
  archivedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      products: { where: { deletedAt: null } },
      children: { where: { deletedAt: null } },
    },
  },
} as const satisfies Prisma.CategorySelect;

type BrandRecord = Prisma.BrandGetPayload<{ select: typeof BRAND_SELECT }>;
type CategoryRecord = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;
type Transaction = Prisma.TransactionClient;

const auditMetadata = (context: TaxonomyMutationContext) => ({
  actorUserId: context.userId,
  actorType: 'ADMIN' as const,
  outcome: 'SUCCESS' as const,
  requestId: context.requestId,
  ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
  ...(context.userAgent ? { userAgent: context.userAgent } : {}),
});

@Injectable()
export class AdminBrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: TaxonomyListQueryDto) {
    const search = query.q?.trim().replace(/\s+/g, ' ');
    const where: Prisma.BrandWhereInput = {
      deletedAt: null,
      ...(query.status ? { publicationStatus: query.status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { slug: { contains: search } },
              { descriptionFr: { contains: search } },
              { descriptionAr: { contains: search } },
            ],
          }
        : {}),
    };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.brand.findMany({
        where,
        orderBy: taxonomySortOrder(query.sort, 'name'),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: BRAND_SELECT,
      }),
      this.prisma.brand.count({ where }),
    ]);
    return pageResponse(records.map(brandResponse), query.page, query.limit, total);
  }

  async get(id: string) {
    const record = await this.prisma.brand.findFirst({
      where: { id, deletedAt: null },
      select: BRAND_SELECT,
    });
    if (!record) throw brandNotFound();
    return { data: brandResponse(record) };
  }

  async create(input: CreateBrandDto, context: TaxonomyMutationContext) {
    try {
      const record = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.brand.create({
          data: {
            name: input.name.trim(),
            slug: input.slug,
            descriptionFr: input.descriptionFr?.trim() || null,
            descriptionAr: input.descriptionAr?.trim() || null,
            publicationStatus: 'DRAFT',
          },
          select: { id: true },
        });
        await transaction.auditLog.create({
          data: {
            ...auditMetadata(context),
            action: 'catalog.brand.create',
            resourceType: 'Brand',
            resourceId: created.id,
            afterSummary: { slug: input.slug, publicationStatus: 'DRAFT' },
          },
        });
        return this.requireBrand(transaction, created.id);
      });
      return { data: brandResponse(record) };
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async update(id: string, input: UpdateBrandDto, context: TaxonomyMutationContext) {
    if (
      input.name === undefined &&
      input.slug === undefined &&
      input.descriptionFr === undefined &&
      input.descriptionAr === undefined &&
      input.publicationStatus === undefined
    ) {
      throw new BadRequestException({
        code: 'NO_BRAND_CHANGES',
        message: 'At least one brand field must be changed.',
      });
    }
    try {
      const record = await this.prisma.$transaction(
        async (transaction) => {
          const current = await this.requireBrand(transaction, id);
          assertExpectedTimestamp(current.updatedAt, input.expectedUpdatedAt, 'BRAND');
          if (current.publicationStatus === 'ARCHIVED') throw archivedBrand();
          const targetStatus = input.publicationStatus ?? current.publicationStatus;
          if (statusBecomesNonPublic(current.publicationStatus, targetStatus)) {
            await this.assertNoPublishedProducts(transaction, id);
          }
          const data: Prisma.BrandUpdateManyMutationInput = {
            ...(input.name === undefined ? {} : { name: input.name.trim() }),
            ...(input.slug === undefined ? {} : { slug: input.slug }),
            ...(input.descriptionFr === undefined
              ? {}
              : { descriptionFr: input.descriptionFr?.trim() || null }),
            ...(input.descriptionAr === undefined
              ? {}
              : { descriptionAr: input.descriptionAr?.trim() || null }),
            ...(input.publicationStatus ? publicationData(input.publicationStatus) : {}),
          };
          const updated = await transaction.brand.updateMany({
            where: {
              id,
              updatedAt: new Date(input.expectedUpdatedAt),
              deletedAt: null,
              publicationStatus: { not: 'ARCHIVED' },
            },
            data,
          });
          if (updated.count !== 1) throw versionConflict('BRAND');
          const changed = await this.requireBrand(transaction, id);
          await transaction.auditLog.create({
            data: {
              ...auditMetadata(context),
              action: 'catalog.brand.update',
              resourceType: 'Brand',
              resourceId: id,
              beforeSummary: brandAuditSummary(current),
              afterSummary: brandAuditSummary(changed),
            },
          });
          return changed;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return { data: brandResponse(record) };
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async archive(id: string, expectedUpdatedAt: string, context: TaxonomyMutationContext) {
    return this.changeArchiveState(id, expectedUpdatedAt, 'ARCHIVED', context);
  }

  async restore(id: string, expectedUpdatedAt: string, context: TaxonomyMutationContext) {
    return this.changeArchiveState(id, expectedUpdatedAt, 'DRAFT', context);
  }

  private async changeArchiveState(
    id: string,
    expectedUpdatedAt: string,
    target: 'ARCHIVED' | 'DRAFT',
    context: TaxonomyMutationContext,
  ) {
    const record = await this.prisma.$transaction(
      async (transaction) => {
        const current = await this.requireBrand(transaction, id);
        assertExpectedTimestamp(current.updatedAt, expectedUpdatedAt, 'BRAND');
        if (target === 'ARCHIVED') {
          if (current.publicationStatus === 'ARCHIVED') throw archivedBrand();
          await this.assertNoPublishedProducts(transaction, id);
        } else if (current.publicationStatus !== 'ARCHIVED') {
          throw new ConflictException({
            code: 'BRAND_NOT_ARCHIVED',
            message: 'Only an archived brand can be restored.',
          });
        }
        const updated = await transaction.brand.updateMany({
          where: { id, updatedAt: new Date(expectedUpdatedAt), deletedAt: null },
          data: {
            publicationStatus: target,
            archivedAt: target === 'ARCHIVED' ? new Date() : null,
            suspendedAt: null,
          },
        });
        if (updated.count !== 1) throw versionConflict('BRAND');
        const changed = await this.requireBrand(transaction, id);
        await transaction.auditLog.create({
          data: {
            ...auditMetadata(context),
            action: target === 'ARCHIVED' ? 'catalog.brand.archive' : 'catalog.brand.restore',
            resourceType: 'Brand',
            resourceId: id,
            beforeSummary: brandAuditSummary(current),
            afterSummary: brandAuditSummary(changed),
          },
        });
        return changed;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { data: brandResponse(record) };
  }

  private async assertNoPublishedProducts(transaction: Transaction, id: string): Promise<void> {
    const publishedProducts = await transaction.product.count({
      where: { brandId: id, publicationStatus: 'PUBLISHED', deletedAt: null },
    });
    if (publishedProducts > 0) {
      throw new ConflictException({
        code: 'BRAND_HAS_PUBLISHED_PRODUCTS',
        message: 'Unpublish every active product before making this brand non-public.',
      });
    }
  }

  private async requireBrand(transaction: Transaction, id: string): Promise<BrandRecord> {
    const record = await transaction.brand.findFirst({
      where: { id, deletedAt: null },
      select: BRAND_SELECT,
    });
    if (!record) throw brandNotFound();
    return record;
  }

  private rethrowUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException({
        code: 'BRAND_SLUG_CONFLICT',
        message: 'The brand slug is already assigned.',
      });
    }
    throw error;
  }
}

@Injectable()
export class AdminCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: CategoryListQueryDto) {
    const search = query.q?.trim().replace(/\s+/g, ' ');
    const where: Prisma.CategoryWhereInput = {
      deletedAt: null,
      ...(query.status ? { publicationStatus: query.status } : {}),
      ...(query.parentId ? { parentId: query.parentId } : {}),
      ...(search
        ? {
            OR: [
              { nameFr: { contains: search } },
              { nameAr: { contains: search } },
              { slug: { contains: search } },
              { descriptionFr: { contains: search } },
              { descriptionAr: { contains: search } },
            ],
          }
        : {}),
    };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        where,
        orderBy: taxonomySortOrder(query.sort, 'nameFr'),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: CATEGORY_SELECT,
      }),
      this.prisma.category.count({ where }),
    ]);
    return pageResponse(records.map(categoryResponse), query.page, query.limit, total);
  }

  async get(id: string) {
    const record = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
      select: CATEGORY_SELECT,
    });
    if (!record) throw categoryNotFound();
    return { data: categoryResponse(record) };
  }

  async create(input: CreateCategoryDto, context: TaxonomyMutationContext) {
    try {
      const record = await this.prisma.$transaction(
        async (transaction) => {
          if (input.parentId) await this.requireEligibleParent(transaction, input.parentId, false);
          const created = await transaction.category.create({
            data: {
              parentId: input.parentId ?? null,
              nameFr: input.nameFr.trim(),
              nameAr: input.nameAr.trim(),
              slug: input.slug,
              descriptionFr: input.descriptionFr?.trim() || null,
              descriptionAr: input.descriptionAr?.trim() || null,
              sortOrder: input.sortOrder ?? 0,
              publicationStatus: 'DRAFT',
            },
            select: { id: true },
          });
          await transaction.auditLog.create({
            data: {
              ...auditMetadata(context),
              action: 'catalog.category.create',
              resourceType: 'Category',
              resourceId: created.id,
              afterSummary: {
                slug: input.slug,
                parentId: input.parentId ?? null,
                publicationStatus: 'DRAFT',
              },
            },
          });
          return this.requireCategory(transaction, created.id);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return { data: categoryResponse(record) };
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async update(id: string, input: UpdateCategoryDto, context: TaxonomyMutationContext) {
    if (
      input.parentId === undefined &&
      input.nameFr === undefined &&
      input.nameAr === undefined &&
      input.slug === undefined &&
      input.descriptionFr === undefined &&
      input.descriptionAr === undefined &&
      input.sortOrder === undefined &&
      input.publicationStatus === undefined
    ) {
      throw new BadRequestException({
        code: 'NO_CATEGORY_CHANGES',
        message: 'At least one category field must be changed.',
      });
    }
    try {
      const record = await this.prisma.$transaction(
        async (transaction) => {
          const current = await this.requireCategory(transaction, id);
          assertExpectedTimestamp(current.updatedAt, input.expectedUpdatedAt, 'CATEGORY');
          if (current.publicationStatus === 'ARCHIVED') throw archivedCategory();
          const targetStatus = input.publicationStatus ?? current.publicationStatus;
          const parentId = input.parentId === undefined ? current.parentId : input.parentId;
          if (parentId === id) {
            throw new ConflictException({
              code: 'CATEGORY_PARENT_SELF',
              message: 'A category cannot be its own parent.',
            });
          }
          if (input.parentId !== undefined && parentId) {
            await this.assertNoParentCycle(transaction, id, parentId);
          }
          if (parentId) {
            await this.requireEligibleParent(transaction, parentId, targetStatus === 'PUBLISHED');
          }
          if (statusBecomesNonPublic(current.publicationStatus, targetStatus)) {
            await this.assertNoPublishedDependents(transaction, id);
          }
          const data: Prisma.CategoryUncheckedUpdateManyInput = {
            ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
            ...(input.nameFr === undefined ? {} : { nameFr: input.nameFr.trim() }),
            ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr.trim() }),
            ...(input.slug === undefined ? {} : { slug: input.slug }),
            ...(input.descriptionFr === undefined
              ? {}
              : { descriptionFr: input.descriptionFr?.trim() || null }),
            ...(input.descriptionAr === undefined
              ? {}
              : { descriptionAr: input.descriptionAr?.trim() || null }),
            ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
            ...(input.publicationStatus ? publicationData(input.publicationStatus) : {}),
          };
          const updated = await transaction.category.updateMany({
            where: {
              id,
              updatedAt: new Date(input.expectedUpdatedAt),
              deletedAt: null,
              publicationStatus: { not: 'ARCHIVED' },
            },
            data,
          });
          if (updated.count !== 1) throw versionConflict('CATEGORY');
          const changed = await this.requireCategory(transaction, id);
          await transaction.auditLog.create({
            data: {
              ...auditMetadata(context),
              action: 'catalog.category.update',
              resourceType: 'Category',
              resourceId: id,
              beforeSummary: categoryAuditSummary(current),
              afterSummary: categoryAuditSummary(changed),
            },
          });
          return changed;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return { data: categoryResponse(record) };
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async archive(id: string, expectedUpdatedAt: string, context: TaxonomyMutationContext) {
    return this.changeArchiveState(id, expectedUpdatedAt, 'ARCHIVED', context);
  }

  async restore(id: string, expectedUpdatedAt: string, context: TaxonomyMutationContext) {
    return this.changeArchiveState(id, expectedUpdatedAt, 'DRAFT', context);
  }

  private async changeArchiveState(
    id: string,
    expectedUpdatedAt: string,
    target: 'ARCHIVED' | 'DRAFT',
    context: TaxonomyMutationContext,
  ) {
    const record = await this.prisma.$transaction(
      async (transaction) => {
        const current = await this.requireCategory(transaction, id);
        assertExpectedTimestamp(current.updatedAt, expectedUpdatedAt, 'CATEGORY');
        if (target === 'ARCHIVED') {
          if (current.publicationStatus === 'ARCHIVED') throw archivedCategory();
          await this.assertNoPublishedDependents(transaction, id);
        } else if (current.publicationStatus !== 'ARCHIVED') {
          throw new ConflictException({
            code: 'CATEGORY_NOT_ARCHIVED',
            message: 'Only an archived category can be restored.',
          });
        }
        const updated = await transaction.category.updateMany({
          where: { id, updatedAt: new Date(expectedUpdatedAt), deletedAt: null },
          data: {
            publicationStatus: target,
            archivedAt: target === 'ARCHIVED' ? new Date() : null,
            suspendedAt: null,
          },
        });
        if (updated.count !== 1) throw versionConflict('CATEGORY');
        const changed = await this.requireCategory(transaction, id);
        await transaction.auditLog.create({
          data: {
            ...auditMetadata(context),
            action: target === 'ARCHIVED' ? 'catalog.category.archive' : 'catalog.category.restore',
            resourceType: 'Category',
            resourceId: id,
            beforeSummary: categoryAuditSummary(current),
            afterSummary: categoryAuditSummary(changed),
          },
        });
        return changed;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { data: categoryResponse(record) };
  }

  private async assertNoPublishedDependents(transaction: Transaction, id: string): Promise<void> {
    const [publishedProducts, publishedChildren] = await Promise.all([
      transaction.product.count({
        where: { categoryId: id, publicationStatus: 'PUBLISHED', deletedAt: null },
      }),
      transaction.category.count({
        where: { parentId: id, publicationStatus: 'PUBLISHED', deletedAt: null },
      }),
    ]);
    if (publishedProducts > 0) {
      throw new ConflictException({
        code: 'CATEGORY_HAS_PUBLISHED_PRODUCTS',
        message: 'Unpublish every active product before making this category non-public.',
      });
    }
    if (publishedChildren > 0) {
      throw new ConflictException({
        code: 'CATEGORY_HAS_PUBLISHED_CHILDREN',
        message: 'Unpublish every active child category before making this category non-public.',
      });
    }
  }

  private async assertNoParentCycle(
    transaction: Transaction,
    categoryId: string,
    requestedParentId: string,
  ): Promise<void> {
    let cursor: string | null = requestedParentId;
    const visited = new Set<string>();
    for (let depth = 0; cursor && depth < 100; depth += 1) {
      if (cursor === categoryId || visited.has(cursor)) {
        throw new ConflictException({
          code: 'CATEGORY_PARENT_CYCLE',
          message: 'The selected parent would create a category cycle.',
        });
      }
      visited.add(cursor);
      const parent: { parentId: string | null } | null = await transaction.category.findFirst({
        where: { id: cursor, deletedAt: null },
        select: { parentId: true },
      });
      if (!parent) throw categoryParentNotFound();
      cursor = parent.parentId;
    }
    if (cursor) {
      throw new ConflictException({
        code: 'CATEGORY_TREE_TOO_DEEP',
        message: 'The selected category hierarchy exceeds the supported depth.',
      });
    }
  }

  private async requireEligibleParent(
    transaction: Transaction,
    parentId: string,
    requirePublished: boolean,
  ): Promise<void> {
    const parent = await transaction.category.findFirst({
      where: { id: parentId, deletedAt: null },
      select: { publicationStatus: true },
    });
    if (!parent || parent.publicationStatus === 'ARCHIVED') throw categoryParentNotFound();
    if (requirePublished && parent.publicationStatus !== 'PUBLISHED') {
      throw new ConflictException({
        code: 'CATEGORY_PARENT_NOT_PUBLISHED',
        message: 'Publish the parent category before publishing this category.',
      });
    }
  }

  private async requireCategory(transaction: Transaction, id: string): Promise<CategoryRecord> {
    const record = await transaction.category.findFirst({
      where: { id, deletedAt: null },
      select: CATEGORY_SELECT,
    });
    if (!record) throw categoryNotFound();
    return record;
  }

  private rethrowUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException({
        code: 'CATEGORY_SLUG_CONFLICT',
        message: 'The category slug or sibling name is already assigned.',
      });
    }
    throw error;
  }
}

const publicationData = (
  target: MutableTaxonomyStatus,
): { publicationStatus: MutableTaxonomyStatus; suspendedAt: Date | null; archivedAt: null } => ({
  publicationStatus: target,
  suspendedAt: target === 'SUSPENDED' ? new Date() : null,
  archivedAt: null,
});

const assertExpectedTimestamp = (
  current: Date,
  expected: string,
  resource: 'BRAND' | 'CATEGORY',
): void => {
  if (current.getTime() !== new Date(expected).getTime()) throw versionConflict(resource);
};

const versionConflict = (resource: 'BRAND' | 'CATEGORY'): ConflictException =>
  new ConflictException({
    code: `${resource}_VERSION_CONFLICT`,
    message: 'The record changed. Refresh and try again.',
  });

const archivedBrand = (): ConflictException =>
  new ConflictException({
    code: 'BRAND_ARCHIVED',
    message: 'Restore the archived brand before changing it.',
  });

const archivedCategory = (): ConflictException =>
  new ConflictException({
    code: 'CATEGORY_ARCHIVED',
    message: 'Restore the archived category before changing it.',
  });

const categoryParentNotFound = (): ConflictException =>
  new ConflictException({
    code: 'CATEGORY_PARENT_NOT_FOUND',
    message: 'The selected parent category is unavailable.',
  });

const brandNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'BRAND_NOT_FOUND', message: 'The requested brand was not found.' });

const categoryNotFound = (): NotFoundException =>
  new NotFoundException({
    code: 'CATEGORY_NOT_FOUND',
    message: 'The requested category was not found.',
  });

const brandAuditSummary = (record: BrandRecord): Prisma.InputJsonObject => ({
  slug: record.slug,
  publicationStatus: record.publicationStatus,
  updatedAt: record.updatedAt.toISOString(),
});

const categoryAuditSummary = (record: CategoryRecord): Prisma.InputJsonObject => ({
  slug: record.slug,
  parentId: record.parentId,
  sortOrder: record.sortOrder,
  publicationStatus: record.publicationStatus,
  updatedAt: record.updatedAt.toISOString(),
});

const brandResponse = (record: BrandRecord) => ({
  id: record.id,
  name: record.name,
  slug: record.slug,
  descriptionFr: record.descriptionFr,
  descriptionAr: record.descriptionAr,
  publicationStatus: record.publicationStatus,
  productCount: record._count.products,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
});

const categoryResponse = (record: CategoryRecord) => ({
  id: record.id,
  parentId: record.parentId,
  nameFr: record.nameFr,
  nameAr: record.nameAr,
  slug: record.slug,
  descriptionFr: record.descriptionFr,
  descriptionAr: record.descriptionAr,
  sortOrder: record.sortOrder,
  publicationStatus: record.publicationStatus,
  productCount: record._count.products,
  childCount: record._count.children,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
});

const pageResponse = <T>(items: T[], page: number, pageSize: number, total: number) => ({
  data: { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
});
