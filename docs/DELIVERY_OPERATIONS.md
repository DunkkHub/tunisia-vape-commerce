# Delivery operations

## Operating principles

The backend state machine is authoritative. UI options are only hints. Every transition is permission-checked, assignment-checked where relevant, concurrency-controlled, and appended to immutable history with actor, request ID, UTC timestamp, source, target, reason, and safe evidence references. CSV status application is additionally idempotent through a durable import receipt.

Age verification and cash collection are explicit outcomes, not assumptions inferred from a delivered status. A failed required age check cannot be delivered. Returned parcels are quarantined for inspection and stock is not restored automatically.

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
