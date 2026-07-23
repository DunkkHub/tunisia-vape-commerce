# Store and checkout configuration

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

Store settings are authoritative database records. Environment variables may impose a stricter operational stop, but cannot turn a stored disabled switch on. Use `/admin/settings` or the protected administrator settings API; never edit production rows directly.

## Fresh-install state

| Input or derived state         | Fresh value | Meaning                                                             |
| ------------------------------ | ----------- | ------------------------------------------------------------------- |
| `CHECKOUT_ENABLED`             | `true`      | Environment permits checkout                                        |
| `checkout.enabled`             | `true`      | Stored operational kill switch permits checkout                     |
| effective `CHECKOUT_DISABLED`  | `false`     | Derived state; there is no `CHECKOUT_DISABLED` environment variable |
| `MAINTENANCE_MODE`             | `false`     | Environment maintenance stop is off                                 |
| `maintenance.mode`             | `false`     | Stored maintenance stop is off                                      |
| `PRELAUNCH_MODE`               | `false`     | Environment prelaunch stop is off                                   |
| `prelaunch.mode`               | `false`     | Stored prelaunch stop is off                                        |
| legal-review requirement       | `false`     | Legal approval is not read by startup or checkout                   |
| legal-document-missing blocker | `false`     | Document publication is not a checkout-readiness input              |
| `minimum_purchase_age`         | `18`        | Used when at least one configured age control requires it           |
| store identity/contact         | empty       | Intentionally produces `STORE_INFORMATION_MISSING`                  |
| delivery method                | none        | Intentionally produces `DELIVERY_METHOD_MISSING`                    |
| latest expected migration      | configured  | `20260721023000_unverified_operator_source_urls`                    |

A fresh seed is therefore operationally blocked even though checkout and launch switches are open. This is intentional: buyers must provide real store information and delivery pricing.

## Complete store information

Set non-empty production values for all four keys:

- `store.name`
- `store.phone`
- `store.email`
- `store.address`

The seed also sets `store.currency=TND`, `store.timezone=Africa/Tunis`, and `store.default_locale=fr`. Money remains integer millimes and timestamps remain UTC regardless of display settings.

Settings mutations use:

- `PATCH /api/v1/admin/settings/store/:key` with `settings.manage`; or
- `PATCH /api/v1/admin/settings/compliance/:key` with `compliance.manage`.

Every mutation requires a full TOTP-verified administrator session, administrator CSRF, recent authentication, an allowlisted value type, the expected version, explicit confirmation, a reason, and audit.

## Export configuration for transfer

From the administrator Settings page, select **Exporter sans secrets** / **تصدير دون أسرار**, or call:

    POST /api/v1/admin/settings/export

This operation requires `settings.manage`, administrator CSRF and recent authentication. The response is stable and deterministic for the same stored configuration: it has no generated timestamp, orders each scope by key and stable identifier, and includes a SHA-256 checksum. The checksum covers the compact canonical JSON containing `format`, `schemaVersion`, `store`, `compliance`, and `excludedSecretCount`; it does not include its own `checksumSha256` field.

The export fails closed above 500 rows in either scope or 1 MiB. It omits every store row marked `secret` and every store/compliance key matching defensive secret, credential, password, token, API-key, private-key, encryption, database, Redis, SMTP or webhook patterns. The audit event records only counts, format and checksum. It never stores exported values. Infrastructure environment variables are outside the document.

There is intentionally no bulk import endpoint. Review the document, configure infrastructure separately, and publish destination values through the typed, versioned mutations so validation and audit cannot be bypassed.

## Settings authority and non-settings controls

Only keys already consumed by the application are seeded and writable. The current store allowlist is:

- launch controls: `checkout.enabled`, `maintenance.mode`, `prelaunch.mode`;
- identity: `store.name`, `store.phone`, `store.email`, `store.address`;
- fixed presentation invariants: `store.currency=TND`, `store.timezone=Africa/Tunis` and `store.default_locale` (`fr` or `ar`);
- durable notifications: `notifications.admin_order_created.enabled`, `notifications.customer_order_created.enabled`, `notifications.customer_order_sms.enabled`, the three optional internal recipients `notifications.security_alert_email`, `notifications.order_alert_email`, and `notifications.low_stock_alert_email`, plus `notifications.operational_alert_locale` (`fr` or `ar`). Empty internal-recipient values disable only that email channel and are the safe structural-seed defaults.

The compliance allowlist is `minimum_purchase_age` plus the six controls described below. Values that belong to another validated authority are not duplicated as inert database settings:

- French and Arabic are the bundled supported locales; changing the default does not remove either translation bundle.
- Product image byte and decoded-pixel ceilings are validated infrastructure variables (`UPLOAD_MAX_BYTES`, `UPLOAD_MAX_PIXELS`); the active-image owner limit remains a server invariant.
- Low-stock thresholds are versioned per product variant through inventory administration.
- Delivery prices and eligibility, including any zero-fee outcome, are expressed by validated effective delivery rates rather than a decorative global threshold.
- Reservation duration and order-number format remain transaction-domain invariants until an end-to-end setting consumer and migration-safe compatibility rule are implemented.
- Customer/admin cancellation eligibility comes from the tested order state machines; a settings value cannot weaken those controls.
- Policy content remains versioned content, not a mutable launch blocker or an unvalidated URL redirect.

This separation prevents the Settings page from offering controls that appear functional while the runtime ignores them.

## Configure delivery

Choose at least one path:

1. Create an active inventory location and an active pickup linked to it; or
2. Create a supported, non-suspended delivery zone, link active localities, create a current active base-geography rate in integer millimes, then activate the zone.

The readiness policy checks for an active pickup or an active, supported, non-suspended zone that owns a current active nonnegative zone-base rate. A rate attached to another zone cannot satisfy readiness. Quote and order creation still resolve the customer's actual locality and fail closed if no single valid rate matches. Test every offered locality, minimum order, maximum COD value, date range, surcharge, blackout, and ambiguity before sale.

## Configurable age, consent, and delivery controls

All six fresh-seed values are `true`:

| Key                                  | When `true`                                                           | When `false`                                               |
| ------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| `age_gate.entry.enabled`             | Signed entry confirmation is required before age-gated catalog access | Entry confirmation is omitted                              |
| `age_gate.checkout.enabled`          | Checkout age confirmation and `Order.ageConfirmedAt` are required     | Checkout may store `ageConfirmedAt=null`                   |
| `consent.terms.required`             | Checkout terms confirmation is required                               | Terms confirmation is not required                         |
| `consent.privacy.required`           | Checkout privacy confirmation is required                             | Privacy confirmation is not required                       |
| `consent.recording.enabled`          | Enabled confirmations and request evidence are recorded               | Confirmation evidence recording is disabled as implemented |
| `delivery.age_verification_required` | Delivery completion requires the configured age-verification result   | The delivery flow records the requirement as not required  |

Missing rows resolve fail-safe to `true`. `minimum_purchase_age` must be a positive integer when entry, checkout, or delivery age verification is enabled. The migration `20260720010000_configurable_checkout_consent` supports the nullable checkout timestamp; apply it before disabling checkout age confirmation.

These settings do not bypass authentication, CSRF, permissions, server-authoritative totals, inventory locks, delivery pricing, idempotency, order/delivery transitions, COD controls, or audit. Legal approval and legal-document publication are not executable requirements.

## Verify effective policy

After each change, call `GET /api/v1/checkout/policy` through the storefront session and inspect:

- `allowed`;
- `blockers`;
- `minimumAge`; and
- `requirements`.

The only global policy blockers are:

- `CHECKOUT_DISABLED`
- `MAINTENANCE_MODE`
- `PRELAUNCH_MODE`
- `MINIMUM_AGE_NOT_CONFIGURED`
- `STORE_INFORMATION_MISSING`
- `DELIVERY_METHOD_MISSING`

An allowed global policy is not an order guarantee. Quote/order processing separately enforces customer status, address ownership, catalog publication, restrictions, stock, price, delivery resolution, confirmation inputs, idempotency, and COD rules.
