# Cash-on-delivery reconciliation

## Accounting boundaries

An order created is not revenue collected. A delivery marked delivered is not proof of remittance. The system distinguishes:

- Expected COD: immutable amount expected for an eligible order/delivery.
- Collected cash: cash event accepted from courier or store operator.
- Cash in courier custody: accepted collections minus accepted remittance allocations and approved cash-return/refund events.
- Remitted cash: money physically handed to/received by the business and allocated to collections.
- Reconciled cash: remittance and allocation reviewed against expected/collected evidence with no unresolved discrepancy.
- Discrepancy: a separately recorded shortage, overage, wrong allocation, counterfeit/damaged note, timing, or evidence issue.

All amounts are integer millimes in TND. Original events are append-only; corrections are reversing/compensating events.

## Roles and segregation

| Action            | Minimum permission            | Control                                      |
| ----------------- | ----------------------------- | -------------------------------------------- |
| View cash         | cash.read                     | Scope and PII minimization                   |
| Record collection | cash.collect                  | Recent auth; assigned shift; idempotent      |
| Create remittance | cash.remit                    | Courier custody and evidence                 |
| Reconcile/close   | cash.reconcile                | Full admin 2FA, recent auth, reason/evidence |
| Export report     | reports.export plus cash.read | Bounded, formula-safe, audited               |

Prefer a policy where the person recording courier remittance cannot approve the same reconciliation. High-value/discrepant batches require a second approver. A Super Administrator is still subject to recent authentication, audit, and immutable history.

## Collection

1. Validate delivery/order, payment method, expected amount, currency, assignment, and current state.
2. Require an operation idempotency key and reject conflicting replay.
3. Record collector, courier/store location, exact amount, UTC time, source, and safe evidence reference.
4. Partial collection is rejected unless a globally enabled, documented policy and explicit reason permit it.
5. Transition payment projection to the appropriate collected/pending/discrepancy state without mutating the original expected snapshot.
6. Append audit/security events and queue the safe notification after commit.

A collected amount never becomes available stock/order truth and does not itself mark a delivery successful.

## Remittance

1. Courier and accountant review open collections and system-calculated custody.
2. Create a DRAFT remittance for one courier/currency and bounded custody period.
3. Allocate immutable collection events; a collection cannot be actively allocated twice.
4. Count cash independently and enter received amount, recipient, place/time, denomination summary if approved, and evidence references.
5. Submit the batch. The server calculates expected, received, and difference; the browser cannot supply a trusted difference.
6. A separate authorized reviewer accepts or raises discrepancy.
7. Accepted allocations reduce courier custody exactly once. The remittance and items remain immutable except through compensating events.

## Reconciliation equations

For a remittance:

    expectedRemittance = sum(eligible allocated collected amounts)
    difference = receivedAmount - expectedRemittance

For courier custody at a cutoff:

    openCustody = sum(accepted collections)
                  - sum(accepted remittance allocations)
                  - sum(approved cash refunds or reversals attributable to custody)

For an order:

    outstandingCOD = expectedCOD
                     - accepted collections
                     + accepted collection reversals

Every term is sourced from immutable events at the same UTC cutoff and currency. Aggregated dashboards must reconcile back to itemized events.

## Discrepancies

Controlled reason codes include SHORTAGE, OVERAGE, PARTIAL_COLLECTION, WRONG_ORDER_ALLOCATION, DUPLICATE_ENTRY, COUNTERFEIT_OR_DAMAGED_CASH, MISSING_EVIDENCE, TIMING_CUTOFF, and OTHER_REVIEWED. OTHER requires explanatory text.

Workflow:

1. Open discrepancy linked to remittance/collection/order/delivery/courier.
2. Freeze affected close/allocation from silent edits.
3. Assign an investigator different from the original actor where possible.
4. Preserve manifests, collection events, counts, evidence, provider logs, and audit.
5. Resolve with approved compensating events, financial treatment, owner, reason, and second approval according to threshold.
6. Close only when expected, received, difference, and disposition all balance.

Suspected theft or systemic mismatch follows docs/INCIDENT_RESPONSE.md. Do not automatically suspend a courier/customer without reviewed evidence and policy.

## Status model

Order payment projections may include PAYMENT_PENDING, CASH_EXPECTED, CASH_COLLECTED_BY_COURIER, CASH_COLLECTED_AT_STORE, CASH_PARTIALLY_COLLECTED, CASH_REMITTED, RECONCILIATION_DISCREPANCY, REFUNDED, and CANCELLED. These are projections derived from events and validated transitions; changing a projection does not replace event history.

Remittances move through `DRAFT`, `SUBMITTED`, and then `VERIFIED` or `DISCREPANCY`; `REJECTED` and `CANCELLED` are reserved terminal values in the schema. Submitted/verified batches cannot be deleted. Verification must be performed by a different administrator from the one who submitted/received the remittance.

## Daily close

- Confirm all delivered/refused/failed deliveries have appropriate collection outcomes.
- Compare courier manifests to collections and open custody.
- Review unremitted cash by courier and age; alert past the approved threshold.
- Count and review submitted remittances with two-person control at threshold.
- Resolve or explicitly carry forward discrepancies.
- Reconcile dashboard totals to event-level exports and record cutoff/timezone.
- Lock/close the period according to accounting policy; later corrections use the next period's compensating entry.
- Export only the minimum needed data through audited formula-safe jobs.

## Reporting

Every report labels event basis and UTC/Africa-Tunis cutoff. Required views include expected COD, collected by courier/store, held by each courier, remitted, unremitted aging, discrepancy, daily reconciliation, and courier history. Never combine orders created with delivered revenue or reconciled cash.

The administrator cash screen exposes filterable collection and remittance lists plus `GET /api/v1/admin/cash/collections/export.csv` (`COD_COLLECTIONS_V1`) and `GET /api/v1/admin/cash/remittances/export.csv` (`COD_REMITTANCES_V1`). Both exports require `cash.read`, `reports.export`, and recent authentication; they are audited, capped at 500 filtered rows, contain integer millimes, omit customer contact/address data, and neutralize spreadsheet formula prefixes.

## Tests

- Exact collection and store-pickup collection
- Partial collection rejected by default
- Duplicate collection/remittance allocation blocked
- Unauthorized and stale-recent-auth reconciliation denied
- Same actor approval denied where dual control applies
- Shortage/overage opens discrepancy and balances
- Reversal creates compensating event without editing origin
- Concurrent remittance cannot allocate one collection twice
- Cancelled/refused/failed-age orders do not appear as collected revenue
- Dashboard aggregates equal itemized ledger at identical cutoff
- CSV export neutralizes formulas and omits unnecessary PII
