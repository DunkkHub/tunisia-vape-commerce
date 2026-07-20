# Checkout and order lifecycle

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

## Customer flow

1. A customer registers or signs in through `/login`; administrator credentials are never accepted.
2. If `age_gate.entry.enabled=true`, the customer completes the signed entry confirmation before catalog access.
3. The customer selects published variants and manages the server-backed cart.
4. The checkout page loads `GET /api/v1/checkout/policy` and displays any operational blockers.
5. `POST /api/v1/checkout/quote` recalculates items, effective prices, discounts, tax, delivery pricing, COD total, and advisory stock in integer millimes. A quote reserves nothing and expires after five minutes.
6. `POST /api/v1/checkout/orders` requires the customer session, customer CSRF, a scoped `Idempotency-Key`, address/delivery data, explicit item lines, and only the confirmations enabled in policy.
7. The customer reads only owned orders through `/api/v1/orders` and may cancel only an owned `PENDING_CONFIRMATION` order.

The order endpoint currently receives explicit item lines instead of trusting a browser cart total. It reloads every product, variant, price, restriction, and stock input; the browser is never authoritative.

## Atomic order creation

Order creation uses one bounded MySQL `READ COMMITTED` transaction:

1. Claim the customer/operation-scoped hashed idempotency key and request fingerprint.
2. Re-evaluate operational policy, active customer/blocklist, catalog, configured confirmations, and delivery rules.
3. Lock inventory rows in deterministic order and subtract active, unexpired reservations from physical on-hand.
4. Recalculate all integer-millime commercial values and resolve exactly one valid delivery result.
5. Create immutable item, address, warning, delivery-price/rule, and enabled-confirmation snapshots.
6. Create 30-minute active stock reservations, initial order/delivery histories, expected COD collection, queued notification, audit record, and completed idempotency result.
7. Commit before any worker performs an external side effect.

An identical completed retry returns the stored result. Reusing the key for a different request is rejected. Physical stock is not decremented at checkout; it is decremented once when an authorized administrator confirms the order after revalidating complete, unexpired reservations under locks.

When `age_gate.checkout.enabled=false`, `Order.ageConfirmedAt` is `null`. Migration `20260720010000_configurable_checkout_consent` introduces that representation. Other enabled confirmations and delivery requirements remain independent.

## Order state progression

The server owns the state machine. Normal paths are:

```text
PENDING_CONFIRMATION
  -> CONFIRMED | ON_HOLD | CANCELLED
CONFIRMED / ON_HOLD
  -> PREPARING | CANCELLED
PREPARING
  -> READY_FOR_PICKUP | ASSIGNED_TO_COURIER | CANCELLED
READY_FOR_PICKUP
  -> DELIVERED | CANCELLED
ASSIGNED_TO_COURIER
  -> HANDED_TO_COURIER -> IN_TRANSIT -> OUT_FOR_DELIVERY
OUT_FOR_DELIVERY
  -> DELIVERED | DELIVERY_ATTEMPTED | REFUSED | FAILED
DELIVERY_ATTEMPTED / FAILED
  -> RESCHEDULED or RETURN_TO_SENDER as allowed
REFUSED / FAILED
  -> RETURN_TO_SENDER -> RETURNED
```

The exact transition maps in the API are authoritative. Every mutation checks permission, current state/version, required evidence, and recent authentication where applicable, then appends history. Never repair history with direct SQL; use an approved compensating workflow.

## Delivery and age outcome

Delivery is a related but separate state machine. If `delivery.age_verification_required=true`, completion requires the implemented successful age-verification outcome. Failed, refused, or unable-to-verify outcomes cannot become `DELIVERED`; they enter the failed/refused and return workflow. Disabling this setting does not weaken assignment, status, ownership, exact-COD, audit, or other delivery controls.

## COD custody

An order creates an `EXPECTED` cash collection. These facts remain separate:

- order created/confirmed/delivered;
- cash collected by courier or store;
- cash allocated to a remittance;
- cash remitted;
- discrepancy opened/resolved; and
- cash reconciled.

Delivery success alone never proves remittance or reconciliation. Partial collection is disabled. Follow [COD reconciliation](COD_RECONCILIATION.md) and [Delivery operations](DELIVERY_OPERATIONS.md).

## Operational checks

Before accepting real orders:

- verify all policy blockers are empty for the intended environment;
- exercise an authoritative quote for every active delivery area and pickup;
- run final-unit and idempotency concurrency tests on target MySQL/Redis;
- exercise customer cancellation, administrator confirmation/cancellation, reservation expiry, failed delivery, return, and COD reconciliation;
- confirm notification retry/dead-letter behavior; and
- record the results in [PRODUCTION_READINESS_REPORT.md](../PRODUCTION_READINESS_REPORT.md).
