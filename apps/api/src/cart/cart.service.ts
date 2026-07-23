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
import { publicProductImageUrl } from '../product-media/product-media.service';
import type { AddCartItemDto, UpdateCartItemDto } from './dto/cart.dto';
import {
  availableCartQuantity,
  cartLineTotal,
  cartSubtotal,
  effectiveCartUnitPrice,
  MAX_CART_DISTINCT_ITEMS,
  MAX_CART_ITEM_QUANTITY,
} from './cart-policy';

const CART_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const cartExpiry = (now = new Date()) => new Date(now.getTime() + CART_TTL_MS);

const cartImageSelect = {
  id: true,
  objectKeyHash: true,
  altTextFr: true,
  altTextAr: true,
  width: true,
  height: true,
} satisfies Prisma.ProductImageSelect;

const cartImages = {
  where: { deletedAt: null, moderationStatus: 'APPROVED' as const },
  orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }, { id: 'asc' as const }],
  take: 1,
  select: cartImageSelect,
};

const eligibleInventoryWhere = (now: Date): Prisma.InventoryItemWhereInput => ({
  onHandQuantity: { gt: 0 },
  location: { is: { active: true, fulfillsOrders: true } },
  OR: [
    { batchId: null },
    {
      batch: {
        is: {
          archivedAt: null,
          OR: [{ expiryDate: null }, { expiryDate: { gt: now } }],
        },
      },
    },
  ],
});

const publicVariantWhere = (now: Date): Prisma.ProductVariantWhereInput => ({
  publicationStatus: 'PUBLISHED',
  archivedAt: null,
  deletedAt: null,
  priceMillimes: { gte: 0 },
  product: { is: buildPublicProductWhere({}, now) },
});

const cartVariantSelect = (now: Date) =>
  ({
    id: true,
    nameFr: true,
    nameAr: true,
    sku: true,
    priceMillimes: true,
    promotionalPriceMillimes: true,
    lowStockThreshold: true,
    images: cartImages,
    product: {
      select: {
        id: true,
        nameFr: true,
        nameAr: true,
        slug: true,
        shortDescriptionFr: true,
        shortDescriptionAr: true,
        productType: true,
        flavor: true,
        containsNicotine: true,
        minimumAge: true,
        brand: { select: { name: true, slug: true } },
        images: cartImages,
      },
    },
    inventoryItems: {
      where: eligibleInventoryWhere(now),
      orderBy: { id: 'asc' },
      select: {
        onHandQuantity: true,
        reservations: {
          where: { state: 'ACTIVE', expiresAt: { gt: now } },
          select: { quantity: true },
        },
      },
    },
  }) satisfies Prisma.ProductVariantSelect;

const cartSelect = (now: Date) =>
  ({
    id: true,
    items: {
      where: { variant: { is: publicVariantWhere(now) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        quantity: true,
        variant: { select: cartVariantSelect(now) },
      },
    },
  }) satisfies Prisma.CartSelect;

type CartRecord = Prisma.CartGetPayload<{ select: ReturnType<typeof cartSelect> }>;
type CartVariantRecord = Prisma.ProductVariantGetPayload<{
  select: ReturnType<typeof cartVariantSelect>;
}>;
type CartImageRecord = CartVariantRecord['images'][number];

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, locale: StorefrontLocale) {
    const cartId = await this.prisma.$transaction((transaction) =>
      this.lockCustomerAndCart(transaction, userId, true),
    );
    return this.response(userId, cartId!, locale);
  }

  async summary(userId: string) {
    const now = new Date();
    const cart = await this.prisma.cart.findFirst({
      where: {
        status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        customer: { is: { userId, suspendedAt: null, user: { is: { status: 'ACTIVE' } } } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: cartSelect(now),
    });
    return {
      data: {
        itemCount: cart?.items.reduce((quantity, item) => quantity + item.quantity, 0) ?? 0,
      },
    };
  }

  async add(userId: string, input: AddCartItemDto, locale: StorefrontLocale) {
    const cartId = await this.prisma.$transaction(async (transaction) => {
      const activeCartId = await this.lockCustomerAndCart(transaction, userId, true);
      const now = new Date();
      const variant = await transaction.productVariant.findFirst({
        where: { id: input.variantId, ...publicVariantWhere(now) },
        select: cartVariantSelect(now),
      });
      if (!variant) throw this.productUnavailable();

      const existing = await transaction.cartItem.findUnique({
        where: { cartId_variantId: { cartId: activeCartId!, variantId: input.variantId } },
        select: { id: true, quantity: true },
      });
      const quantity = (existing?.quantity ?? 0) + input.quantity;
      this.assertQuantity(quantity);
      this.assertAvailable(variant, quantity);

      if (!existing) {
        const itemCount = await transaction.cartItem.count({ where: { cartId: activeCartId! } });
        if (itemCount >= MAX_CART_DISTINCT_ITEMS) {
          throw new ConflictException({
            code: 'CART_ITEM_LIMIT_REACHED',
            message: 'The cart contains the maximum number of distinct items.',
          });
        }
        await transaction.cartItem.create({
          data: { cartId: activeCartId!, variantId: input.variantId, quantity },
        });
      } else {
        await transaction.cartItem.update({ where: { id: existing.id }, data: { quantity } });
      }
      await transaction.cart.update({
        where: { id: activeCartId! },
        data: { version: { increment: 1 }, expiresAt: cartExpiry(now) },
      });
      return activeCartId!;
    });
    return this.response(userId, cartId, locale);
  }

  async update(userId: string, itemId: string, input: UpdateCartItemDto, locale: StorefrontLocale) {
    const cartId = await this.prisma.$transaction(async (transaction) => {
      const activeCartId = await this.lockCustomerAndCart(transaction, userId, false);
      if (!activeCartId) throw this.itemNotFound();
      const item = await transaction.cartItem.findFirst({
        where: { id: itemId, cartId: activeCartId },
        select: { id: true, variantId: true },
      });
      if (!item) throw this.itemNotFound();

      const now = new Date();
      const variant = await transaction.productVariant.findFirst({
        where: { id: item.variantId, ...publicVariantWhere(now) },
        select: cartVariantSelect(now),
      });
      if (!variant) throw this.productUnavailable();
      this.assertQuantity(input.quantity);
      this.assertAvailable(variant, input.quantity);
      await transaction.cartItem.update({
        where: { id: item.id },
        data: { quantity: input.quantity },
      });
      await transaction.cart.update({
        where: { id: activeCartId },
        data: { version: { increment: 1 }, expiresAt: cartExpiry(now) },
      });
      return activeCartId;
    });
    return this.response(userId, cartId, locale);
  }

  async remove(userId: string, itemId: string, locale: StorefrontLocale) {
    const cartId = await this.prisma.$transaction(async (transaction) => {
      const activeCartId = await this.lockCustomerAndCart(transaction, userId, false);
      if (!activeCartId) throw this.itemNotFound();
      const deleted = await transaction.cartItem.deleteMany({
        where: { id: itemId, cartId: activeCartId },
      });
      if (deleted.count !== 1) throw this.itemNotFound();
      await transaction.cart.update({
        where: { id: activeCartId },
        data: { version: { increment: 1 }, expiresAt: cartExpiry() },
      });
      return activeCartId;
    });
    return this.response(userId, cartId, locale);
  }

  private async lockCustomerAndCart(
    transaction: Prisma.TransactionClient,
    userId: string,
    create: boolean,
  ): Promise<string | null> {
    const now = new Date();
    const customer = await transaction.customerProfile.findFirst({
      where: {
        userId,
        suspendedAt: null,
        user: { is: { audience: 'CUSTOMER', status: 'ACTIVE' } },
      },
      select: { id: true },
    });
    if (!customer) {
      throw new ForbiddenException({
        code: 'CUSTOMER_ACCOUNT_UNAVAILABLE',
        message: 'The customer account cannot use a cart.',
      });
    }

    // Prisma has no row-lock API. This parameterized lock serializes active-cart creation and all
    // mutations for one customer; the identifier came from the preceding scoped Prisma query.
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM CustomerProfile WHERE id = ${customer.id} FOR UPDATE
    `);
    const stillActive = await transaction.customerProfile.findFirst({
      where: {
        id: customer.id,
        suspendedAt: null,
        user: { is: { audience: 'CUSTOMER', status: 'ACTIVE' } },
      },
      select: { id: true },
    });
    if (!stillActive) {
      throw new ForbiddenException({
        code: 'CUSTOMER_ACCOUNT_UNAVAILABLE',
        message: 'The customer account cannot use a cart.',
      });
    }

    const cart = await transaction.cart.findFirst({
      where: { customerId: customer.id, status: 'ACTIVE' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: { id: true, expiresAt: true },
    });
    if (cart && cart.expiresAt !== null && cart.expiresAt <= now) {
      await transaction.cart.updateMany({
        where: { id: cart.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED', version: { increment: 1 } },
      });
    } else if (cart) {
      await this.removeUnavailableItems(transaction, cart.id, now);
      return cart.id;
    }
    if (!create) return null;
    const created = await transaction.cart.create({
      data: {
        customerId: customer.id,
        status: 'ACTIVE',
        currency: 'TND',
        expiresAt: cartExpiry(),
      },
      select: { id: true },
    });
    return created.id;
  }

  private async removeUnavailableItems(
    transaction: Prisma.TransactionClient,
    cartId: string,
    now: Date,
  ): Promise<void> {
    const deleted = await transaction.cartItem.deleteMany({
      where: {
        cartId,
        variant: { isNot: publicVariantWhere(now) },
      },
    });
    if (deleted.count === 0) return;

    // Checkout compares the submitted lines with every persisted cart row. Removing a stale row
    // must therefore invalidate any quote produced from the previous cart version.
    await transaction.cart.update({
      where: { id: cartId },
      data: { version: { increment: 1 } },
    });
  }

  private async response(userId: string, cartId: string, locale: StorefrontLocale) {
    const now = new Date();
    const cart = await this.prisma.cart.findFirst({
      where: {
        id: cartId,
        status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        customer: { is: { userId, suspendedAt: null, user: { is: { status: 'ACTIVE' } } } },
      },
      select: cartSelect(now),
    });
    if (!cart) {
      throw new ForbiddenException({
        code: 'CUSTOMER_ACCOUNT_UNAVAILABLE',
        message: 'The customer account cannot use a cart.',
      });
    }
    return { data: serializeCart(cart, locale) };
  }

  private assertQuantity(quantity: number): void {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_CART_ITEM_QUANTITY) {
      throw new ConflictException({
        code: 'CART_QUANTITY_LIMIT',
        message: `A cart item quantity must be between 1 and ${MAX_CART_ITEM_QUANTITY}.`,
      });
    }
  }

  private assertAvailable(variant: CartVariantRecord, quantity: number): void {
    if (availableCartQuantity(variant.inventoryItems) < quantity) {
      throw new ConflictException({
        code: 'OUT_OF_STOCK',
        message: 'The requested quantity is not currently available.',
      });
    }
  }

  private productUnavailable(): ConflictException {
    return new ConflictException({
      code: 'PRODUCT_UNAVAILABLE',
      message: 'The selected product is no longer available.',
    });
  }

  private itemNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'CART_ITEM_NOT_FOUND',
      message: 'The requested cart item was not found.',
    });
  }
}

const serializeCart = (cart: CartRecord, locale: StorefrontLocale) => {
  const items = cart.items.map((item) => {
    const variant = item.variant;
    const product = variant.product;
    const availability = availableCartQuantity(variant.inventoryItems);
    const price = effectiveCartUnitPrice(variant.priceMillimes, variant.promotionalPriceMillimes);
    const name = locale === 'ar' ? product.nameAr : product.nameFr;
    const variantName = locale === 'ar' ? variant.nameAr : variant.nameFr;
    const shortDescription =
      locale === 'ar' ? product.shortDescriptionAr : product.shortDescriptionFr;
    const variantImage = variant.images?.[0];
    const displayImage = variantImage ?? product.images?.[0];
    return {
      id: item.id,
      quantity: item.quantity,
      unitPriceMillimes: price.unitPriceMillimes,
      lineTotalMillimes: cartLineTotal(price.unitPriceMillimes, item.quantity),
      product: {
        id: product.id,
        name,
        slug: product.slug,
        shortDescription,
        brandName: product.brand?.name ?? null,
        brandSlug: product.brand?.slug ?? null,
        productType: product.productType,
        flavor: product.flavor?.trim() || null,
        priceMillimes: price.listPriceMillimes,
        promotionalPriceMillimes: price.promotionalPriceMillimes,
        availableQuantity: availability,
        lowStock: availability <= variant.lowStockThreshold,
        ageRestricted: product.minimumAge !== null || product.containsNicotine,
        primaryImage: displayImage ? serializeCartImage(displayImage, locale) : null,
      },
      variant: {
        id: variant.id,
        name: variantName,
        sku: variant.sku,
        priceMillimes: price.listPriceMillimes,
        promotionalPriceMillimes: price.promotionalPriceMillimes,
        availableQuantity: availability,
        image: variantImage ? serializeCartImage(variantImage, locale) : null,
      },
    };
  });
  const lineTotals = items.map((item) => item.lineTotalMillimes);
  return {
    id: cart.id,
    items,
    itemCount: items.reduce((quantity, item) => quantity + item.quantity, 0),
    subtotalMillimes: cartSubtotal(lineTotals),
  };
};

const serializeCartImage = (image: CartImageRecord, locale: StorefrontLocale) => ({
  id: image.id,
  url: publicProductImageUrl(image.objectKeyHash),
  altText: locale === 'ar' ? image.altTextAr : image.altTextFr,
  width: image.width ?? undefined,
  height: image.height ?? undefined,
});
