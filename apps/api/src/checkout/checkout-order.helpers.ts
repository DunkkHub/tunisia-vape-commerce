import { createHash } from 'node:crypto';
import type { CheckoutOrderDto } from './dto/checkout-order.dto';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:+-]{16,128}$/;

export interface InventoryAllocationBucket {
  id: string;
  variantId: string;
  availableQuantity: number;
}

export interface InventoryAllocation {
  inventoryItemId: string;
  variantId: string;
  quantity: number;
}

export const normalizeTunisianPhone = (value: string): string => {
  const compact = value
    .trim()
    .replace(/[\s().-]/g, '')
    .replace(/^00216/, '+216');
  return compact.startsWith('+216') ? compact : `+216${compact}`;
};

export const validateIdempotencyKey = (value: string | undefined): string | null => {
  if (!value || !IDEMPOTENCY_KEY_PATTERN.test(value)) return null;
  return value;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
};

export const checkoutRequestFingerprint = (input: CheckoutOrderDto): string => {
  const normalized = {
    ...input,
    express: input.express ?? false,
    items: [...input.items].sort((left, right) => left.variantId.localeCompare(right.variantId)),
  };
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(normalized)))
    .digest('hex');
};

export const scopedIdempotencyKeyHash = (scope: string, key: string): string =>
  createHash('sha256').update(`${scope}\0${key}`).digest('hex');

export const allocateInventory = (
  requested: ReadonlyArray<{ variantId: string; quantity: number }>,
  buckets: ReadonlyArray<InventoryAllocationBucket>,
): InventoryAllocation[] | null => {
  const orderedBuckets = buckets
    .map((bucket) => ({ ...bucket }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const allocations: InventoryAllocation[] = [];
  for (const line of [...requested].sort((left, right) =>
    left.variantId.localeCompare(right.variantId),
  )) {
    let remaining = line.quantity;
    for (const bucket of orderedBuckets) {
      if (bucket.variantId !== line.variantId || bucket.availableQuantity <= 0) continue;
      const quantity = Math.min(remaining, bucket.availableQuantity);
      if (quantity > 0) {
        allocations.push({ inventoryItemId: bucket.id, variantId: line.variantId, quantity });
        bucket.availableQuantity -= quantity;
        remaining -= quantity;
      }
      if (remaining === 0) break;
    }
    if (remaining > 0) return null;
  }
  return allocations;
};
