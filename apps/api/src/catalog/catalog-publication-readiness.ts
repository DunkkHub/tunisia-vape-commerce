import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CheckoutPolicyService } from '../checkout/checkout-policy.service';
import { eligibleOrderInventoryWhere } from '../inventory/inventory-eligibility';

export const publicationInventoryWhere = (now: Date): Prisma.InventoryItemWhereInput =>
  eligibleOrderInventoryWhere(now);

export const approvedPublicationImageWhere = {
  deletedAt: null,
  moderationStatus: 'APPROVED' as const,
};

export interface PublicationInventoryRow {
  onHandQuantity: number;
  reservations: Array<{ quantity: number }>;
}

export const availablePublicationQuantity = (
  inventoryItems: readonly PublicationInventoryRow[],
): number =>
  inventoryItems.reduce((total, item) => {
    const reserved = item.reservations.reduce(
      (reservationTotal, reservation) => reservationTotal + reservation.quantity,
      0,
    );
    return total + Math.max(0, item.onHandQuantity - reserved);
  }, 0);

export const deliveryPublicationBlocker = async (
  policies: CheckoutPolicyService,
  now: Date,
): Promise<'DELIVERY_METHOD_MISSING' | null> => {
  const policy = await policies.evaluate(now);
  return policy.blockers.includes('DELIVERY_METHOD_MISSING') ? 'DELIVERY_METHOD_MISSING' : null;
};

export const publicationNotReady = (
  resource: 'product' | 'variant',
  blockers: readonly string[],
): ConflictException =>
  new ConflictException({
    code:
      resource === 'product' ? 'PRODUCT_PUBLICATION_NOT_READY' : 'VARIANT_PUBLICATION_NOT_READY',
    message:
      resource === 'product'
        ? 'The product does not meet the operational publication requirements.'
        : 'The variant does not meet the operational publication requirements.',
    blockers: [...new Set(blockers)],
  });
