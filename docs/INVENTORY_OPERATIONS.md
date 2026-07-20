# Inventory operations

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

MySQL is the inventory authority. Never edit stock through a product field or direct production SQL. Use the protected inventory actions so the physical quantity, optimistic version, movement history, reservations, and audit remain consistent.

## Quantity meanings

- `onHandQuantity`: physical units recorded in an inventory bucket.
- active reserved: units held by unexpired `ACTIVE` reservations.
- available: physical on-hand minus active reserved.
- low stock: available quantity at or below the variant's configured threshold.

An inventory bucket is unique by variant, location, and lot key. Archived or expired batches are excluded from sellable availability. Checkout always recalculates availability under locks; dashboard totals are advisory reads.

## Brand, type, and flavor view

The administration inventory read groups and filters variants by brand (mark), product type, flavor, and brand-plus-flavor. Totals apply to the full filtered result, not only the current page. Use combined filters when verifying how many units remain for each brand/flavor combination.

The storefront catalog independently supports brand, product type, flavor, price range, search/category, featured, and sort filters. A catalog result never reserves stock.

## Batch intake

1. Create or select an active inventory location.
2. Receive stock through `POST /api/v1/admin/inventory/batches/receipts` with the variant, location, batch number, quantity, expiry date, and optional supplier, supplier reference, manufacturing date, and note.
3. Supply a new `Idempotency-Key` header (16-128 safe ASCII characters) for each physical receipt. Replaying the same key and payload returns the original movement; reusing it with another payload returns `IDEMPOTENCY_KEY_REUSED`. Only the SHA-256-scoped key hash and request fingerprint are stored.
4. The receipt transaction locks the variant, location, and existing bucket; validates stable batch metadata and future expiry; creates the batch/bucket when absent; increments integer stock and version; then appends `PURCHASE_RECEIPT` and audit evidence atomically.
5. Re-read the variant and immutable movement history to reconcile the physical receipt.

`POST /api/v1/admin/inventory/items` now creates an empty bucket only. A positive `initialQuantity` returns `INITIAL_STOCK_RECEIPT_REQUIRED`; this prevents arbitrary opening stock from bypassing traceable batch intake. Existing unbatched buckets remain readable and transferable.

## Dual-control adjustments

All manual `ADD`, `REMOVE`, and `SET` corrections are treated as high-risk custody changes. A request validates its expected version and active reservations, but does not mutate stock or create a movement. It creates a `PENDING_APPROVAL` record that expires after 24 hours.

A different administrator with `inventory.approve` must approve or reject it. Approval locks both the request and inventory item, verifies the original stock/version snapshot again, prevents negative stock or reduction below active reservations, increments the item version, and atomically appends the movement and audit evidence. The requester cannot decide their own request. A stale request is closed as rejected; an expired request is closed as expired. Repeating the same completed decision is safe.

Adjustment reason vocabulary includes `PURCHASE_RECEIPT`, `STOCK_COUNT_CORRECTION`, `DAMAGE`, `EXPIRY`, and `OTHER`, but the manual route rejects `PURCHASE_RECEIPT` with `BATCH_RECEIPT_REQUIRED`; purchasing must use the batch-receipt route with expiry metadata. `REMOVE`/`SET` cannot propose physical stock below active reservations or below zero.

## Location transfers

`POST /api/v1/admin/inventory/items/:id/transfers` moves one source lot to another active location. The request requires `inventory.transfer`, the current source version, a positive quantity, and an `Idempotency-Key`. Source and destination location rows are locked in deterministic order, followed by inventory buckets in deterministic order. The transaction checks unreserved source availability, keeps variant/batch/lot identity unchanged, creates the destination bucket if needed, increments both versions, and writes paired `TRANSFER_OUT`/`TRANSFER_IN` movements plus one audit event. Any failure rolls back both sides.

`GET /api/v1/admin/inventory/transfers` provides a bounded immutable transfer list. The raw idempotency key is never returned or stored.

The current protected routes are:

- `GET/POST /api/v1/admin/inventory/locations`
- `GET /api/v1/admin/inventory/export.csv`
- `POST /api/v1/admin/inventory/items`
- `POST /api/v1/admin/inventory/batches/receipts`
- `GET /api/v1/admin/inventory/variants/:variantId`
- `GET /api/v1/admin/inventory/items/:id/movements`
- `POST /api/v1/admin/inventory/items/:id/adjustments`
- `GET /api/v1/admin/inventory/adjustments`
- `POST /api/v1/admin/inventory/adjustments/:id/decision`
- `POST /api/v1/admin/inventory/items/:id/transfers`
- `GET /api/v1/admin/inventory/transfers`
- `PATCH /api/v1/admin/inventory/variants/:variantId/low-stock-threshold`

Reads require `inventory.read`. The CSV export additionally requires `reports.export` and recent authentication, applies the active brand/type/flavor/search/status filters, is audited, formula-neutralized, and fails closed above 500 rows. Location, empty-bucket, receipt, adjustment-request, and threshold writes require `inventory.adjust`; decisions require `inventory.approve`; transfers require `inventory.transfer`. Every write also requires administrator CSRF, recent authentication, and audit; versioned actions require the expected version.

## Reservation lifecycle

- Checkout creates an `ACTIVE` 30-minute reservation and a zero-delta reservation movement.
- Administrator order confirmation consumes complete unexpired reservations and decrements physical stock once.
- Customer/admin cancellation releases only active reservations; it does not add physical stock.
- The worker expires overdue reservations idempotently and writes a zero-delta release movement.
- A returned unit is not sellable until an explicit inspection/disposition workflow authorizes a new physical movement.

Never infer a physical receipt from reservation release or a delivered/returned status.

## Current operational limits

The administrator inventory detail UI implements batch receipts, expiry metadata, dual-control manual adjustments, movement history, low-stock thresholds, and atomic cross-location transfers. The overview implements brand/type/flavor grouping and filtering plus bounded CSV export. Barcode import, a dedicated cycle-count campaign workflow, and controlled return inspection/quarantine/restock remain outside this operational slice; do not replace them with direct database edits.

## Shift checks

- Review low/out-of-stock and soon-expiring reservations.
- Reconcile physical count discrepancies through a reasoned adjustment.
- Investigate repeated version conflicts or reservation expiry spikes.
- Confirm order cancellation/confirmation changed reservation state exactly once.
- Keep damaged, expired, recalled, refused, failed-delivery, and customer-returned goods out of sellable stock until disposition is explicit.
- Escalate missing movement history, negative availability, or a physical/reservation mismatch as an integrity incident.
