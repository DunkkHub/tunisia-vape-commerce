# Administrator guide

## Access boundary

Administrator access is separate from customer access:

- Customer UI login: /login
- Administrator UI login: /admin/login
- Customer API authentication: /api/v1/auth/customer/*
- Administrator API authentication: /api/v1/auth/admin/*

Use the dedicated admin hostname in controlled staging/production. Do not sign into admin from a shared or untrusted device. Customer credentials/cookies cannot authorize admin APIs, and an admin password alone is insufficient: a full administrator session requires mandatory TOTP or a one-time recovery code.

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

## First administrator

There is no seeded/default administrator. From a trusted one-off environment with secure database access, run:

    pnpm admin:create

The command prompts for email, name, and password without echoing the password, validates strength, locks and assigns the seeded Super Administrator role, writes a system audit event, and requires TOTP enrollment at first login. It is bootstrap-only: if any administrator already exists, it refuses and directs the operator to the protected account-management API. Never pass the password on the command line, paste it into logs/tickets, automate a default password, or rerun the bootstrap command to create an ordinary administrator.

After creation:

1. Visit /admin/login on the admin host.
2. Enter the admin credentials.
3. Enroll TOTP through the restricted enrollment flow and verify one code.
4. Store the one-time recovery codes in an approved password manager/offline safe. They are shown once.
5. Sign out and confirm password-plus-TOTP works.
6. Create named least-privilege operator accounts; do not share the first account.

## Roles

- Super Administrator: emergency/system ownership; use sparingly.
- Administrator: broad business administration excluding specifically withheld super-admin controls.
- Catalog Manager: products, taxonomy, suppliers and approved media.
- Inventory Manager: inventory, movements, transfers, inspection/disposition.
- Order Manager: order confirmation, preparation, cancellation/return policy.
- Customer Support Agent: customer/order assistance without price, role, or cash authority.
- Delivery Coordinator: zones, couriers, assignments, manifests and valid delivery transitions.
- Accountant: COD collection/remittance/reconciliation and financial reports.
- Read-Only Analyst: bounded reports and explicitly allowed reads.

Permissions are additive through active roles and enforced by the API. Review the exact matrix before staging. Catalog Manager cannot manage roles, Support cannot change prices, Delivery Coordinator cannot reconcile cash, and analysts cannot export unless explicitly granted.

## Administrator and customer account lifecycle

Use the separate administration surfaces for the two account realms:

- `/admin/admins` manages administrator accounts.
- `/admin/customers` manages customer accounts.

Only an active, TOTP-enrolled account with the exact `super-administrator` role and the matching permissions can use these lifecycle actions. Broad Administrator permissions alone are not enough. Before every mutation, complete recent authentication, review the current versions/status, enter a specific operational reason, and confirm the action. Refresh instead of retrying blindly after a version conflict.

For administrator accounts:

1. Create a named, non-super account with a unique email and strong initial password. The new administrator must enroll TOTP before becoming operational. The management API deliberately cannot assign the Super Administrator role.
2. Suspend first when access must stop. Suspension revokes the target's administrator sessions without affecting customer-realm sessions.
3. Reactivate only after reviewing the reason and security state. Reactivation does not sign the person in.
4. Use irreversible anonymization only for an already suspended administrator, after retention and incident requirements have been checked. It removes direct credentials, role assignments, MFA/recovery material and identifying profile fields while preserving stable audit/history references.

You cannot suspend, reactivate, or anonymize your own administrator account. The system also refuses to suspend or anonymize the last operational Super Administrator. Do not work around either control in the database.

For customer accounts, suspension revokes only customer sessions and is reversible. Permanent disable is suspended-first and prevents future access while preserving historical records. The customer drawer also supports factual internal notes, safe reset communication, customer-realm session revocation, and an audited minimized JSON export. Customer anonymization is a separate, explicitly confirmed Super Administrator action: disable first, ensure every order is terminal, then run anonymization. It clears direct credential/account/address identifiers but deliberately preserves immutable order, delivery, cash, consent, internal-note, security, and audit history.

## Login and recovery

- Repeated failures are throttled and security-logged. Do not weaken limits to solve an individual account issue.
- Use self-session view to revoke unfamiliar sessions. Suspension/password reset/security response can revoke all.
- Recovery codes are single use. After using one, review login history and regenerate the set.
- TOTP reset is a high-risk, recent-authenticated, audited recovery procedure with identity verification and preferably a second administrator.
- If compromise is suspected, suspend/revoke first and follow incident response.

## Dashboard checks

At the start of an operational shift, review:

- Checkout/maintenance/prelaunch state and operational blockers
- System readiness, errors, database/Redis, queue depth/dead letters
- Login/security anomalies and privileged actions
- Orders awaiting confirmation/hold/preparation
- Low/out-of-stock and expiring reservations/batches
- Delivery assignments, attempts, failed age checks, returns
- Expected/collected/unremitted COD and open discrepancies
- Failed notifications/provider callbacks

Dashboard summaries are pointers. Financial and operational decisions must drill into the itemized source events and a consistent cutoff.

## Catalog and inventory

- SKU is unique; barcode is unique when present. Resolve duplicate warnings before publish/import.
- Product, variant, category, and brand archival removes them from purchase while historical order snapshots remain.
- On a fresh store, create and publish the first category and brand from the product editor before saving the first product. The editor exposes archive/restore separately; archived products cannot be edited as though they were active.
- Price changes require the correct permission and are audited with safe before/after values.
- Upload only operator-approved JPEG, PNG, or WebP rasters and supply meaningful French and Arabic alt text. Validation is synchronous; a successful upload is recorded as approved, not placed in an external moderation queue.
- Never edit stock as a catalog field. Use inventory receipt, adjustment, transfer, reservation, or disposition commands with reason/evidence.
- Record supplier stock through an expiring, idempotent batch receipt. Manual adjustments enter a 24-hour approval queue and the requester cannot approve or reject their own request. Transfers create paired source/destination movements in one transaction.
- Returned stock remains in inspection until an Inventory Manager explicitly restocks/quarantines/damages/expires it.

### Product image workflow

1. Open the product image list with `products.read`; choose the product owner or one exact variant owner and note its current owner version.
2. With `products.update`, recent authentication, and the administrator CSRF token, upload the `file` plus non-empty `altTextFr`, `altTextAr`, and `expectedOwnerVersion`. Do not reuse customer-supplied filenames as labels.
3. Review the rendered storefront/cart result in both locales. Update either alt-text field with the latest owner version when wording changes.
4. Set one approved image primary and submit reorder requests containing every active image ID for that one owner exactly once.
5. Use replacement to change bytes without losing order/primary metadata. Use delete to soft-retire an image; when a primary image is removed, the service promotes the next approved image when available.
6. On `PRODUCT_MEDIA_VERSION_CONFLICT`, reload the product/variant and its image list. Never retry with a guessed version or edit image rows/object keys directly.

The API ignores original filenames, generates non-guessable storage keys, verifies MIME plus magic bytes, fully decodes the raster, enforces byte/pixel limits, rejects SVG/executable/animated/trailing content, and records a SHA-256 checksum. Each image belongs to exactly one product or variant, and product-scoped lookup prevents cross-product image actions. Local development writes beneath the configured ignored upload directory; MinIO/S3 credentials stay in server environment variables and must never be copied into the browser or admin notes.

## Orders and delivery

- Validate address/zone/phone-confirmation/manual-review requirements before confirmation.
- Use only transitions offered by the server; an error indicates a real permission/state/version/precondition failure.
- Never mark delivered without the configured age-verification and cash outcomes.
- Failed age verification starts refusal/return handling and cannot be overridden directly to delivered.
- Manifest/CSV files contain sensitive customer data; download only when necessary and dispose according to policy.
- Delivery CSV exports require `deliveries.read`, `reports.export`, and recent authentication. Import once as a dry run, resolve every rejected row, then explicitly confirm the atomic apply.
- See docs/DELIVERY_OPERATIONS.md for the complete state machine.

## COD

Treat expected, collected, held, remitted, discrepant, and reconciled as different values. Do not close a batch from a dashboard total alone.

- Record exact collection against the correct delivery/order.
- Keep the browser-generated operation key unchanged when retrying an interrupted collection request; never reuse it for changed cash data or a different operation.
- Create remittance from eligible unallocated collection events.
- Count cash independently and attach approved minimal evidence.
- Reconciliation requires cash.reconcile, recent authentication, and threshold-based dual review.
- Open and resolve differences through discrepancy/compensating events; the discrepancy opener cannot resolve their own case. Record the verified amount and reason for resolution, or an explicit write-off reason; never edit original collection or remittance rows.

Follow docs/COD_RECONCILIATION.md.

## Customer support and privacy

- Search by normalized phone/email/order number only for a legitimate support purpose.
- Add factual notes without unnecessary sensitive data or unverifiable accusations.
- One failed delivery does not automatically justify blocking a customer.
- Suspension/blocking requires the permission, reason, scope/expiry, evidence and audit; permanent block is elevated.
- The implemented per-customer JSON export is bounded, minimal and audited; it excludes credentials, sessions and internal notes and reports when the 500-order bound truncates the result.
- Customer anonymization requires disabled/suspended state, rejects active orders, records the completed request and preserved data classes, and never rewrites historical financial/order snapshots.
- Do not store identity-document photographs by default.

## Store and configurable customer requirements

Checkout is controlled by operational state only: checkout must be enabled, maintenance and prelaunch must be off, required store information must be complete, and at least one valid delivery or pickup method must exist. A configured minimum age is required whenever an enabled entry, checkout, or delivery age control uses it. Legal approval metadata and document publication are not executable checkout prerequisites.

The six configurable controls are `age_gate.entry.enabled`, `age_gate.checkout.enabled`, `consent.terms.required`, `consent.privacy.required`, `consent.recording.enabled`, and `delivery.age_verification_required`. Review the resulting storefront, checkout, order snapshot, and delivery behavior after changing any one. A disabled confirmation does not disable unrelated authorization, CSRF, server pricing, stock, delivery, idempotency, or order validation.

Settings changes require the matching permission, recent authentication, explicit confirmation, a reason, optimistic version checking, and audit. Published optional text is versioned rather than edited in place. Product, brand, or category suspension must take effect immediately. Use maintenance or the checkout kill switch for an operational stop; do not alter customer-confirmation settings as an incident shortcut.

The Settings page only enables controls for primitive keys that the API explicitly allows to be published. Secret, structured, legacy or otherwise unsupported rows remain read-only even if they are visible in the redacted list. Use **Exporter sans secrets** / **تصدير دون أسرار** for buyer transfer: the server requires CSRF and recent authentication, omits secrets defensively, bounds the result, records a value-free audit event and returns a checksum. Treat the resulting JSON as controlled operational material. It is a review/transfer artifact, not an automatic import; apply values through validated setting mutations in the destination environment.

## Reports and exports

Choose a precise Africa/Tunis display range and confirm its UTC cutoff. Reports distinguish order creation/confirmation/delivery from cash collection/remittance/reconciliation. The inventory, COD collection, and COD remittance screens provide immediate audited CSV exports capped at 500 active-filter rows; they require their read permission, `reports.export`, and recent authentication. Delivery status/manifest exports follow the same bounded formula-safe rule. Narrow filters before exporting; downloaded files are controlled operational material and must be deleted when no longer needed. A generic asynchronous large-export service is not claimed.

## Dangerous actions

Role/permission changes, admin suspension/MFA reset, customer permanent block, inventory correction, product deletion, price changes, checkout/operator-policy changes, delivery override, cash reconciliation, and bulk export require explicit confirmation. The API also checks permission, recent auth, expected version/state, reason, and audit. If any of those controls is missing, stop and report it.

## End of shift

- Resolve or hand over pending orders/returns/failed jobs with named owners.
- Confirm courier manifest custody and open deliveries.
- Perform COD close/reconciliation or explicitly carry forward discrepancies.
- Revoke temporary access, discard expired exports, and sign out.
- Report unusual security, cash, age, inventory, or customer-data events through the incident channel.
