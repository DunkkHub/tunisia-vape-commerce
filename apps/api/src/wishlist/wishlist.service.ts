import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildPublicProductWhere } from '../catalog/catalog-policy';
import type { StorefrontLocale } from '../catalog/catalog.service';
import { PrismaService } from '../database/prisma.service';
import type { AddWishlistItemDto, WishlistQueryDto } from './dto/wishlist.dto';

const DEFAULT_WISHLIST_NAME = 'default';
const MAX_WISHLIST_ITEMS = 100;

const publicVariantWhere = (now: Date): Prisma.ProductVariantWhereInput => ({
  publicationStatus: 'PUBLISHED',
  archivedAt: null,
  deletedAt: null,
  priceMillimes: { gte: 0 },
  product: { is: buildPublicProductWhere({}, now) },
});

const publicProductSelect = (now: Date) =>
  ({
    id: true,
    nameFr: true,
    nameAr: true,
    slug: true,
    shortDescriptionFr: true,
    shortDescriptionAr: true,
    containsNicotine: true,
    productType: true,
    flavor: true,
    basePriceMillimes: true,
    promotionalPriceMillimes: true,
    minimumAge: true,
    brand: { select: { name: true, slug: true } },
    variants: {
      where: {
        publicationStatus: 'PUBLISHED',
        archivedAt: null,
        deletedAt: null,
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        priceMillimes: true,
        promotionalPriceMillimes: true,
        lowStockThreshold: true,
        inventoryItems: {
          where: {
            OR: [
              { batchId: null },
              { batch: { is: { OR: [{ expiryDate: null }, { expiryDate: { gt: now } }] } } },
            ],
          },
          select: {
            onHandQuantity: true,
            reservations: {
              where: { state: 'ACTIVE', expiresAt: { gt: now } },
              select: { quantity: true },
            },
          },
        },
      },
    },
  }) satisfies Prisma.ProductSelect;

type WishlistProductRecord = Prisma.ProductGetPayload<{
  select: ReturnType<typeof publicProductSelect>;
}>;

const publicWishlistItemWhere = (customerId: string, now: Date): Prisma.WishlistItemWhereInput => ({
  wishlist: { is: { customerId, name: DEFAULT_WISHLIST_NAME } },
  variant: { is: publicVariantWhere(now) },
});

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: WishlistQueryDto, locale: StorefrontLocale) {
    const customerId = await this.requireCustomer(this.prisma, userId);
    const now = new Date();
    const where = publicWishlistItemWhere(customerId, now);
    const [records, total] = await this.prisma.$transaction([
      this.prisma.wishlistItem.findMany({
        where,
        orderBy: [{ addedAt: 'desc' }, { variantId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          variant: {
            select: {
              product: { select: publicProductSelect(now) },
            },
          },
        },
      }),
      this.prisma.wishlistItem.count({ where }),
    ]);
    return {
      data: {
        items: records.map((record) => serializeProduct(record.variant.product, locale)),
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async add(userId: string, input: AddWishlistItemDto) {
    const result = await this.prisma.$transaction(async (transaction) => {
      const customerId = await this.lockCustomer(transaction, userId);
      const variant = await transaction.productVariant.findFirst({
        where: { id: input.variantId, ...publicVariantWhere(new Date()) },
        select: { id: true, productId: true },
      });
      if (!variant) {
        throw new ConflictException({
          code: 'WISHLIST_PRODUCT_UNAVAILABLE',
          message: 'The selected product is not currently available for the wishlist.',
        });
      }

      const wishlist = await transaction.wishlist.upsert({
        where: {
          customerId_name: { customerId, name: DEFAULT_WISHLIST_NAME },
        },
        create: { customerId, name: DEFAULT_WISHLIST_NAME },
        update: {},
        select: { id: true },
      });
      const existingProduct = await transaction.wishlistItem.findFirst({
        where: {
          wishlistId: wishlist.id,
          variant: { is: { productId: variant.productId } },
        },
        select: { variantId: true },
      });
      if (!existingProduct) {
        const itemCount = await transaction.wishlistItem.count({
          where: { wishlistId: wishlist.id },
        });
        if (itemCount >= MAX_WISHLIST_ITEMS) {
          throw new ConflictException({
            code: 'WISHLIST_LIMIT_REACHED',
            message: `A wishlist can contain at most ${MAX_WISHLIST_ITEMS} products.`,
          });
        }
      }

      await transaction.wishlistItem.deleteMany({
        where: {
          wishlistId: wishlist.id,
          variantId: { not: variant.id },
          variant: { is: { productId: variant.productId } },
        },
      });
      await transaction.wishlistItem.upsert({
        where: {
          wishlistId_variantId: { wishlistId: wishlist.id, variantId: variant.id },
        },
        create: { wishlistId: wishlist.id, variantId: variant.id },
        update: { addedAt: new Date() },
      });
      return { variantId: variant.id, productId: variant.productId, saved: true as const };
    });
    return { data: result };
  }

  async remove(userId: string, variantId: string) {
    const result = await this.prisma.$transaction(async (transaction) => {
      const customerId = await this.lockCustomer(transaction, userId);
      const item = await transaction.wishlistItem.findFirst({
        where: {
          variantId,
          wishlist: { is: { customerId, name: DEFAULT_WISHLIST_NAME } },
        },
        select: {
          wishlistId: true,
          variantId: true,
          variant: { select: { productId: true } },
        },
      });
      if (!item) throw this.itemNotFound();
      await transaction.wishlistItem.delete({
        where: {
          wishlistId_variantId: {
            wishlistId: item.wishlistId,
            variantId: item.variantId,
          },
        },
      });
      return {
        variantId: item.variantId,
        productId: item.variant.productId,
        saved: false as const,
      };
    });
    return { data: result };
  }

  private async lockCustomer(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<string> {
    const customerId = await this.requireCustomer(transaction, userId);
    // This parameterized row lock serializes the default-wishlist creation, product replacement,
    // and bounded-item check for one authenticated customer.
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM CustomerProfile WHERE id = ${customerId} FOR UPDATE
    `);
    return this.requireCustomer(transaction, userId);
  }

  private async requireCustomer(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
  ): Promise<string> {
    const customer = await client.customerProfile.findFirst({
      where: {
        userId,
        suspendedAt: null,
        anonymizedAt: null,
        user: { is: { audience: 'CUSTOMER', status: 'ACTIVE', deletedAt: null } },
      },
      select: { id: true },
    });
    if (!customer) {
      throw new ForbiddenException({
        code: 'CUSTOMER_ACCOUNT_UNAVAILABLE',
        message: 'The customer account cannot use a wishlist.',
      });
    }
    return customer.id;
  }

  private itemNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'WISHLIST_ITEM_NOT_FOUND',
      message: 'The requested wishlist item was not found.',
    });
  }
}

const availableQuantity = (variant: WishlistProductRecord['variants'][number]): number =>
  variant.inventoryItems.reduce((total, inventory) => {
    const reserved = inventory.reservations.reduce(
      (quantity, reservation) => quantity + reservation.quantity,
      0,
    );
    return total + Math.max(0, inventory.onHandQuantity - reserved);
  }, 0);

const displayPrice = (product: WishlistProductRecord) => {
  const prices: Array<{ list: number; promotional: number | null; effective: number }> = [];
  if (product.basePriceMillimes !== null && product.basePriceMillimes >= 0) {
    const promotional =
      product.promotionalPriceMillimes !== null &&
      product.promotionalPriceMillimes >= 0 &&
      product.promotionalPriceMillimes <= product.basePriceMillimes
        ? product.promotionalPriceMillimes
        : null;
    prices.push({
      list: product.basePriceMillimes,
      promotional,
      effective: promotional ?? product.basePriceMillimes,
    });
  }
  for (const variant of product.variants) {
    if (variant.priceMillimes < 0) continue;
    const promotional =
      variant.promotionalPriceMillimes !== null &&
      variant.promotionalPriceMillimes >= 0 &&
      variant.promotionalPriceMillimes <= variant.priceMillimes
        ? variant.promotionalPriceMillimes
        : null;
    prices.push({
      list: variant.priceMillimes,
      promotional,
      effective: promotional ?? variant.priceMillimes,
    });
  }
  prices.sort((left, right) => left.effective - right.effective || left.list - right.list);
  return prices[0] ?? { list: 0, promotional: null, effective: 0 };
};

const serializeProduct = (product: WishlistProductRecord, locale: StorefrontLocale) => {
  const price = displayPrice(product);
  const variants = product.variants.map((variant) => ({
    available: availableQuantity(variant),
    threshold: variant.lowStockThreshold,
  }));
  return {
    id: product.id,
    name: locale === 'ar' ? product.nameAr : product.nameFr,
    slug: product.slug,
    shortDescription: locale === 'ar' ? product.shortDescriptionAr : product.shortDescriptionFr,
    brandName: product.brand?.name ?? null,
    brandSlug: product.brand?.slug ?? null,
    productType: product.productType,
    flavor: product.flavor?.trim() || null,
    priceMillimes: price.list,
    promotionalPriceMillimes: price.promotional,
    availableQuantity: variants.reduce((total, variant) => total + variant.available, 0),
    lowStock:
      variants.length === 0 || variants.some((variant) => variant.available <= variant.threshold),
    ageRestricted: product.minimumAge !== null || product.containsNicotine,
    primaryImage: null,
  };
};
