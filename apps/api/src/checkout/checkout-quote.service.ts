import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { addMillimes } from '../common/money/money';
import { buildPublicProductWhere, publicSellableVariantWhere } from '../catalog/catalog-policy';
import { PrismaService } from '../database/prisma.service';
import { eligibleOrderInventoryWhere } from '../inventory/inventory-eligibility';
import {
  calculateQuoteLine,
  RateResolutionError,
  selectBaseRate,
  selectSurchargeRate,
  type QuoteRateCandidate,
  type RateContext,
} from './checkout-pricing';
import { CheckoutPolicyService } from './checkout-policy.service';
import type { CheckoutQuoteDto } from './dto/checkout-quote.dto';

const SURCHARGE_TYPES = [
  'REMOTE_SURCHARGE',
  'WEIGHT_SURCHARGE',
  'OVERSIZE_SURCHARGE',
  'EXPRESS_SURCHARGE',
] as const;

const safeQuantityProduct = (left: number, right: number): number => {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new ServiceUnavailableException({
      code: 'CATALOG_MEASUREMENT_INVALID',
      message: 'The quote cannot be calculated from the current catalog data.',
    });
  }
  return result;
};

@Injectable()
export class CheckoutQuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: CheckoutPolicyService,
  ) {}

  async quote(input: CheckoutQuoteDto) {
    const policy = await this.policies.evaluate();
    if (!policy.allowed) {
      throw new ConflictException({
        code: 'CHECKOUT_UNAVAILABLE',
        message: 'Checkout is not currently available.',
        blockers: policy.blockers,
      });
    }
    if (Boolean(input.localityId) === Boolean(input.pickupLocationId)) {
      throw new BadRequestException({
        code: 'FULFILLMENT_SELECTION_REQUIRED',
        message: 'Select exactly one courier locality or pickup location.',
      });
    }
    if (input.express && input.pickupLocationId) {
      throw new BadRequestException({
        code: 'EXPRESS_PICKUP_UNSUPPORTED',
        message: 'Express service is only valid for courier delivery.',
      });
    }

    const variantIds = input.items.map((item) => item.variantId);
    if (new Set(variantIds).size !== variantIds.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_QUOTE_ITEM',
        message: 'Each variant may appear only once in a quote.',
      });
    }

    const now = new Date();
    const variants = await this.prisma.productVariant.findMany({
      where: {
        id: { in: variantIds },
        ...publicSellableVariantWhere(),
        product: { is: buildPublicProductWhere({}, now) },
      },
      select: {
        id: true,
        nameFr: true,
        nameAr: true,
        sku: true,
        priceMillimes: true,
        promotionalPriceMillimes: true,
        taxRateBps: true,
        weightGrams: true,
        product: { select: { id: true, nameFr: true, nameAr: true, slug: true } },
        inventoryItems: {
          where: eligibleOrderInventoryWhere(now),
          select: {
            onHandQuantity: true,
            reservations: {
              where: { state: 'ACTIVE', expiresAt: { gt: now } },
              select: { quantity: true },
            },
          },
        },
      },
    });
    const byId = new Map(variants.map((variant) => [variant.id, variant]));
    if (variants.length !== variantIds.length) {
      throw new ConflictException({
        code: 'PRODUCT_UNAVAILABLE',
        message: 'One or more selected products are no longer available.',
      });
    }

    let subtotalMillimes = 0;
    let discountTotalMillimes = 0;
    let taxTotalMillimes = 0;
    let totalWeightGrams = 0;
    const lines = input.items.map((requested) => {
      const variant = byId.get(requested.variantId);
      if (!variant) {
        throw new ConflictException({
          code: 'PRODUCT_UNAVAILABLE',
          message: 'One or more selected products are no longer available.',
        });
      }
      const availableQuantity = variant.inventoryItems.reduce((total, inventory) => {
        const reserved = inventory.reservations.reduce(
          (quantity, reservation) => quantity + reservation.quantity,
          0,
        );
        return total + Math.max(0, inventory.onHandQuantity - reserved);
      }, 0);
      if (availableQuantity < requested.quantity) {
        throw new ConflictException({
          code: 'OUT_OF_STOCK',
          message: 'A selected product does not currently have enough available stock.',
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
          message: 'The quote cannot be calculated from the current catalog prices.',
        });
      }
      subtotalMillimes = addMillimes(subtotalMillimes, calculation.listSubtotalMillimes);
      discountTotalMillimes = addMillimes(discountTotalMillimes, calculation.discountMillimes);
      taxTotalMillimes = addMillimes(taxTotalMillimes, calculation.taxMillimes);
      totalWeightGrams = addMillimes(
        totalWeightGrams,
        safeQuantityProduct(variant.weightGrams, requested.quantity),
      );
      return {
        variantId: variant.id,
        productId: variant.product.id,
        productSlug: variant.product.slug,
        productNameFr: variant.product.nameFr,
        productNameAr: variant.product.nameAr,
        variantNameFr: variant.nameFr,
        variantNameAr: variant.nameAr,
        sku: variant.sku,
        quantity: requested.quantity,
        listUnitPriceMillimes: variant.priceMillimes,
        effectiveUnitPriceMillimes: calculation.effectiveUnitPriceMillimes,
        discountMillimes: calculation.discountMillimes,
        taxMillimes: calculation.taxMillimes,
        lineTotalMillimes: calculation.totalMillimes,
        advisoryAvailableQuantity: availableQuantity,
      };
    });

    const discountedSubtotalMillimes = addMillimes(subtotalMillimes, -discountTotalMillimes);
    const fulfillment = input.pickupLocationId
      ? await this.pickup(input.pickupLocationId, discountedSubtotalMillimes)
      : await this.courier(
          input.localityId!,
          discountedSubtotalMillimes,
          totalWeightGrams,
          input.express ?? false,
        );
    const grandTotalMillimes = addMillimes(
      discountedSubtotalMillimes,
      taxTotalMillimes,
      fulfillment.deliveryTotalMillimes,
    );
    if (fulfillment.maxCodMillimes !== null && grandTotalMillimes > fulfillment.maxCodMillimes) {
      throw new ConflictException({
        code: 'MAXIMUM_COD_EXCEEDED',
        message: 'The quote exceeds the maximum cash-on-delivery amount for this area.',
      });
    }

    return {
      data: {
        currency: 'TND' as const,
        lines,
        subtotalMillimes,
        discountTotalMillimes,
        deliveryTotalMillimes: fulfillment.deliveryTotalMillimes,
        taxTotalMillimes,
        grandTotalMillimes,
        expectedCodMillimes: grandTotalMillimes,
        totalWeightGrams,
        fulfillment: fulfillment.response,
        minimumAge: policy.minimumAge,
        expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
        stockReserved: false,
        orderCreated: false,
      },
    };
  }

  private async pickup(pickupLocationId: string, orderMillimes: number) {
    const pickup = await this.prisma.pickupLocation.findFirst({
      where: { id: pickupLocationId, active: true },
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
        message: 'The quote does not meet the pickup location minimum order.',
      });
    }
    return {
      deliveryTotalMillimes: 0,
      maxCodMillimes: pickup.maxCodMillimes,
      response: {
        type: 'STORE_PICKUP' as const,
        pickupLocation: {
          id: pickup.id,
          code: pickup.code,
          nameFr: pickup.nameFr,
          nameAr: pickup.nameAr,
          address: pickup.address,
        },
        selectedRateIds: [] as string[],
      },
    };
  }

  private async courier(
    localityId: string,
    orderMillimes: number,
    weightGrams: number,
    express: boolean,
  ) {
    const now = new Date();
    const locality = await this.prisma.locality.findFirst({
      where: {
        id: localityId,
        active: true,
        delegation: { is: { active: true, governorate: { is: { active: true } } } },
      },
      select: {
        id: true,
        delegationId: true,
        delegation: { select: { governorateId: true } },
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
                nameAr: true,
                priority: true,
                minOrderMillimes: true,
                maxCodMillimes: true,
                freeDeliveryThresholdMillimes: true,
                estimatedMinDays: true,
                estimatedMaxDays: true,
                estimatedMinMinutes: true,
                estimatedMaxMinutes: true,
                paymentMethod: true,
                phoneConfirmationRequired: true,
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
    if (zones[1]?.priority === selectedZone.priority) {
      throw this.deliveryConfigurationError();
    }
    if (
      selectedZone.zone.minOrderMillimes !== null &&
      orderMillimes < selectedZone.zone.minOrderMillimes
    ) {
      throw new ConflictException({
        code: 'MINIMUM_ORDER_NOT_MET',
        message: 'The quote does not meet the delivery-zone minimum order.',
      });
    }

    const rates = await this.prisma.deliveryRate.findMany({
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
    const candidates: QuoteRateCandidate[] = rates;
    const context: RateContext = {
      deliveryZoneId: selectedZone.zone.id,
      governorateId: locality.delegation.governorateId,
      delegationId: locality.delegationId,
      localityId: locality.id,
      orderMillimes,
      weightGrams,
      express,
    };
    try {
      const base = selectBaseRate(candidates, context);
      const surcharges = SURCHARGE_TYPES.flatMap((type) => {
        const rate = selectSurchargeRate(candidates, context, type);
        return rate ? [rate] : [];
      });
      if (express && !surcharges.some((rate) => rate.type === 'EXPRESS_SURCHARGE')) {
        throw new ConflictException({
          code: 'EXPRESS_DELIVERY_UNAVAILABLE',
          message: 'Express delivery is unavailable for the selected locality.',
        });
      }
      const selectedRates = [base, ...surcharges];
      let deliveryTotalMillimes = addMillimes(...selectedRates.map((rate) => rate.feeMillimes));
      if (
        selectedZone.zone.freeDeliveryThresholdMillimes !== null &&
        orderMillimes >= selectedZone.zone.freeDeliveryThresholdMillimes
      ) {
        deliveryTotalMillimes = 0;
      }
      const selectedRateMaximums = selectedRates.flatMap((rate) =>
        rate.maxCodMillimes === null ? [] : [rate.maxCodMillimes],
      );
      const maximums = [selectedZone.zone.maxCodMillimes, ...selectedRateMaximums].filter(
        (value): value is number => value !== null,
      );
      return {
        deliveryTotalMillimes,
        maxCodMillimes: maximums.length > 0 ? Math.min(...maximums) : null,
        response: {
          type: 'COURIER' as const,
          express,
          deliveryZone: {
            id: selectedZone.zone.id,
            code: selectedZone.zone.code,
            nameFr: selectedZone.zone.nameFr,
            nameAr: selectedZone.zone.nameAr,
          },
          selectedRateIds: selectedRates.map((rate) => rate.id),
          estimatedMinDays: selectedZone.zone.estimatedMinDays,
          estimatedMaxDays: selectedZone.zone.estimatedMaxDays,
          estimatedMinMinutes: selectedZone.zone.estimatedMinMinutes,
          estimatedMaxMinutes: selectedZone.zone.estimatedMaxMinutes,
          paymentMethod: selectedZone.zone.paymentMethod,
          phoneConfirmationRequired: selectedZone.zone.phoneConfirmationRequired,
          freeDeliveryApplied: deliveryTotalMillimes === 0,
        },
      };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof RateResolutionError) {
        if (error.code === 'DELIVERY_RATE_MISSING') {
          throw new ConflictException({
            code: 'DELIVERY_RATE_UNAVAILABLE',
            message: 'No valid delivery rate applies to this quote.',
          });
        }
        throw this.deliveryConfigurationError();
      }
      throw error;
    }
  }

  private deliveryConfigurationError(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'DELIVERY_CONFIGURATION_INVALID',
      message: 'Delivery pricing is temporarily unavailable.',
    });
  }
}
