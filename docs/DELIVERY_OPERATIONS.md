# Delivery operations

## Operating principles

The backend state machine is authoritative. UI options are only hints. Every transition is permission-checked, assignment-checked where relevant, concurrency-controlled, and appended to immutable history with actor, request ID, UTC timestamp, source, target, reason, and safe evidence references. CSV status application is additionally idempotent through a durable import receipt.

Age verification and cash collection are explicit outcomes, not assumptions inferred from a delivered status. A failed required age check cannot be delivered. Returned parcels are quarantined for inspection and stock is not restored automatically.

The delivery configuration UI uses the active geography hierarchy to select governorate, delegation, or locality coverage by name; administrators never need to copy an internal geography identifier. Configuration codes are normalized to uppercase before validation. Mutation failures remain beside their originating form with a stable localized explanation and request reference; the generic service-retry panel is reserved for read failures.

`/admin/delivery` opens on a guided configuration workspace and keeps daily fulfillment and advanced CSV transfers in separate selectable workspaces. The configuration view presents zone, coverage, active-rate, and activation steps in order. Each zone card identifies its missing prerequisite and disables only activation—not deactivation—until both coverage and a current active base rate are present. Optional pickup setup and detailed zone editing use native disclosures so the primary workflow stays scannable. These controls are presentation guidance; the server repeats every activation check.

The idempotent structural seed loads the validated bilingual INS 2024 hierarchy: 24 governorates, 279 delegations, and 2,082 localities, including Bizerte's 14 delegations and 101 localities. The committed snapshot records Institut National de la Statistique (Tunisia), the `RGPH 2024 - population by sector, age and sex` dataset, source/download/license URLs, edition `2025-05-17`, retrieval `2026-07-27`, attribution, and source SHA-256 `70f8f9f872862d6947d08fc1b2775c66cf6b4d114a55f68092e7a4ce70d5d9ae`. Geography alone does not enable delivery: the seed creates no delivery zone, coverage link, rate, pickup, courier, or provider integration.

## Roles

- Order Manager: confirmation, hold, preparation, cancellation under policy
- Delivery Coordinator: courier/manifest assignment and delivery operations
- Courier user/integration: only assigned-delivery transitions exposed by scoped capability
- Inventory Manager: receipt/inspection/disposition of returned goods
- Accountant: cash custody/remittance/reconciliation views and actions
- Customer Support Agent: read and notes/reschedule operations specifically granted

No role obtains a transition merely because React displays it. Dangerous overrides require elevated permission, recent authentication, reason, approval where configured, and audit.

## Operational state machine

| Current              | Normally allowed next states                                | Preconditions                                                             |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| PENDING_CONFIRMATION | None in delivery controller                                 | Order confirmation owns the synchronized confirmation transition          |
| CONFIRMED            | PREPARING, ON_HOLD                                          | Inventory remains committed                                               |
| ON_HOLD              | CONFIRMED                                                   | Hold reason resolved                                                      |
| PREPARING            | READY_FOR_PICKUP, ASSIGNED_TO_COURIER                       | Pick/pack complete; courier target requires an existing active assignment |
| READY_FOR_PICKUP     | DELIVERED                                                   | Store pickup only; required age and exact cash evidence already durable   |
| ASSIGNED_TO_COURIER  | HANDED_TO_COURIER                                           | Manifest handoff can apply this atomically for every manifest item        |
| HANDED_TO_COURIER    | IN_TRANSIT                                                  | Custody accepted                                                          |
| IN_TRANSIT           | OUT_FOR_DELIVERY                                            | Tracking event valid                                                      |
| OUT_FOR_DELIVERY     | DELIVERED, DELIVERY_ATTEMPTED, RESCHEDULED, REFUSED, FAILED | Completion/attempt endpoint validates age, cash, outcome and next attempt |
| DELIVERY_ATTEMPTED   | RESCHEDULED                                                 | A controlled failed-attempt outcome is durable                            |
| RESCHEDULED          | OUT_FOR_DELIVERY                                            | New valid attempt time/window                                             |
| REFUSED              | RETURN_TO_SENDER                                            | Return workflow and custody recorded                                      |
| FAILED               | RETURN_TO_SENDER                                            | Failure evidence remains immutable                                        |
| RETURN_TO_SENDER     | RETURNED                                                    | Warehouse/pickup receipt                                                  |
| DELIVERED            | None                                                        | Returns use a separate return workflow                                    |
| RETURNED             | None                                                        | Inventory inspection follows separately                                   |
| CANCELLED            | None                                                        | Order cancellation owns eligible early-state cancellation                 |

Transitions not listed are rejected. In particular, DELIVERED to PREPARING, CANCELLED to OUT_FOR_DELIVERY, and RETURNED to DELIVERED are impossible. An exceptional data correction is a separately approved compensating event; it does not erase or rewrite history.

## Order preparation and assignment

1. Confirm customer/contact and any manual-review requirement.
2. Verify address components against the configured Tunisia hierarchy and selected deterministic delivery rate.
3. Confirm warning/age-at-delivery requirement is visible on the pick/manifest record without exposing unnecessary personal data.
4. Pick by SKU/variant/batch; record exceptions. Do not substitute without an approved order correction.
5. Pack, label, weigh where needed, and mark ready.
6. Assign only to an active courier. Manual records contain contact data and a credential-free manual marker; they do not represent a provider API. A courier cannot be disabled while it has non-terminal deliveries or active manifests.
7. Generate a unique tracking number and, when dispatch grouping is needed, an at-most-100-item manifest. Downloads/exports require `reports.export`, recent authentication, and an audit record.
8. Courier accepts custody before HANDED_TO_COURIER. Record handoff UTC time and responsible actors.

## Delivery attempt

Each attempt records sequence number, actual time, outcome/reason, safe notes, age-verification result, cash result, and next-attempt time. The assigned courier remains on the delivery. This repository exposes no courier callback or provider-tracking endpoint; external provider behavior must not be inferred from these manual workflows.

Do not store national identity-document photographs by default. For age checks, record only the configured result, method/category, verifier, timestamp, policy version, and minimal evidence reference approved by legal/privacy review.

If age verification is required:

- PASS may proceed to cash collection and DELIVERED.
- FAIL records a failed attempt/refusal and starts return workflow; it can never proceed to DELIVERED.
- NOT_PERFORMED or INCONCLUSIVE does not permit DELIVERED and follows reschedule/return policy.
- NOT_REQUIRED is valid only when server configuration/order snapshot says it is not required.

## Cash at delivery

The courier records cash collection as a separate idempotent event linked to the delivery and order. DELIVERED validates that the collected amount equals expected COD unless an explicitly enabled partial-collection policy authorizes a different flow. Partial collection is disabled by default.

Delivery staff cannot mark cash remitted or reconciled unless separately granted treasury permissions. See docs/COD_RECONCILIATION.md.

## Refusal, failure, and return

- REFUSED includes reason, cash-not-collected result, custody, and notification.
- FAILED distinguishes unreachable customer, invalid/access issue, damaged parcel, operational failure, failed age check, and other controlled codes.
- A retry requires policy eligibility and a valid new delivery window; attempts are never overwritten.
- RETURN_TO_SENDER records courier custody until warehouse acceptance.
- RETURNED creates inspection work. Inventory receives no available stock until an Inventory Manager records restock, quarantine, damage, expiry, or other disposition with a stock movement.

## Customer communication

Notifications are queued after commit, localized in French/Arabic, idempotent, and recorded per attempt. Customer-visible tracking exposes only safe status/time/window and notes; never internal risk, cash-control, courier-private, or security details. Manual phone confirmation is recorded as an operational event.

## Manual couriers

`GET /api/v1/admin/deliveries/courier-records` lists bounded records. Creation and optimistic update require `deliveries.update`, administrator CSRF, recent authentication, and an explicit confirmation string. Creation writes a `MANUAL` integration marker without credentials or provider configuration. Update refuses records carrying API/CSV integrations. Suspension and archival are non-destructive and fail with `COURIER_HAS_ACTIVE_CUSTODY` until every assigned delivery is terminal and every manifest is closed or cancelled. There is no courier-delete route.

The **Livraison -> Operations** workspace separates courier configuration from delivery execution:

1. Search or filter courier records by text, lifecycle status, or `AVAILABLE`/`OFF_DUTY` availability.
2. Create or edit the courier identity and contact details, normalized phone/WhatsApp number, availability, optional active-delivery capacity, default internal fee, WhatsApp template, and internal notes.
3. Select explicit delivery-zone coverage and, when needed, a zone-specific internal fee. Fees entered in the administration UI are TND text values converted to integer millimes before the API call. These costs never replace the customer-facing delivery rate.
4. Review the active-workload and coverage indicators before assigning a delivery. An off-duty or inactive courier cannot be selected. Outside-coverage and at-capacity assignments require the exact warning acknowledgement and remain visible in delivery history.
5. Use reasoned reassignment when custody rules allow it. Unassignment is limited to pre-custody states and is rejected while an active manifest contains the delivery.

Zero courier-zone rows preserve unrestricted legacy coverage; operators should configure explicit zones for new production couriers. Clearing a zone list therefore does not mean that the courier serves no zones. Lifecycle suspension and archival are the supported alternatives to deletion.

For manual WhatsApp handoff, select an assigned delivery and request the server-rendered preview. The API takes the recipient, immutable order/address snapshot, COD amount, and delivery instructions from server state, substitutes only allowlisted tokens into the bounded courier template, and returns an encoded HTTPS `wa.me` link. The application never sends the message. Copy or open the preview manually, then use the separate **contact recorded** operation to append delivery and audit evidence; the rendered message and customer address are not stored in audit metadata. Internal delivery notes use an optimistic version and audit only presence/length, not their text. Treat the preview as a customer-data disclosure and expose it only to an administrator performing the delivery handoff.

## Operator-supplied target service profiles

The following July 2026 target profiles are recorded as operational input. They are not seed data, are not active merely because they appear in this document, and do not claim an external provider integration.

| Profile         | Recorded target                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STANDARD_COD`  | Manual/Intigo operating label; national coverage; customer fee `8000` millimes (8.000 TND); cash on delivery; estimated 1–3 days; phone confirmation required; manual tracking; returns handled by the existing return-to-sender workflow |
| Bizerte Express | 30–50 minute target; only explicitly approved Bizerte localities; manual driver assignment; WhatsApp as persisted internal driver-communication metadata; cash on delivery                                                                |

Safe mapping to the current system:

- Represent Intigo and each manual driver/provider as credential-free manual courier records. A label or note does not enable an Intigo API.
- `STANDARD_COD` is an administrator UI preset, not a code-specific backend exception. It pre-fills `estimatedMinDays=1`, `estimatedMaxDays=3`, `paymentMethod=CASH_ON_DELIVERY`, `assignmentMode=MANUAL`, and `phoneConfirmationRequired=true`. National coverage still means linking every approved active locality, and the operator must separately create and activate a zone-scoped `BASE` rate of `8000` millimes.
- `BIZERTE_EXPRESS` is a reserved server-validated code. Before activation and on every update while active, it requires day estimates to be null, exact `estimatedMinMinutes=30` and `estimatedMaxMinutes=50`, `paymentMethod=CASH_ON_DELIVERY`, `assignmentMode=MANUAL`, and `driverCommunication=WHATSAPP`. Active coverage must come from explicit delegation/locality links that resolve entirely inside Bizerte; a whole-governorate link or any outside-Bizerte locality is rejected.
- COD, manually entered tracking numbers, and return-to-sender controls exist independently of a courier profile. A courier's phone, WhatsApp template, availability, capacity, coverage, and internal fees are operational configuration only. They do not send a message, enable a messaging adapter, or alter the customer delivery charge.

For every zone, day estimates must be supplied as an ordered complete 0–365 pair or minute estimates as an ordered complete 1–10,080 pair; the units cannot be mixed. Money values are integer millimes from 0 to 1,000,000. A zero rate is valid only when the zone explicitly configures a zero free-delivery threshold. The API refuses to remove that explicit free setting while any active zero-fee rate remains and rechecks the invariant before zone activation.

The rate-creation form and existing-rate editor are explicitly denominated in TND. They accept a dot or comma with at most three decimal places and convert the text with integer/`BigInt` arithmetic before sending `feeMillimes`; for example, `8` or `8,000` becomes the integer `8000`. Both show the converted millime/TND preview and enforce the one-million-millime ceiling. Updates also submit the current optimistic version, invalidate the delivery/checkout/storefront caches on success, and preserve a field-scoped error plus request reference on failure. Persisted values are reloaded from the API rather than retained only in component state.

Activation remains blocked until the operator selects the exact intended coverage and supplies a valid customer fee. A zone must resolve to at least one active locality and own one current active zone-scoped base rate before activation. Never bypass this by editing MySQL directly.

Customer-visible delivery methods, quotes, and created orders expose safe timing, COD, phone-confirmation, label, fee, and availability data only. They do not expose manual assignment, WhatsApp/phone driver communication, manual-review state, provider internals, or tracking operations. Those values remain available to authorized administrators and may be preserved in the immutable internal fulfillment snapshot.

## Manifests

A draft manifest contains 1-100 unique deliveries that are already `ASSIGNED_TO_COURIER`, have matching optimistic versions, belong to the selected active courier, and are absent from another draft/sealed/handed-over manifest. Creation locks affected orders and deliveries in deterministic identifier order and is all-or-nothing.

The lifecycle is `DRAFT -> SEALED -> HANDED_OVER -> CLOSED`; `DRAFT` or `SEALED` may instead become `CANCELLED`. Sealing revalidates assignment and the active courier. Handoff atomically changes every item and its mirrored order from `ASSIGNED_TO_COURIER` to `HANDED_TO_COURIER` and appends delivery, order, and audit histories. Closing is allowed only when every item is `DELIVERED`, `RETURNED`, or `CANCELLED`. Manifest detail and `DELIVERY_MANIFEST_V1` CSV exports include only dispatch-required recipient/address, COD, and age-check fields and are audited. CSV string fields are formula-neutralized.

## Status CSV

`GET /api/v1/admin/deliveries/exports/status.csv` emits an audited UTF-8 `DELIVERY_STATUS_V1` template with at most 500 rows. Optional exact status/courier and UTC updated-time bounds are server-validated. The file contains no recipient name, phone, email, or address. Every string cell is formula-neutralized.

`POST /api/v1/admin/deliveries/imports/status` accepts a JSON envelope with `importKey`, `dryRun`, `csv`, and the apply-only confirmation `APPLY_DELIVERY_STATUS_IMPORT`. The UTF-8 CSV is limited to 250 KB and 500 unique deliveries and must preserve the exact header/schema. Validation checks identifier, expected version, declared current status, mirrored order status, allowed transition, required courier, and required explanation. Dry-run never changes an order or delivery. Apply is all-or-nothing: any invalid row returns `valid=false, applied=false`; otherwise every transition and its histories/audits commit together.

Durable receipts are unique by `(importKey, dryRun)`, so operators may use one key for a dry-run and its later apply. An identical retry replays the stored bounded result. Reusing the same key/mode for changed bytes returns `DELIVERY_IMPORT_KEY_REUSED`. CSV import intentionally excludes delivery completion, failed/refused attempt outcomes, return completion, age evidence, and cash evidence. Those operations remain on their dedicated guarded endpoints, so CSV cannot bypass COD or age controls.

## Daily controls

- Review unassigned ready orders, aging in-transit/out-for-delivery items, repeated attempts, failed age checks, returns awaiting receipt, and deliveries lacking cash outcomes.
- Reconcile manifest custody at handoff and return.
- Review notification retries/dead letters, CSV import rejections, and tracking-number collisions.
- Escalate impossible sequence, timestamp, assignment, age, or cash combinations as security/operations events.
- Never repair history directly in MySQL; use reviewed commands and compensating events.
