import { ServiceUnavailableException } from '@nestjs/common';
import { addMillimes, multiplyMillimes } from '../common/money/money';

export const MAX_CART_DISTINCT_ITEMS = 50;
export const MAX_CART_ITEM_QUANTITY = 20;

export interface InventoryAvailabilityInput {
  onHandQuantity: number;
  reservations: Array<{ quantity: number }>;
}

export const effectiveCartUnitPrice = (
  listPriceMillimes: number,
  promotionalPriceMillimes: number | null,
): {
  listPriceMillimes: number;
  promotionalPriceMillimes: number | null;
  unitPriceMillimes: number;
} => {
  if (!Number.isSafeInteger(listPriceMillimes) || listPriceMillimes < 0) {
    throw new ServiceUnavailableException({
      code: 'CATALOG_PRICE_INVALID',
      message: 'The cart cannot be calculated from the current catalog prices.',
    });
  }
  const promotionIsValid =
    promotionalPriceMillimes !== null &&
    Number.isSafeInteger(promotionalPriceMillimes) &&
    promotionalPriceMillimes >= 0 &&
    promotionalPriceMillimes <= listPriceMillimes;
  const promotion = promotionIsValid ? promotionalPriceMillimes : null;
  return {
    listPriceMillimes,
    promotionalPriceMillimes: promotion,
    unitPriceMillimes: promotion ?? listPriceMillimes,
  };
};

export const availableCartQuantity = (inventory: InventoryAvailabilityInput[]): number =>
  inventory.reduce((total, item) => {
    if (!Number.isSafeInteger(item.onHandQuantity) || item.onHandQuantity < 0) {
      throw inventoryInvariantError();
    }
    const reserved = item.reservations.reduce((quantity, reservation) => {
      if (!Number.isSafeInteger(reservation.quantity) || reservation.quantity <= 0) {
        throw inventoryInvariantError();
      }
      const next = quantity + reservation.quantity;
      if (!Number.isSafeInteger(next)) throw inventoryInvariantError();
      return next;
    }, 0);
    if (reserved > item.onHandQuantity) throw inventoryInvariantError();
    const next = total + item.onHandQuantity - reserved;
    if (!Number.isSafeInteger(next)) throw inventoryInvariantError();
    return next;
  }, 0);

export const cartLineTotal = (unitPriceMillimes: number, quantity: number): number =>
  multiplyMillimes(unitPriceMillimes, quantity);

export const cartSubtotal = (lineTotals: number[]): number => addMillimes(...lineTotals);

const inventoryInvariantError = (): ServiceUnavailableException =>
  new ServiceUnavailableException({
    code: 'INVENTORY_INVARIANT_BREACH',
    message: 'Inventory is temporarily unavailable.',
  });
