# Catalog import and media operations

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

## Boundary and recorded evidence

The catalog importer is an administrator-only workflow. It creates or updates reviewable catalog records; it does not create stock or invent supplier agreements, purchase costs, real selling prices, legal approval, or publication approval. Imported products and variants remain non-public until an authorized operator completes the normal pricing, inventory, media, delivery, and publication checks.

The reviewed Wotofo manifest was verified against official product JSON endpoints on 2026-07-20. The recorded local application run produced:

- 19 product records and 321 deterministic variants;
- 145 approved stored images: 19 product images and 126 distinct variant images;
- zero duplicate SKU or slug findings;
- zero products missing an approved image, translation, or verified source record; and
- all 19 products still requiring real selling prices and available stock before publication.

The 145-image count is lower than 19 plus 321 because official variants can share a product image. Shared assets use the approved product image as a fallback rather than storing duplicate objects. The structural seed still creates no product, variant, image, supplier, price, or stock record; the evidence above belongs to the explicitly run local import, not to a fresh installation.

## Reviewed Wotofo corrections

The manifest intentionally follows the official product endpoints where earlier draft lists differed:

- nexPOD 15K Device has five reviewed colors: Fiery Sunrise, Blue Gradient, Rose Gold, Red, and Black.
- nexPOD 15K Pro Device has six reviewed colors: Black, Blue, Cosmic Orange, Red, Rose Gold, and Silver.
- nexBAR 16K has 15 reviewed flavors for both the 20 mg and 50 mg catalog records.
- The original nexPOD replacement pods are modeled as 5K, 10 ml products.
- AEROK is a refillable 30 W, 4 ml, 1650 mAh pod kit with Silver, Blue, Black, and Burgundy Red color variants; it has no imported nicotine strength, puff count, or flavor claim.
- The reviewed 50 mg nexPOD 15K source keeps the 15K hardware product line even where packaging text references a 13K regulatory presentation.

These are catalog identity decisions, not guarantees of availability, legality, supplier authenticity, or Tunisian market pricing. Re-verify the official source before each new manifest revision and use a new import key when the reviewed source set changes.

## Prerequisites

1. Apply migrations through the migration identity and run the structural seed separately.
2. Take a verified MySQL backup and confirm object-storage versioning or an equivalent recovery copy.
3. Configure `MEDIA_STORAGE_DRIVER` and either the local media root or the server-side S3/MinIO variables. Storage credentials never belong in the browser or an import file. If administrator CSV/JSON files will download remote images, set `CATALOG_IMPORT_MEDIA_HOSTS` to the exact comma-separated HTTPS hostnames controlled by the operator; an empty value disables generic remote downloads.
4. Use an active administrator with the seeded `catalog.import` permission. Browser mutations also require the administrator CSRF token and recent authentication.
5. Confirm sufficient disk/object capacity. Never point an evaluation import at the production bucket.

## Recommended Wotofo workflow

The administration UI is at `/admin/catalog/imports`. It exposes the same preview, apply, official-media, history, detail, and rollback operations as the API. The CLI is useful for a controlled operator run and writes the same receipts and audit records.

### 1. Verify and preview

```powershell
corepack pnpm catalog:import:wotofo -- --actor-email <authorized-admin@example.tld> --import-key wotofo-2026-07-20-catalog-v1 --json
```

This fetches only the reviewed HTTPS product endpoints on `www.wotofo.com`, compares every option with the static reviewed manifest, and stores a dry-run receipt. Any missing, unexpected, duplicate, malformed, or changed option stops the official import.

Review the receipt and row issues before continuing. Keep the import key stable for an exact retry; use a new key only for a genuinely new reviewed payload.

### 2. Apply the unchanged preview

```powershell
corepack pnpm catalog:import:wotofo -- --actor-email <authorized-admin@example.tld> --import-key wotofo-2026-07-20-catalog-v1 --apply --json
```

Apply recomputes the stored payload fingerprint and writes the valid batch atomically. If identical apply requests race on the same import key, the loser reloads the committed winner and returns it only when the payload fingerprint matches; a different payload still conflicts and an unrelated unique-key failure is not treated as a replay. The official workflow fixes `partialMode`, `overridePrice`, `overrideStatus`, and `overrideImages` to `false`. It cannot publish a record. Existing manually maintained price, status, stock, and images are preserved; an SKU owned by another product is a conflict.

New products and variants are created as drafts. Product base price is unknown, imported supplier cost is `NULL`, and a non-public zero variant price is only an explicit incomplete-data sentinel. A positive real selling price is mandatory before publication. No inventory row or supplier record is invented.

### 3. Import verified media

Copy the applied batch ID from the receipt, then run:

```powershell
corepack pnpm catalog:media:wotofo -- --batch-id <applied-batch-id> --actor-email <authorized-admin@example.tld> --json
```

Media import accepts only the reviewed Shopify CDN host and Wotofo asset path over HTTPS. Redirects are revalidated, retries and response sizes are bounded, and downloads pass through the same product-media validation and safe re-encoding as manual uploads. The service verifies MIME, signature, exact container boundary, decoder output, dimensions, pixel count, animation state, and checksum; it strips untrusted metadata and stores provenance. JPEG, PNG, WebP, and AVIF when the installed Sharp build supports AVIF are accepted.

The product editor supports multi-file upload, variant ownership, bilingual alternative text, preview, replacement, primary selection, drag-and-drop/keyboard ordering, and soft deletion. Its session-only editor performs crop, quarter-turn rotation, bounded resize, and JPEG/WebP compression in the browser, preserves the initially selected file for **Restore original**, and submits the resulting file through the same server validator; browser processing never weakens server MIME/signature/decode limits. Every accepted source also produces server-controlled thumbnail, card, detail, and high-resolution WebP/JPEG renditions serially under a bounded processing slot. Their profile-versioned size, SHA-256, and dimensions commit with the image, allowing public cache hits to avoid re-decoding the original. Catalog and administrator DTOs expose those optimized URLs only for a complete current-profile eight-row manifest; legacy/partial images map rendition fields to the original checksum-verifying route. A public rendition request never performs regeneration or repair. Public URLs never reveal object keys or storage credentials.

An existing active manually maintained image is never overwritten. An exact source replay returns an already-imported result rather than creating a duplicate. Missing or rejected assets keep the product's media-review requirement visible for manual resolution.

### 4. Verify the stored catalog

```powershell
corepack pnpm catalog:verify:wotofo -- --output outputs/catalog/wotofo-verification.json
```

The verifier checks the exact product/variant counts, deterministic slugs/SKUs, bilingual catalog identity, approved images, source provenance, duplicates, and remaining pricing/stock/media-review flags. It writes a machine-readable report beneath the repository-root `outputs/catalog` directory by default. A structurally valid report can still list products requiring pricing or stock; that is an intentional publication blocker, not a verifier failure.

### 5. Enter operational data and publish deliberately

For every intended product:

1. enter verified supplier/commercial data and real integer-millime prices;
2. receive stock through the normal batch/inventory workflow so available quantity is positive;
3. while the product remains `DRAFT`, inspect the pending-media queue, approve or reject every operator-supplied image, review French/Arabic labels, and use the explicit product media-review confirmation with an operator reason;
4. configure an active delivery method with valid pricing; and
5. publish variants and the product through the normal guarded, versioned administrator actions.

`POST /api/v1/admin/products/:productId/media-review/confirm` closes only the media-review flag. It requires the current product version, `products.update`, administrator CSRF, recent authentication, an operator reason, and the exact `CONFIRM_PRODUCT_MEDIA_REVIEW` confirmation. The transaction accepts only a flagged draft with no pending or quarantined product/variant image and at least one approved image owned by the product or an active draft/published variant. It locks and versions the product, writes an audit record, and leaves publication status, pricing review, stock review, variants, and all other publication controls unchanged.

Publication fails closed for an invalid SKU, nonpositive price, unavailable inventory, missing approved media, missing active delivery/pricing, or missing published variant. Import flags clear only through successful normal readiness work; editing the database to clear them is unsupported.

The final draft-to-published transition locks the catalog owner and revalidates catalog references, approved media, current inventory and reservations, and delivery policy inside a serializable database transaction. A concurrent dependency change is therefore observed by the readiness check or produces a safe conflict; publication cannot succeed from a stale readiness snapshot.

## Generic CSV and JSON import

Download the versioned CSV template from the administration page or `GET /api/v1/admin/catalog/imports/template.csv`. Version 1.0 has exactly 28 columns, is UTF-8, and supports at most 2 MiB and 2,000 rows. JSON requires `{ "schemaVersion": "1.0", "rows": [...] }` with the same row fields.

The parser rejects unknown schema shape, invalid types, incomplete flavor metadata, a row that combines flavor and color, unsafe spreadsheet-formula prefixes, duplicate identities, delimiter-bearing keys, and invalid HTTPS source URLs. URL credentials are rejected and query/fragment data is removed before persistence. Preview is always persisted before apply. By default, one invalid row blocks the batch and existing manual price/status/images are preserved. Operator-supplied URLs are metadata only: they are marked `OPERATOR_SUPPLIED_UNVERIFIED` and have no `verifiedAt` value. Only the allowlisted official-source workflow records `OFFICIAL_SOURCE_VERIFIED` with a verification timestamp.

`partialMode` and the three override switches are explicit high-risk choices for administrator-supplied files. Review the preview receipt and use them only for a documented correction. Even with `overrideStatus`, an import cannot publish a variant. `overrideImages=false` preserves every active existing image. `overrideImages=true` permits the import to stage a candidate alongside an existing image, but operator-supplied media is always stored as non-primary `PENDING` content. Approval preserves any existing approved primary; use the separate **Set primary** action only after comparing the approved candidate with the exact model/flavor. The prior image remains in the gallery rather than being destroyed. When a source slot is superseded, its previous source row keeps the original image link, URL hash, content/original checksums, verification state, and metadata under a reserved historical key; the replacement receives a new canonical source row. Import audit summaries link both source-row and image identities and record hashes/checksums, never raw source URLs.

After apply, `productImageUrl` and `variantImageUrl` values can be downloaded through the same media action used by the official flow. Generic downloads are disabled unless their exact DNS hostname appears in `CATALOG_IMPORT_MEDIA_HOSTS`; IP literals are rejected. Every URL must use HTTPS without credentials or a nonstandard port; queries and fragments are removed, every redirect is revalidated, and DNS answers containing loopback, private, link-local, reserved, or documentation addresses are rejected. The validated public addresses are pinned into the outbound connection so a second DNS lookup cannot redirect the request internally. Responses have bounded redirects, retries, time, declared size, streamed size, and raster content type, then pass through the normal signature/decode/re-encode validator. Generic records retain `OPERATOR_SUPPLIED_UNVERIFIED`, `verifiedAt=null`, `PENDING` moderation, and manual-review status; an allowlist is a transport control, not proof that the image matches the product.

Media execution takes token-owned renewable Redis leases for the batch and for global catalogue-media capacity, so only one bounded remote-media batch runs across API instances. Each synchronous run accepts at most 30 candidate downloads per product and 150 per batch, with at most three product groups active. A remote image request allows two attempts, at most two redirects per attempt, a 10-second timeout for each request, and at most one synchronous `Retry-After` delay of five seconds. The conservative remote-fetch scheduling bound is therefore 5,200 seconds (`(150 / 3 + 30) * 65`); the gateway grants only this exact administrator endpoint a 7,200-second read timeout so validation, storage, and database work retain additional headroom. Normal API routes keep 30 seconds.

Image metadata, provenance, moderation state, and import-row version checkpoints commit in one database transaction. Object storage is a separate system: a database failure triggers immediate best-effort deletion, but a process or host failure between object creation and database commit can leave an unreferenced object. Enable bucket versioning and incomplete-upload lifecycle rules, retain object inventory, and reconcile object keys against `ProductImage` records before promotion and on a monitored schedule. Source receipts and checksums make database replay idempotent; they do not make the object store and MySQL one atomic resource.

Use the **Images awaiting review** filter in the product media manager to reach every pending or quarantined row through bounded pages. Pending bytes are served only by the authenticated administrator content route; the public media route continues to require `APPROVED` status and a public product. Approve or reject with the current owner version. Only a pending image can transition, and each decision requires administrator CSRF, recent authentication, `products.update`, exact confirmation, and an append-only audit record. After the queue is resolved, use **Confirm media review** while the product is still a draft. This separate audited transition breaks no publication boundary: variants and the product must still pass and invoke their normal publication actions.

## Rollback and recovery

Automatic rollback is deliberately narrow:

- it applies only to a completed, create-only import batch;
- every imported product/variant must still have the recorded post-import version;
- it archives the records instead of destroying history; and
- any manual or concurrent change stops the entire rollback without overwriting operator work.

The browser requires the exact confirmation `ROLLBACK_CATALOG_IMPORT`. Apply requires `APPLY_CATALOG_IMPORT`; media import requires `IMPORT_CATALOG_MEDIA`. A rollback receipt is not a backup and does not restore object versions, manually changed records, or unrelated database state. Use the database and object-storage recovery procedures for those cases.

## Administrator API summary

All routes require a full TOTP-verified administrator session, `catalog.import`, no-store responses, and bounded handling. Mutations additionally require administrator CSRF and recent authentication.

| Method | Route                                                       | Purpose                                                              |
| ------ | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/v1/admin/catalog/imports`                             | List bounded batch history.                                          |
| GET    | `/api/v1/admin/catalog/imports/:id`                         | Read a receipt and row results.                                      |
| GET    | `/api/v1/admin/catalog/imports/template.csv`                | Download the formula-safe version 1 CSV template.                    |
| POST   | `/api/v1/admin/catalog/imports/preview`                     | Persist a multipart CSV/JSON preview.                                |
| POST   | `/api/v1/admin/catalog/imports/wotofo/preview`              | Verify official sources and persist the fixed-safety Wotofo preview. |
| POST   | `/api/v1/admin/catalog/imports/:id/apply`                   | Atomically apply an unchanged valid preview.                         |
| POST   | `/api/v1/admin/catalog/imports/:id/media/apply`             | Download, validate, and store allowlisted batch media.               |
| POST   | `/api/v1/admin/catalog/imports/:id/rollback`                | Archive an unchanged create-only batch.                              |
| GET    | `/api/v1/admin/products/:productId/images/:imageId/content` | Inspect owned media through the authenticated admin boundary.        |
| POST   | `/api/v1/admin/products/:productId/images/:imageId/review`  | Approve or reject one pending imported image.                        |

Every stage records an audit event and durable batch/source metadata. Do not delete receipts or provenance rows to make a later import appear clean.
