import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { buildPublicProductWhere } from '../catalog/catalog-policy';
import { addMillimes, calculateBasisPoints } from '../common/money/money';
import { createOperationalAlertWithOutbox } from '../common/outbox/operational-alerts';
import { CryptoService } from '../common/security/crypto.service';
import { createOrderNotificationsWithOutbox } from '../common/outbox/order-notifications';
import { PrismaService } from '../database/prisma.service';
import {
  allocateInventory,
  checkoutRequestFingerprint,
  scopedIdempotencyKeyHash,
  validateIdempotencyKey,
} from './checkout-order.helpers';
import {
  calculateQuoteLine,
  RateResolutionError,
  selectBaseRate,
  selectSurchargeRate,
  type RateContext,
} from './checkout-pricing';
import { CheckoutPolicyService, type CheckoutRequirements } from './checkout-policy.service';
import type { CheckoutOrderDto } from './dto/checkout-order.dto';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
const RESERVATION_TTL_MS = 30 * 60 * 1_000;
const MAX_TRANSACTION_ATTEMPTS = 3;
const SURCHARGE_TYPES = [
  'REMOTE_SURCHARGE',
  'WEIGHT_SURCHARGE',
  'OVERSIZE_SURCHARGE',
  'EXPRESS_SURCHARGE',
] as const;

type Transaction = Prisma.TransactionClient;

interface IdempotencyClaim {
  id: string;
  audienceScope: string;
  requestHash: string;
  orderId: string | null;
  completedAt: Date | null;
  expiresAt: Date;
}

interface LockedCheckoutCart {
  id: string;
  version: number;
  expiresAt: Date | null;
  items: Array<{ variantId: string; quantity: number }>;
}

interface ResolvedCourierAddress {
  governorateId: string;
  delegationId: string;
  localityId: string;
  governorateName: string;
  delegationName: string;
  localityName: string;
}

interface ResolvedFulfillment {
  methodType: 'COURIER' | 'STORE_PICKUP';
  methodSnapshot: string;
  deliveryTotalMillimes: number;
  maxCodMillimes: number | null;
  deliveryZoneId: string | null;
  deliveryRateId: string | null;
  pickupLocationId: string | null;
  phoneConfirmationRequired: boolean;
  manualReviewRequired: boolean;
  feeRuleSnapshot: Prisma.InputJsonValue;
  courierAddress: ResolvedCourierAddress | null;
  pickupAddress: string | null;
}

const isP2034 = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034';

const safeQuantityProduct = (left: number, right: number): number => {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new ServiceUnavailableException({
      code: 'CATALOG_MEASUREMENT_INVALID',
      message: 'The order cannot be calculated from the current catalog data.',
    });
  }
  return result;
};

const delay = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

@Injectable()
export class CheckoutOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: CheckoutPolicyService,
    private readonly crypto: CryptoService,
  ) {}

  async create(
    input: CheckoutOrderDto,
    idempotencyHeader: string | undefined,
    customerUserId: string,
    request: Request,
  ) {
    const idempotencyKey = validateIdempotencyKey(idempotencyHeader);
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_INVALID',
        message: 'A valid Idempotency-Key header is required.',
      });
    }
    this.assertRequestShape(input);
    const audienceScope = `customer:${customerUserId}:checkout-order`;
    const keyHash = scopedIdempotencyKeyHash(audienceScope, idempotencyKey);
    const requestHash = checkoutRequestFingerprint(input);

    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (transaction) =>
            this.createInTransaction(
              transaction,
              input,
              customerUserId,
              audienceScope,
              keyHash,
              requestHash,
              request,
            ),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 5_000,
            timeout: 15_000,
          },
        );
      } catch (error) {
        if (!isP2034(error) || attempt === MAX_TRANSACTION_ATTEMPTS) throw error;
        await delay(10 + attempt * 15);
      }
    }
    throw new ServiceUnavailableException({
      code: 'CHECKOUT_TRANSACTION_UNAVAILABLE',
      message: 'The order could not be created at this time.',
    });
  }

  private async createInTransaction(
    transaction: Transaction,
    input: CheckoutOrderDto,
    customerUserId: string,
    audienceScope: string,
    keyHash: string,
    requestHash: string,
    request: Request,
  ) {
    const now = new Date();
    const claim = await this.claimIdempotency(
      transaction,
      audienceScope,
      keyHash,
      requestHash,
      now,
    );
    if (claim.orderId && claim.completedAt) {
      return this.replay(transaction, claim.orderId);
    }

    const policy = await this.policies.evaluate(now, transaction);
    if (!policy.allowed || policy.minimumAge === null) {
      throw new ConflictException({
        code: 'CHECKOUT_UNAVAILABLE',
        message: 'Checkout is not currently available.',
        blockers: policy.blockers,
      });
    }
    this.assertConfiguredConsent(input, policy.requirements);

    const customerUser = await transaction.user.findFirst({
      where: {
        id: customerUserId,
        audience: 'CUSTOMER',
        status: 'ACTIVE',
        deletedAt: null,
        customerProfile: {
          is: { suspendedAt: null, anonymizedAt: null },
        },
      },
      select: {
        email: true,
        customerProfile: {
          select: {
            id: true,
            locale: true,
            blocklistEntries: {
              where: {
                status: 'ACTIVE',
                startsAt: { lte: now },
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    });
    if (!customerUser?.customerProfile) {
      throw new ForbiddenException({
        code: 'CUSTOMER_ACCOUNT_UNAVAILABLE',
        message: 'The customer account cannot place an order.',
      });
    }
    if (customerUser.customerProfile.blocklistEntries.length > 0) {
      throw new ForbiddenException({
        code: 'CUSTOMER_CHECKOUT_BLOCKED',
        message: 'The customer account cannot place an order.',
      });
    }

    const cart = await this.lockCheckoutCart(
      transaction,
      customerUser.customerProfile.id,
      input.items,
      now,
    );

    const variantIds = input.items.map((item) => item.variantId);
    const inventoryCandidates = await transaction.inventoryItem.findMany({
      where: {
        variantId: { in: variantIds },
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
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    const inventoryIds = inventoryCandidates.map((item) => item.id);
    if (inventoryIds.length > 0) {
      // Prisma has no first-class FOR UPDATE API. The IDs originate from the parameterized
      // preceding query and Prisma.join still binds each one as a value rather than interpolating SQL.
      await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT \`id\`
        FROM \`InventoryItem\`
        WHERE \`id\` IN (${Prisma.join(inventoryIds)})
        ORDER BY \`id\` ASC
        FOR UPDATE
      `);
    }

    const variants = await transaction.productVariant.findMany({
      where: {
        id: { in: variantIds },
        publicationStatus: 'PUBLISHED',
        archivedAt: null,
        deletedAt: null,
        product: { is: buildPublicProductWhere({}, now) },
      },
      select: {
        id: true,
        nameFr: true,
        nameAr: true,
        sku: true,
        barcode: true,
        priceMillimes: true,
        promotionalPriceMillimes: true,
        taxRateBps: true,
        weightGrams: true,
        product: {
          select: {
            id: true,
            nameFr: true,
            nameAr: true,
            warningFr: true,
            warningAr: true,
            minimumAge: true,
          },
        },
        inventoryItems: {
          where: { id: { in: inventoryIds } },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            variantId: true,
            locationId: true,
            batchId: true,
            onHandQuantity: true,
            reservations: {
              where: { state: 'ACTIVE', expiresAt: { gt: now } },
              select: { quantity: true },
            },
          },
        },
      },
    });
    if (variants.length !== variantIds.length) {
      throw new ConflictException({
        code: 'PRODUCT_UNAVAILABLE',
        message: 'One or more selected products are no longer available.',
      });
    }

    const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
    let subtotalMillimes = 0;
    let discountTotalMillimes = 0;
    let taxTotalMillimes = 0;
    let totalWeightGrams = 0;
    const pricedLines = input.items.map((requested) => {
      const variant = variantsById.get(requested.variantId);
      if (!variant) {
        throw new ConflictException({
          code: 'PRODUCT_UNAVAILABLE',
          message: 'One or more selected products are no longer available.',
        });
      }
      if (variant.product.minimumAge !== null && variant.product.minimumAge > policy.minimumAge!) {
        throw new ConflictException({
          code: 'PRODUCT_AGE_RESTRICTION',
          message: 'A selected product requires a different approved age policy.',
        });
      }
      let calculation;
      try {
        calculation = calculateQuoteLine({
          listUnitPriceMillimes: variant.priceMillimes,
          promotionalUnitPriceMillimes: variant.promotionalPriceMillimes,
          quantity: requested.quantity,
          taxRateBps: variant.taxRateBps,
        });
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        throw new ServiceUnavailableException({
          code: 'CATALOG_PRICE_INVALID',
          message: 'The order cannot be calculated from the current catalog prices.',
        });
      }
      subtotalMillimes = addMillimes(subtotalMillimes, calculation.listSubtotalMillimes);
      discountTotalMillimes = addMillimes(discountTotalMillimes, calculation.discountMillimes);
      taxTotalMillimes = addMillimes(taxTotalMillimes, calculation.taxMillimes);
      totalWeightGrams = addMillimes(
        totalWeightGrams,
        safeQuantityProduct(variant.weightGrams, requested.quantity),
      );
      return { requested, variant, calculation };
    });

    const allocationBuckets = variants.flatMap((variant) =>
      variant.inventoryItems.map((inventoryItem) => {
        const reserved = inventoryItem.reservations.reduce((total, reservation) => {
          if (!Number.isSafeInteger(reservation.quantity) || reservation.quantity <= 0) {
            throw new ServiceUnavailableException({
              code: 'INVENTORY_INVARIANT_BREACH',
              message: 'Inventory is temporarily unavailable.',
            });
          }
          const next = total + reservation.quantity;
          if (!Number.isSafeInteger(next)) {
            throw new ServiceUnavailableException({
              code: 'INVENTORY_INVARIANT_BREACH',
              message: 'Inventory is temporarily unavailable.',
            });
          }
          return next;
        }, 0);
        if (!Number.isSafeInteger(reserved) || reserved > inventoryItem.onHandQuantity) {
          throw new ServiceUnavailableException({
            code: 'INVENTORY_INVARIANT_BREACH',
            message: 'Inventory is temporarily unavailable.',
          });
        }
        return {
          id: inventoryItem.id,
          variantId: variant.id,
          availableQuantity: inventoryItem.onHandQuantity - reserved,
        };
      }),
    );
    const allocations = allocateInventory(input.items, allocationBuckets);
    if (!allocations) {
      throw new ConflictException({
        code: 'OUT_OF_STOCK',
        message: 'A selected product does not currently have enough available stock.',
      });
    }

    const discountedSubtotalMillimes = addMillimes(subtotalMillimes, -discountTotalMillimes);
    const fulfillment = await this.resolveFulfillment(
      transaction,
      input,
      discountedSubtotalMillimes,
      totalWeightGrams,
      now,
    );
    const grandTotalMillimes = addMillimes(
      discountedSubtotalMillimes,
      taxTotalMillimes,
      fulfillment.deliveryTotalMillimes,
    );
    if (fulfillment.maxCodMillimes !== null && grandTotalMillimes > fulfillment.maxCodMillimes) {
      throw new ConflictException({
        code: 'MAXIMUM_COD_EXCEEDED',
        message: 'The order exceeds the maximum cash-on-delivery amount for this method.',
      });
    }

    await this.validateAddress(transaction, input, fulfillment);
    const consentVersions = await this.resolveConsentVersions(
      transaction,
      input,
      customerUser.customerProfile.locale,
      now,
    );
    const orderNumber = await this.nextOrderNumber(transaction, now);
    const customerEmail = input.email ?? customerUser.email;
    const order = await transaction.order.create({
      data: {
        orderNumber,
        customerId: customerUser.customerProfile.id,
        cartId: cart.id,
        customerNameSnapshot: input.customerName,
        customerPhoneSnapshot: input.phone,
        ...(customerEmail ? { customerEmailSnapshot: customerEmail } : {}),
        status: 'PENDING_CONFIRMATION',
        paymentStatus: 'CASH_EXPECTED',
        currency: 'TND',
        subtotalMillimes,
        discountTotalMillimes,
        deliveryTotalMillimes: fulfillment.deliveryTotalMillimes,
        taxTotalMillimes,
        grandTotalMillimes,
        expectedCodMillimes: grandTotalMillimes,
        deliveryMethodType: fulfillment.methodType,
        deliveryMethodSnapshot: fulfillment.methodSnapshot,
        ...(fulfillment.deliveryZoneId ? { deliveryZoneId: fulfillment.deliveryZoneId } : {}),
        ...(fulfillment.deliveryRateId ? { deliveryRateId: fulfillment.deliveryRateId } : {}),
        ...(fulfillment.pickupLocationId ? { pickupLocationId: fulfillment.pickupLocationId } : {}),
        deliveryFeeRuleSnapshot: fulfillment.feeRuleSnapshot,
        ...(input.address?.instructions
          ? { deliveryInstructions: input.address.instructions }
          : {}),
        ...(policy.requirements.ageConfirmationRequired && input.consent.ageConfirmed
          ? { ageConfirmedAt: now }
          : {}),
        minimumAgeSnapshot: policy.minimumAge,
        ageVerificationAtDeliveryRequired: policy.requirements.deliveryAgeVerificationRequired,
        phoneConfirmationRequired: fulfillment.phoneConfirmationRequired,
        manualReviewRequired: fulfillment.manualReviewRequired,
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        currency: true,
        subtotalMillimes: true,
        discountTotalMillimes: true,
        deliveryTotalMillimes: true,
        taxTotalMillimes: true,
        grandTotalMillimes: true,
        expectedCodMillimes: true,
        deliveryMethodType: true,
        createdAt: true,
      },
    });

    const orderItemIds = new Map<string, string>();
    for (const line of pricedLines) {
      const localizedProductName =
        customerUser.customerProfile.locale === 'ar'
          ? line.variant.product.nameAr
          : line.variant.product.nameFr;
      const localizedVariantName =
        customerUser.customerProfile.locale === 'ar' ? line.variant.nameAr : line.variant.nameFr;
      const orderItem = await transaction.orderItem.create({
        data: {
          orderId: order.id,
          productId: line.variant.product.id,
          variantId: line.variant.id,
          productNameSnapshot: localizedProductName,
          variantNameSnapshot: localizedVariantName,
          skuSnapshot: line.variant.sku,
          ...(line.variant.barcode ? { barcodeSnapshot: line.variant.barcode } : {}),
          ...(line.variant.product.warningFr
            ? { warningSnapshotFr: line.variant.product.warningFr }
            : {}),
          ...(line.variant.product.warningAr
            ? { warningSnapshotAr: line.variant.product.warningAr }
            : {}),
          unitPriceMillimes: line.variant.priceMillimes,
          unitDiscountMillimes: addMillimes(
            line.variant.priceMillimes,
            -line.calculation.effectiveUnitPriceMillimes,
          ),
          taxRateBpsSnapshot: line.variant.taxRateBps,
          unitTaxMillimes: calculateBasisPoints(
            line.calculation.effectiveUnitPriceMillimes,
            line.variant.taxRateBps,
          ),
          quantity: line.requested.quantity,
          lineSubtotalMillimes: line.calculation.listSubtotalMillimes,
          lineDiscountMillimes: line.calculation.discountMillimes,
          lineTaxMillimes: line.calculation.taxMillimes,
          lineTotalMillimes: line.calculation.totalMillimes,
        },
        select: { id: true, variantId: true },
      });
      if (orderItem.variantId) orderItemIds.set(orderItem.variantId, orderItem.id);
    }

    const inventoryById = new Map(
      variants.flatMap((variant) => variant.inventoryItems.map((item) => [item.id, item] as const)),
    );
    const reservationExpiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
    for (const allocation of allocations) {
      const inventory = inventoryById.get(allocation.inventoryItemId);
      const orderItemId = orderItemIds.get(allocation.variantId);
      if (!inventory || !orderItemId) {
        throw new ServiceUnavailableException({
          code: 'CHECKOUT_TRANSACTION_INVALID',
          message: 'The order could not be created at this time.',
        });
      }
      await transaction.stockReservation.create({
        data: {
          inventoryItemId: inventory.id,
          sourceType: 'ORDER',
          sourceId: order.id,
          activeKey: `${inventory.id}:ORDER:${order.id}`,
          quantity: allocation.quantity,
          state: 'ACTIVE',
          orderId: order.id,
          orderItemId,
          expiresAt: reservationExpiresAt,
        },
      });
      await transaction.stockMovement.create({
        data: {
          inventoryItemId: inventory.id,
          locationId: inventory.locationId,
          batchId: inventory.batchId,
          type: 'RESERVATION',
          quantityDelta: 0,
          onHandAfter: inventory.onHandQuantity,
          referenceType: 'ORDER',
          referenceId: order.id,
          reasonCode: 'CHECKOUT_RESERVED',
          actorUserId: customerUserId,
          requestId: request.requestId,
          occurredAt: now,
        },
      });
    }

    await this.createAddressSnapshot(transaction, order.id, input, fulfillment);
    const consentSnapshots: Prisma.OrderConsentSnapshotCreateManyInput[] = [];
    if (policy.requirements.consentRecordingEnabled) {
      if (input.consent.ageConfirmed) {
        consentSnapshots.push({
          orderId: order.id,
          consentType: 'CHECKOUT_AGE_CONFIRMATION',
          granted: true,
          consentedAt: now,
          ...this.requestEvidence(request),
        });
      }
      if (input.consent.termsAccepted) {
        consentSnapshots.push({
          orderId: order.id,
          consentType: 'TERMS',
          granted: true,
          consentedAt: now,
          ...this.consentVersionSnapshot(consentVersions.terms),
          ...this.requestEvidence(request),
        });
      }
      if (input.consent.privacyAccepted) {
        consentSnapshots.push({
          orderId: order.id,
          consentType: 'PRIVACY',
          granted: true,
          consentedAt: now,
          ...this.consentVersionSnapshot(consentVersions.privacy),
          ...this.requestEvidence(request),
        });
      }
    }
    if (consentSnapshots.length > 0) {
      await transaction.orderConsentSnapshot.createMany({ data: consentSnapshots });
    }
    if (policy.requirements.consentRecordingEnabled && input.consent.ageConfirmed) {
      await transaction.ageVerificationEvent.create({
        data: {
          customerId: customerUser.customerProfile.id,
          orderId: order.id,
          phase: 'CHECKOUT',
          result: 'PENDING',
          minimumAge: policy.minimumAge,
          method: 'self_attestation',
          reasonCode: policy.requirements.deliveryAgeVerificationRequired
            ? 'DELIVERY_VERIFICATION_REQUIRED'
            : 'SELF_ATTESTED_NOT_IDENTITY_VERIFIED',
          occurredAt: now,
          ...this.requestEvidence(request),
        },
      });
    }
    await transaction.orderStatusHistory.create({
      data: {
        orderId: order.id,
        toStatus: 'PENDING_CONFIRMATION',
        reasonCode: 'CHECKOUT_CREATED',
        changedByUserId: customerUserId,
        requestId: request.requestId,
        createdAt: now,
      },
    });
    const delivery = await transaction.delivery.create({
      data: {
        orderId: order.id,
        status: 'PENDING_CONFIRMATION',
        ageVerificationRequired: policy.requirements.deliveryAgeVerificationRequired,
        ageVerificationResult: policy.requirements.deliveryAgeVerificationRequired
          ? 'PENDING'
          : 'NOT_REQUIRED',
      },
      select: { id: true },
    });
    await transaction.deliveryEvent.create({
      data: {
        deliveryId: delivery.id,
        toStatus: 'PENDING_CONFIRMATION',
        occurredAt: now,
        actorUserId: customerUserId,
        source: 'CHECKOUT',
        reasonCode: 'ORDER_CREATED',
        requestId: request.requestId,
      },
    });
    await transaction.cashCollection.create({
      data: {
        orderId: order.id,
        deliveryId: delivery.id,
        status: 'EXPECTED',
        expectedMillimes: order.expectedCodMillimes,
        collectedMillimes: 0,
        method: 'CASH',
      },
    });
    if (policy.requirements.customerOrderCreatedNotificationEnabled) {
      await createOrderNotificationsWithOutbox(transaction, this.crypto, {
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          customerEmailSnapshot: customerEmail ?? null,
          customerPhoneSnapshot: input.phone,
          locale: customerUser.customerProfile.locale,
        },
        event: 'ORDER_RECEIVED',
        scheduledAt: now,
      });
    }
    await createOperationalAlertWithOutbox(transaction, this.crypto, {
      kind: 'order',
      event: 'ADMIN_ORDER_CREATED',
      idempotencyKey: `admin-order-created:${order.id}`,
      payload: { orderNumber: order.orderNumber },
      scheduledAt: now,
      enabledKey: 'notifications.admin_order_created.enabled',
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: customerUserId,
        actorType: 'CUSTOMER',
        action: 'checkout.order.created',
        resourceType: 'Order',
        resourceId: order.id,
        outcome: 'SUCCESS',
        requestId: request.requestId,
        ...this.requestEvidence(request),
        afterSummary: {
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          grandTotalMillimes: order.grandTotalMillimes,
          currency: order.currency,
          reservationCount: allocations.length,
        },
        occurredAt: now,
      },
    });
    await transaction.orderIdempotencyKey.update({
      where: { id: claim.id },
      data: { orderId: order.id, completedAt: now },
    });
    const converted = await transaction.cart.updateMany({
      where: { id: cart.id, status: 'ACTIVE', version: cart.version },
      data: { status: 'CONVERTED', convertedAt: now, version: { increment: 1 } },
    });
    if (converted.count !== 1) {
      throw new ConflictException({
        code: 'CART_CHANGED',
        message: 'The cart changed before the order could be completed. Refresh and try again.',
      });
    }

    return this.orderResponse(order);
  }

  private async lockCheckoutCart(
    transaction: Transaction,
    customerId: string,
    requestedItems: CheckoutOrderDto['items'],
    now: Date,
  ): Promise<LockedCheckoutCart> {
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT \`id\` FROM \`CustomerProfile\` WHERE \`id\` = ${customerId} FOR UPDATE
    `);
    const candidate = await transaction.cart.findFirst({
      where: { customerId, status: 'ACTIVE' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!candidate) {
      throw new ConflictException({
        code: 'CART_EMPTY',
        message: 'Add an available product to the cart before checkout.',
      });
    }
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT \`id\` FROM \`Cart\` WHERE \`id\` = ${candidate.id} FOR UPDATE
    `);
    const cart = await transaction.cart.findFirst({
      where: { id: candidate.id, customerId, status: 'ACTIVE' },
      select: {
        id: true,
        version: true,
        expiresAt: true,
        items: {
          orderBy: [{ variantId: 'asc' }, { id: 'asc' }],
          select: { variantId: true, quantity: true },
        },
      },
    });
    if (!cart || (cart.expiresAt !== null && cart.expiresAt <= now)) {
      throw new ConflictException({
        code: 'CART_EXPIRED',
        message: 'The active cart expired. Refresh it before checkout.',
      });
    }
    const requested = [...requestedItems].sort((left, right) =>
      left.variantId.localeCompare(right.variantId),
    );
    const matches =
      requested.length === cart.items.length &&
      requested.every(
        (item, index) =>
          item.variantId === cart.items[index]?.variantId &&
          item.quantity === cart.items[index]?.quantity,
      );
    if (!matches) {
      throw new ConflictException({
        code: 'CART_CHANGED',
        message: 'The cart changed after pricing. Refresh the cart and quote before checkout.',
      });
    }
    return cart;
  }

  private assertRequestShape(input: CheckoutOrderDto): void {
    if (new Set(input.items.map((item) => item.variantId)).size !== input.items.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_CHECKOUT_ITEM',
        message: 'Each variant may appear only once in an order.',
      });
    }
    if (Boolean(input.localityId) === Boolean(input.pickupLocationId)) {
      throw new BadRequestException({
        code: 'FULFILLMENT_SELECTION_REQUIRED',
        message: 'Select exactly one courier locality or pickup location.',
      });
    }
    if (input.localityId && !input.address) {
      throw new BadRequestException({
        code: 'DELIVERY_ADDRESS_REQUIRED',
        message: 'A complete delivery address is required for courier delivery.',
      });
    }
    if (input.express && input.pickupLocationId) {
      throw new BadRequestException({
        code: 'EXPRESS_PICKUP_UNSUPPORTED',
        message: 'Express service is only valid for courier delivery.',
      });
    }
  }

  private assertConfiguredConsent(
    input: CheckoutOrderDto,
    requirements: CheckoutRequirements,
  ): void {
    const missing: string[] = [];
    if (requirements.ageConfirmationRequired && !input.consent.ageConfirmed) {
      missing.push('ageConfirmed');
    }
    if (requirements.termsAcceptanceRequired && !input.consent.termsAccepted) {
      missing.push('termsAccepted');
    }
    if (requirements.privacyAcceptanceRequired && !input.consent.privacyAccepted) {
      missing.push('privacyAccepted');
    }
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'CONSENT_REQUIRED',
        message: 'Complete the confirmations configured for this checkout.',
        fields: missing,
      });
    }
  }

  private async claimIdempotency(
    transaction: Transaction,
    audienceScope: string,
    keyHash: string,
    requestHash: string,
    now: Date,
  ): Promise<IdempotencyClaim> {
    const claimId = randomBytes(15).toString('hex');
    const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);
    // A no-op duplicate-key update makes concurrent first use wait for the winning transaction;
    // the subsequent FOR UPDATE then observes either its completed result or the newly inserted row.
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO \`OrderIdempotencyKey\`
        (\`id\`, \`keyHash\`, \`audienceScope\`, \`requestHash\`, \`lockedAt\`, \`expiresAt\`)
      VALUES
        (${claimId}, ${keyHash}, ${audienceScope}, ${requestHash}, ${now}, ${expiresAt})
      ON DUPLICATE KEY UPDATE \`id\` = \`id\`
    `);
    const rows = await transaction.$queryRaw<IdempotencyClaim[]>(Prisma.sql`
      SELECT \`id\`, \`audienceScope\`, \`requestHash\`, \`orderId\`, \`completedAt\`, \`expiresAt\`
      FROM \`OrderIdempotencyKey\`
      WHERE \`keyHash\` = ${keyHash}
      FOR UPDATE
    `);
    const claim = rows[0];
    if (!claim) {
      throw new ServiceUnavailableException({
        code: 'IDEMPOTENCY_STATE_INVALID',
        message: 'The order could not be created at this time.',
      });
    }
    if (claim.audienceScope !== audienceScope || claim.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'This idempotency key was already used for a different request.',
      });
    }
    if (!claim.completedAt && claim.id !== claimId) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_IN_PROGRESS',
        message: 'An equivalent order request is already being processed.',
      });
    }
    return claim;
  }

  private async replay(transaction: Transaction, orderId: string) {
    const order = await transaction.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        currency: true,
        subtotalMillimes: true,
        discountTotalMillimes: true,
        deliveryTotalMillimes: true,
        taxTotalMillimes: true,
        grandTotalMillimes: true,
        expectedCodMillimes: true,
        deliveryMethodType: true,
        createdAt: true,
      },
    });
    if (!order) {
      throw new ServiceUnavailableException({
        code: 'IDEMPOTENCY_STATE_INVALID',
        message: 'The saved order result is unavailable.',
      });
    }
    return this.orderResponse(order);
  }

  private orderResponse(order: {
    id: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    currency: string;
    subtotalMillimes: number;
    discountTotalMillimes: number;
    deliveryTotalMillimes: number;
    taxTotalMillimes: number;
    grandTotalMillimes: number;
    expectedCodMillimes: number;
    deliveryMethodType: string;
    createdAt: Date;
  }) {
    return {
      data: {
        ...order,
        status: 'PENDING_CONFIRMATION' as const,
        paymentStatus: 'CASH_EXPECTED' as const,
        createdAt: order.createdAt.toISOString(),
      },
    };
  }

  private async nextOrderNumber(transaction: Transaction, now: Date): Promise<string> {
    const rows = await transaction.$queryRaw<Array<{ key: string }>>(Prisma.sql`
      SELECT \`key\`
      FROM \`SequenceCounter\`
      WHERE \`key\` = ${'order-number'}
      FOR UPDATE
    `);
    if (rows.length !== 1) {
      throw new ServiceUnavailableException({
        code: 'ORDER_SEQUENCE_UNAVAILABLE',
        message: 'The order number could not be allocated.',
      });
    }
    const counter = await transaction.sequenceCounter.update({
      where: { key: 'order-number' },
      data: { value: { increment: 1 } },
      select: { value: true },
    });
    if (counter.value <= 0n || counter.value > 999_999_999_999n) {
      throw new ServiceUnavailableException({
        code: 'ORDER_SEQUENCE_EXHAUSTED',
        message: 'The order number could not be allocated.',
      });
    }
    return `TJ-${now.getUTCFullYear()}-${counter.value.toString().padStart(8, '0')}`;
  }

  private async resolveFulfillment(
    transaction: Transaction,
    input: CheckoutOrderDto,
    orderMillimes: number,
    weightGrams: number,
    now: Date,
  ): Promise<ResolvedFulfillment> {
    if (input.pickupLocationId) {
      const pickup = await transaction.pickupLocation.findFirst({
        where: { id: input.pickupLocationId, active: true },
        select: {
          id: true,
          code: true,
          nameFr: true,
          nameAr: true,
          address: true,
          minOrderMillimes: true,
          maxCodMillimes: true,
        },
      });
      if (!pickup) {
        throw new ConflictException({
          code: 'PICKUP_LOCATION_UNAVAILABLE',
          message: 'The selected pickup location is unavailable.',
        });
      }
      if (pickup.minOrderMillimes !== null && orderMillimes < pickup.minOrderMillimes) {
        throw new ConflictException({
          code: 'MINIMUM_ORDER_NOT_MET',
          message: 'The order does not meet the pickup location minimum order.',
        });
      }
      return {
        methodType: 'STORE_PICKUP',
        methodSnapshot: `${pickup.code} - ${pickup.nameFr}`,
        deliveryTotalMillimes: 0,
        maxCodMillimes: pickup.maxCodMillimes,
        deliveryZoneId: null,
        deliveryRateId: null,
        pickupLocationId: pickup.id,
        phoneConfirmationRequired: false,
        manualReviewRequired: false,
        feeRuleSnapshot: {
          schemaVersion: 1,
          method: 'STORE_PICKUP',
          pickupLocationId: pickup.id,
          pickupCode: pickup.code,
          feeMillimes: 0,
        },
        courierAddress: null,
        pickupAddress: pickup.address,
      };
    }

    const locality = await transaction.locality.findFirst({
      where: {
        id: input.localityId!,
        active: true,
        delegation: { is: { active: true, governorate: { is: { active: true } } } },
      },
      select: {
        id: true,
        nameFr: true,
        delegationId: true,
        delegation: {
          select: {
            nameFr: true,
            governorateId: true,
            governorate: { select: { nameFr: true } },
          },
        },
        zoneLinks: {
          where: {
            active: true,
            deliveryZone: { active: true, supported: true, temporarilySuspended: false },
          },
          select: {
            priorityOverride: true,
            deliveryZone: {
              select: {
                id: true,
                code: true,
                nameFr: true,
                priority: true,
                minOrderMillimes: true,
                maxCodMillimes: true,
                freeDeliveryThresholdMillimes: true,
                phoneConfirmationRequired: true,
                manualReviewRequired: true,
              },
            },
          },
        },
      },
    });
    if (!locality || locality.zoneLinks.length === 0) {
      throw new ConflictException({
        code: 'DELIVERY_AREA_UNSUPPORTED',
        message: 'Courier delivery is not available for the selected locality.',
      });
    }
    const zones = locality.zoneLinks
      .map((link) => ({
        zone: link.deliveryZone,
        priority: link.priorityOverride ?? link.deliveryZone.priority,
      }))
      .sort(
        (left, right) =>
          right.priority - left.priority || left.zone.id.localeCompare(right.zone.id),
      );
    const selectedZone = zones[0]!;
    if (zones[1]?.priority === selectedZone.priority) throw this.deliveryConfigurationError();
    if (
      selectedZone.zone.minOrderMillimes !== null &&
      orderMillimes < selectedZone.zone.minOrderMillimes
    ) {
      throw new ConflictException({
        code: 'MINIMUM_ORDER_NOT_MET',
        message: 'The order does not meet the delivery-zone minimum order.',
      });
    }

    const rates = await transaction.deliveryRate.findMany({
      where: {
        active: true,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
          {
            OR: [
              { localityId: locality.id },
              { delegationId: locality.delegationId, localityId: null },
              {
                governorateId: locality.delegation.governorateId,
                delegationId: null,
                localityId: null,
              },
              {
                deliveryZoneId: selectedZone.zone.id,
                governorateId: null,
                delegationId: null,
                localityId: null,
              },
              {
                deliveryZoneId: null,
                governorateId: null,
                delegationId: null,
                localityId: null,
              },
            ],
          },
        ],
      },
      select: {
        id: true,
        type: true,
        priority: true,
        feeMillimes: true,
        deliveryZoneId: true,
        governorateId: true,
        delegationId: true,
        localityId: true,
        minWeightGrams: true,
        maxWeightGrams: true,
        minOrderMillimes: true,
        maxOrderMillimes: true,
        maxCodMillimes: true,
        express: true,
      },
    });
    const context: RateContext = {
      deliveryZoneId: selectedZone.zone.id,
      governorateId: locality.delegation.governorateId,
      delegationId: locality.delegationId,
      localityId: locality.id,
      orderMillimes,
      weightGrams,
      express: input.express ?? false,
    };
    try {
      const base = selectBaseRate(rates, context);
      const surcharges = SURCHARGE_TYPES.flatMap((type) => {
        const rate = selectSurchargeRate(rates, context, type);
        return rate ? [rate] : [];
      });
      if (context.express && !surcharges.some((rate) => rate.type === 'EXPRESS_SURCHARGE')) {
        throw new ConflictException({
          code: 'EXPRESS_DELIVERY_UNAVAILABLE',
          message: 'Express delivery is unavailable for the selected locality.',
        });
      }
      const selectedRates = [base, ...surcharges];
      if (selectedRates.some((rate) => rate.feeMillimes < 0)) {
        throw this.deliveryConfigurationError();
      }
      let deliveryTotalMillimes = addMillimes(...selectedRates.map((rate) => rate.feeMillimes));
      if (
        selectedZone.zone.freeDeliveryThresholdMillimes !== null &&
        orderMillimes >= selectedZone.zone.freeDeliveryThresholdMillimes
      ) {
        deliveryTotalMillimes = 0;
      }
      const maximums = [
        selectedZone.zone.maxCodMillimes,
        ...selectedRates.map((rate) => rate.maxCodMillimes),
      ].filter((value): value is number => value !== null);
      return {
        methodType: 'COURIER',
        methodSnapshot: `${selectedZone.zone.code} - ${selectedZone.zone.nameFr}`,
        deliveryTotalMillimes,
        maxCodMillimes: maximums.length > 0 ? Math.min(...maximums) : null,
        deliveryZoneId: selectedZone.zone.id,
        deliveryRateId: base.id,
        pickupLocationId: null,
        phoneConfirmationRequired: selectedZone.zone.phoneConfirmationRequired,
        manualReviewRequired: selectedZone.zone.manualReviewRequired,
        feeRuleSnapshot: {
          schemaVersion: 1,
          method: 'COURIER',
          deliveryZoneId: selectedZone.zone.id,
          baseRateId: base.id,
          selectedRateIds: selectedRates.map((rate) => rate.id),
          feeMillimes: deliveryTotalMillimes,
          freeDeliveryApplied: deliveryTotalMillimes === 0,
          express: context.express,
        },
        courierAddress: {
          governorateId: locality.delegation.governorateId,
          delegationId: locality.delegationId,
          localityId: locality.id,
          governorateName: locality.delegation.governorate.nameFr,
          delegationName: locality.delegation.nameFr,
          localityName: locality.nameFr,
        },
        pickupAddress: null,
      };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof RateResolutionError) {
        if (error.code === 'DELIVERY_RATE_MISSING') {
          throw new ConflictException({
            code: 'DELIVERY_RATE_UNAVAILABLE',
            message: 'No valid delivery rate applies to this order.',
          });
        }
        throw this.deliveryConfigurationError();
      }
      throw error;
    }
  }

  private async validateAddress(
    transaction: Transaction,
    input: CheckoutOrderDto,
    fulfillment: ResolvedFulfillment,
  ): Promise<void> {
    if (!fulfillment.courierAddress || !input.address?.postalCode) return;
    const postalCode = await transaction.postalCode.findFirst({
      where: {
        localityId: fulfillment.courierAddress.localityId,
        code: input.address.postalCode,
        active: true,
      },
      select: { id: true },
    });
    if (!postalCode) {
      throw new ConflictException({
        code: 'POSTAL_CODE_INVALID',
        message: 'The postal code does not match the selected locality.',
      });
    }
  }

  private async createAddressSnapshot(
    transaction: Transaction,
    orderId: string,
    input: CheckoutOrderDto,
    fulfillment: ResolvedFulfillment,
  ): Promise<void> {
    if (fulfillment.courierAddress && input.address) {
      await transaction.orderAddressSnapshot.create({
        data: {
          orderId,
          type: 'DELIVERY',
          fullName: input.customerName,
          phoneE164: input.phone,
          governorateId: fulfillment.courierAddress.governorateId,
          delegationId: fulfillment.courierAddress.delegationId,
          localityId: fulfillment.courierAddress.localityId,
          governorateName: fulfillment.courierAddress.governorateName,
          delegationName: fulfillment.courierAddress.delegationName,
          localityName: fulfillment.courierAddress.localityName,
          ...(input.address.postalCode ? { postalCode: input.address.postalCode } : {}),
          street: input.address.street,
          ...(input.address.building ? { building: input.address.building } : {}),
          ...(input.address.floor ? { floor: input.address.floor } : {}),
          ...(input.address.apartment ? { apartment: input.address.apartment } : {}),
          ...(input.address.landmark ? { landmark: input.address.landmark } : {}),
          ...(input.address.instructions ? { instructions: input.address.instructions } : {}),
        },
      });
      return;
    }
    await transaction.orderAddressSnapshot.create({
      data: {
        orderId,
        type: 'PICKUP_CONTACT',
        fullName: input.customerName,
        phoneE164: input.phone,
        governorateName: 'STORE_PICKUP',
        delegationName: 'STORE_PICKUP',
        localityName: 'STORE_PICKUP',
        street: fulfillment.pickupAddress!,
      },
    });
  }

  private async resolveConsentVersions(
    transaction: Transaction,
    input: CheckoutOrderDto,
    locale: string,
    now: Date,
  ) {
    const requested = [
      input.consent.termsDocumentVersionId,
      input.consent.privacyDocumentVersionId,
    ].filter((value): value is string => Boolean(value));
    if (requested.length === 0) return { terms: null, privacy: null };
    const versions = await transaction.legalDocumentVersion.findMany({
      where: {
        id: { in: requested },
        status: 'PUBLISHED',
        publishedAt: { lte: now },
        effectiveAt: { lte: now },
        retiredAt: null,
        legalDocument: { is: { locale } },
      },
      select: {
        id: true,
        version: true,
        title: true,
        contentHash: true,
        legalDocument: { select: { type: true } },
      },
    });
    const terms = versions.find(
      (version) =>
        version.id === input.consent.termsDocumentVersionId &&
        version.legalDocument.type === 'TERMS_AND_CONDITIONS',
    );
    const privacy = versions.find(
      (version) =>
        version.id === input.consent.privacyDocumentVersionId &&
        version.legalDocument.type === 'PRIVACY_POLICY',
    );
    if (
      (input.consent.termsDocumentVersionId && !terms) ||
      (input.consent.privacyDocumentVersionId && !privacy)
    ) {
      throw new ConflictException({
        code: 'CONSENT_VERSION_INVALID',
        message: 'A submitted consent document version is no longer effective.',
      });
    }
    return { terms: terms ?? null, privacy: privacy ?? null };
  }

  private consentVersionSnapshot(
    version: { id: string; version: number; title: string; contentHash: string } | null,
  ) {
    return version
      ? {
          legalDocumentVersionId: version.id,
          documentTitleSnapshot: version.title,
          documentVersionSnapshot: version.version,
          contentHashSnapshot: version.contentHash,
        }
      : {};
  }

  private requestEvidence(request: Request) {
    const ipAddress = (request.ip ?? request.socket.remoteAddress)?.slice(0, 45);
    const userAgent = request.get('user-agent')?.slice(0, 512);
    return {
      ...(ipAddress ? { ipAddress } : {}),
      ...(userAgent ? { userAgent } : {}),
    };
  }

  private deliveryConfigurationError(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'DELIVERY_CONFIGURATION_INVALID',
      message: 'Delivery pricing is temporarily unavailable.',
    });
  }
}
