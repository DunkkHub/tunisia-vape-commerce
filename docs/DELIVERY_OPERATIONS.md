# Delivery operations

## Operating principles

The backend state machine is authoritative. UI options are only hints. Every transition is permission-checked, assignment-checked where relevant, idempotent, versioned, and appended to immutable history with actor, request ID, UTC timestamp, source, target, reason, customer-visible note, internal note, and safe evidence references.

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

| Current              | Normally allowed next states                     | Preconditions                                                                      |
| -------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| PENDING_CONFIRMATION | CONFIRMED, ON_HOLD, CANCELLED                    | Contact/manual-review and compliance rules resolved                                |
| CONFIRMED            | PREPARING, ON_HOLD, CANCELLED                    | Inventory remains committed                                                        |
| ON_HOLD              | CONFIRMED, CANCELLED                             | Hold reason resolved                                                               |
| PREPARING            | READY_FOR_PICKUP, ON_HOLD, CANCELLED             | Pick/pack checks complete                                                          |
| READY_FOR_PICKUP     | ASSIGNED_TO_COURIER, DELIVERED, CANCELLED        | Direct DELIVERED only for store pickup after required age and cash outcomes        |
| ASSIGNED_TO_COURIER  | HANDED_TO_COURIER, READY_FOR_PICKUP, CANCELLED   | Courier/manifest valid; return to ready represents audited unassignment            |
| HANDED_TO_COURIER    | IN_TRANSIT, RETURN_TO_SENDER                     | Custody accepted                                                                   |
| IN_TRANSIT           | OUT_FOR_DELIVERY, RETURN_TO_SENDER, FAILED       | Tracking event valid                                                               |
| OUT_FOR_DELIVERY     | DELIVERED, DELIVERY_ATTEMPTED, REFUSED, FAILED   | Delivered requires successful/not-required age check and exact allowed cash result |
| DELIVERY_ATTEMPTED   | RESCHEDULED, REFUSED, FAILED, RETURN_TO_SENDER   | Attempt reason and age/cash results recorded                                       |
| RESCHEDULED          | ASSIGNED_TO_COURIER, OUT_FOR_DELIVERY, CANCELLED | New valid window and assignment                                                    |
| REFUSED              | RETURN_TO_SENDER                                 | Return workflow and custody recorded                                               |
| FAILED               | RESCHEDULED, RETURN_TO_SENDER                    | Failure reason determines retry eligibility                                        |
| RETURN_TO_SENDER     | RETURNED                                         | Warehouse/pickup receipt                                                           |
| DELIVERED            | None in delivery machine                         | Returns use a separate return workflow                                             |
| RETURNED             | None                                             | Inventory inspection follows separately                                            |
| CANCELLED            | None                                             | Reservations/custody handled by cancellation policy                                |

Transitions not listed are rejected. In particular, DELIVERED to PREPARING, CANCELLED to OUT_FOR_DELIVERY, and RETURNED to DELIVERED are impossible. An exceptional data correction is a separately approved compensating event; it does not erase or rewrite history.

## Order preparation and assignment

1. Confirm customer/contact and any manual-review requirement.
2. Verify address components against the configured Tunisia hierarchy and selected deterministic delivery rate.
3. Confirm warning/age-at-delivery requirement is visible on the pick/manifest record without exposing unnecessary personal data.
4. Pick by SKU/variant/batch; record exceptions. Do not substitute without an approved order correction.
5. Pack, label, weigh where needed, and mark ready.
6. Assign only to an active courier and supported service/zone. Bulk assignment validates every item atomically or reports per-item rejection without partial ambiguity.
7. Generate a unique tracking number, label and manifest. Downloads/exports are permission-checked and audited.
8. Courier accepts custody before HANDED_TO_COURIER. Record handoff UTC time and responsible actors.

## Delivery attempt

Each attempt records sequence number, scheduled/actual time, geographies needed for operation, assigned courier, outcome/reason, safe notes, age-verification result, cash result, next window, and evidence references. Provider callbacks are authenticated, replay-protected, mapped through an allowlist, and idempotent.

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

## Manifests and CSV

Manifests include only necessary delivery data, are access-controlled, time-limited, and audited. CSV import/export has a versioned schema, row limits, dry-run validation, duplicate/replay key, normalized phone/address validation, state-transition validation, and formula-injection neutralization. A malformed row cannot silently update another delivery.

## Daily controls

- Review unassigned ready orders, aging in-transit/out-for-delivery items, failed callbacks, repeated attempts, failed age checks, returns awaiting receipt, and deliveries lacking cash outcomes.
- Reconcile manifest custody at handoff and return.
- Review provider retries/dead letters and tracking-number collisions.
- Escalate impossible sequence, timestamp, assignment, age, or cash combinations as security/operations events.
- Never repair history directly in MySQL; use reviewed commands and compensating events.
