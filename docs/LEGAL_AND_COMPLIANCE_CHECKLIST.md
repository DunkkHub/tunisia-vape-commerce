# Legal and compliance checklist

## Purpose and mandatory disclaimer

This document is an operational checklist, not legal advice and not a statement that selling, importing, advertising, or delivering vape products is lawful in Tunisia. Software controls cannot replace legal authorization.

Before any production launch, the business owner must obtain current written advice from qualified Tunisian legal, regulatory, tax, customs, privacy, and consumer-protection professionals. The advice must identify the legal entity, actual products, nicotine characteristics, suppliers, import routes, sales channels, advertising, age-verification process, couriers, return process, and launch date it covers. Verbal assurance, an old opinion, a supplier statement, or a software checkbox is not sufficient.

Use the evidence register below. Record references to controlled documents, not privileged legal advice or identity documents directly in this repository.

| Field                                   | Required value         |
| --------------------------------------- | ---------------------- |
| Business/legal entity                   | _Not configured_       |
| Responsible executive                   | _Not assigned_         |
| Qualified counsel/regulatory adviser    | _Not appointed_        |
| Written opinion date and review-by date | _Not obtained_         |
| Evidence repository reference           | _Not configured_       |
| Final compliance owner                  | _Not assigned_         |
| Launch decision                         | **BLOCKED BY DEFAULT** |

## Written professional confirmation required

The following items are mandatory launch blockers. For each item, the owner must record the adviser, written evidence reference, covered products/process, decision, conditions, implementation owner, and next review date.

- [ ] **Right to sell vape products.** Written confirmation of whether the business and its intended online/offline sales model may sell each product class in Tunisia, plus all licensing, registration, monopoly, or authorization conditions.
- [ ] **Import authorization.** Written confirmation for every intended product and supplier/import route, including who is the authorized importer and which evidence must be retained.
- [ ] **Customs obligations.** Written confirmation of classification, declarations, duties, records, restricted/prohibited goods treatment, and customs-clearance responsibilities.
- [ ] **Product labeling.** Written confirmation of mandatory languages, fields, placement, packaging, traceability, batch/expiry information, and responsible entity.
- [ ] **Product warnings.** Written approval of exact French and Arabic warning text, placement, prominence, product applicability, and revision process.
- [ ] **Nicotine-related restrictions.** Written confirmation covering concentration, container/device characteristics, product categories, possession/sale restrictions, and any additional approvals or records.
- [ ] **Advertising restrictions.** Written confirmation covering the storefront, search metadata, promotions, discounts, social channels, customer messaging, imagery, claims, targeting, and age-gating. No youth-targeted promotion is permitted by product policy.
- [ ] **Consumer-protection obligations.** Written confirmation of pre-contract information, order confirmation, pricing, delivery disclosures, guarantees, complaint handling, cancellations, unfair terms, and language requirements.
- [ ] **Required invoices and tax treatment.** Written confirmation of tax registration, tax rates/categories, millime rounding, invoice/receipt content, numbering, retention, COD recognition, refunds, and reporting.
- [ ] **Delivery restrictions.** Written confirmation of where and how products may be delivered or collected, courier obligations, recipient restrictions, refused/failed delivery handling, and cross-border prohibition if applicable.
- [ ] **Minimum legal purchasing age.** Written confirmation of the precise minimum age, scope, effective date, and whether different product classes require different treatment. Do not guess or seed a launch age.
- [ ] **Identity or age-verification requirements.** Written confirmation of checks required at entry, checkout, pickup, and delivery; acceptable evidence; failed-check workflow; record content; retention; and whether any document image may lawfully be collected.
- [ ] **Personal-data obligations.** Written confirmation of controller/processor roles, legal bases, notices, consent, cookies, security, data-subject rights, international transfers, vendors, breach response, retention, and regulator/registration obligations.
- [ ] **Return and refund obligations.** Written confirmation of withdrawal/return rights, exclusions, defect handling, timelines, costs, cash refunds, evidence, inventory inspection, and required customer disclosures.

For any qualified answer that is conditional, ambiguous, product-specific, or pending, the corresponding feature remains disabled. “No objection received” is not approval.

## Evidence record template

Create one controlled record per checklist item:

| Evidence field                            | Entry |
| ----------------------------------------- | ----- |
| Topic                                     |       |
| Adviser and qualification                 |       |
| Written advice date                       |       |
| Covered legal entity                      |       |
| Covered product SKUs/classes              |       |
| Covered suppliers/import routes           |       |
| Covered sales/delivery channels           |       |
| Decision and conditions                   |       |
| Evidence repository reference             |       |
| System configuration/change reference     |       |
| Business owner approval                   |       |
| Counsel confirmation after implementation |       |
| Effective date                            |       |
| Review/expiry date                        |       |

## Technical controls that must exist

These controls implement business decisions; their presence does not establish legality.

### Global launch and checkout gates

- [ ] `prelaunch.mode` is globally enforceable and remains `true` until launch approval.
- [ ] `maintenance.mode` blocks checkout and protected operational workflows safely.
- [ ] `checkout.enabled` is an independently controlled, audited kill switch.
- [ ] `legal_review.completed` is controlled by the compliance workflow and is `false` by default.
- [ ] Minimum purchasing age is configurable and zero/unset blocks checkout.
- [ ] Store legal name, phone, email, and address are configured and approved.
- [ ] At least one active, supported, currently valid delivery or pickup method is configured.
- [ ] Required French and Arabic legal-document versions are published and effective.
- [ ] Startup and runtime checks fail closed; a missing setting, cache failure, or database error never enables checkout.
- [ ] Sensitive gate changes require permission, recent admin authentication, confirmation, optimistic version checking, and an immutable audit event.

Production checkout is allowed only when all of these conditions are true at the same time:

```text
LEGAL_REVIEW_COMPLETED == true
CHECKOUT_ENABLED == true
PRELAUNCH_MODE == false
MAINTENANCE_MODE == false
minimum purchasing age is approved and configured
required legal documents are published and effective
store information is complete
at least one valid supported delivery method exists
```

Environment variables may impose a stricter stop, but must not override a database `false` to `true`. Emergency disabling must propagate promptly across all API instances and queues.

### Age-restricted access and delivery

- [ ] A mandatory age confirmation appears before store entry; denial does not expose the catalog.
- [ ] Checkout requires a fresh adult confirmation and stores the exact timestamp and approved age value.
- [ ] Terms and privacy acceptance are affirmative, separate, version-linked, and not preselected.
- [ ] The order stores whether age verification is required at delivery.
- [ ] Delivery records an explicit result: pending, passed, failed, refused, or unable to verify.
- [ ] A failed/refused/unverifiable required check cannot transition to `DELIVERED`.
- [ ] Failed verification triggers the approved failed-delivery/return-to-sender workflow and does not collect cash as a delivered sale.
- [ ] Pickup applies an equivalent approved verification workflow.
- [ ] Every override is exceptional, reasoned, permission-controlled, and audited; legal counsel has approved whether overrides may exist at all.
- [ ] Customer support scripts avoid soliciting unnecessary identity information.

The default design stores the result, method, minimum age, verifier, time, and reason—not the national identity number or an image of the identity document. National identity document photographs are disabled by default. Enabling their collection requires a separately approved legal basis, necessity/proportionality assessment, retention period, encryption and access design, processor review, deletion process, incident plan, and written authorization. Do not store them in ordinary proof-of-delivery photos.

### Product, brand, and category controls

- [ ] Any product, brand, or category can be suspended immediately without deleting historical orders.
- [ ] Suspended, archived, unpublished, expired, recalled, or otherwise restricted items cannot be searched, opened by direct URL, added, reserved, or checked out.
- [ ] Checkout revalidates restrictions inside the order transaction instead of trusting cart state.
- [ ] Restrictions support start/end times, reason, scope, creator, revocation, and audit history.
- [ ] Product age, nicotine, warning, batch, expiry, supplier, labeling, and traceability fields are reviewed for the actual inventory.
- [ ] Warning content is localized, version-controlled, approved, and snapshotted on historical order items where required.
- [ ] Promotions and imagery have a documented adult-audience review and do not target youth.
- [ ] Product recall and customer-contact procedures are documented and tested.

### Legal documents and consent

- [ ] Terms, privacy policy, return/refund policy, delivery policy, age policy, and legal warnings have identified owners.
- [ ] Each document is available in required languages; counsel confirms whether translations are authoritative and who approves them.
- [ ] Published versions are immutable and have a SHA-256 content hash, version number, publication time, effective time, and publisher.
- [ ] A replacement is a new version; older versions remain available for evidence and are retired rather than overwritten.
- [ ] Checkout stores an immutable snapshot/reference for every required consent, including document title/version/hash, granted result, timestamp, locale, source, and IP/user-agent metadata only where legally appropriate.
- [ ] Marketing consent is separate from mandatory contract/privacy acknowledgement and can be withdrawn.
- [ ] Cookie controls match the approved privacy/cookie position and do not use dark patterns.
- [ ] The system can determine which legal text applied to any historical order.

### Tunisia geography and fulfillment

- [ ] All 24 governorates are structural records; delegations, localities, postal codes, rates, and supported areas are verified by operations before use.
- [ ] Unsupported and temporarily suspended areas fail checkout explicitly.
- [ ] Fee resolution is deterministic and tested; the browser never supplies an authoritative fee.
- [ ] Minimum order, maximum COD, free-delivery threshold, weight/oversize/express surcharge, blackout date, available day, and time-window rules are configured and approved.
- [ ] No valid rate blocks checkout; a manual quote is possible only when the disabled-by-default feature is authorized and audited.
- [ ] Courier contracts/instructions include age verification, cash custody, proof, privacy, incident reporting, refused delivery, return-to-sender, and retention responsibilities.
- [ ] Courier exports contain only necessary fields, escape CSV formula characters, expire securely, and are audited.

### Cash on delivery, returns, and customer treatment

- [ ] Only cash on delivery or approved cash-at-pickup is offered; no misleading card/payment form exists.
- [ ] Partial cash collection is disabled by default and remains disabled unless expressly approved.
- [ ] Reports distinguish created, confirmed, delivered, cash collected, remitted, reconciled, refunded, and discrepant orders.
- [ ] Courier cash custody, remittance deadlines, evidence, discrepancy escalation, and dual-control thresholds are documented.
- [ ] Refund recording and cash refund evidence match the approved legal/tax process.
- [ ] Refused, failed, damaged, defective, and customer-returned goods follow documented return states.
- [ ] Returned stock is quarantined and inspected; it is never automatically sellable.
- [ ] Customer risk scoring and blocklisting criteria receive legal/fairness review. One refusal or failed delivery never causes automatic permanent blocking.
- [ ] Permanent blocks and manual overrides require elevated authority, a reason, notice/appeal treatment where required, and audit history.

### Personal data and security governance

- [ ] A data inventory maps each field, purpose, lawful basis, source, recipient, storage location, retention, and deletion/anonymization rule.
- [ ] Data minimization is applied to registration, checkout, delivery proof, support notes, exports, logs, metrics, and backups.
- [ ] Tunisian phone numbers are normalized for operations; sensitive identifiers used only for abuse controls are hashed where practical.
- [ ] Access control separates customer and administrator authentication realms, cookies, sessions, policies, and routes.
- [ ] Administrator TOTP 2FA, shorter sessions, recent-authentication checks, recovery-code protection, suspension, and complete revocation are enforced.
- [ ] Vendors (hosting, object storage, email, SMS, couriers, observability, backup) have approved contracts and transfer/security assessments.
- [ ] Data export, correction, deletion/anonymization, objection/withdrawal, identity verification, response deadlines, and exception/retention workflows are tested.
- [ ] Retention schedules cover customers, guest checkouts, abandoned carts, sessions, login/security logs, orders/invoices, consent, delivery proof, cash evidence, support notes, exports, uploads, backups, and legal versions.
- [ ] Deletion respects legally required accounting/compliance retention while anonymizing data that no longer needs to identify a person.
- [ ] Security and privacy incident response identifies decision-makers, advisers, processors, evidence preservation, and any legally required notification analysis.

## Pre-launch verification

All boxes below must be checked by named humans with evidence. A passing automated build is not launch approval.

- [ ] Every written-professional-confirmation item above is complete, current, and covers the deployed business model and actual products.
- [ ] Counsel reviewed the final French and Arabic storefront, warnings, legal documents, checkout, confirmation messages, invoices/receipts, delivery flow, and return flow.
- [ ] The responsible executive signed the documented residual-risk and launch decision.
- [ ] Compliance owner confirmed every production setting directly in the deployed environment.
- [ ] Required documents are published, effective, retrievable, and linked to tested consent snapshots.
- [ ] Age-gate, checkout confirmation, delivery verification, pickup verification, and failed-verification end-to-end tests pass.
- [ ] Product/category/brand emergency suspension is tested against catalog, direct URL, cart, reservation, and checkout.
- [ ] Unsupported-area and absent-rate tests fail closed.
- [ ] Customer/admin session crossover and admin-without-2FA tests fail closed.
- [ ] Audit evidence exists for gate changes, legal publication, restrictions, age results, cash reconciliation, and elevated overrides.
- [ ] Restore testing proves required legal, consent, order, delivery, cash, and audit history can be recovered.
- [ ] No demonstration administrator, default password, fake approval, fake product, or default production credential exists.
- [ ] Monitoring alerts on checkout-gate errors, failed age checks, illegal transitions, restriction failures, repeated admin login failures, and COD discrepancies.
- [ ] A rollback/kill-switch drill proves checkout can be disabled immediately without losing committed orders or ledger records.

## Ongoing review triggers

The compliance owner must stop or re-review affected operations before any of these changes go live:

- law, regulation, regulator guidance, tax/customs position, enforcement practice, or minimum age changes;
- a new product class, nicotine strength, brand, supplier, importer, labeling format, warning, or import route;
- a new advertising channel, promotion style, audience strategy, analytics/marketing tool, or customer message;
- a new courier, geography, pickup point, delivery/age-check method, manual quote process, or cross-border proposal;
- a new payment or refund method, partial COD feature, tax treatment, invoice format, or reconciliation workflow;
- a new personal-data field, identity check, document/photo capture, biometric/geolocation use, vendor, hosting region, or international transfer;
- material legal-document, retention, data-subject-rights, security, or incident-response change;
- a serious customer complaint, failed age delivery, suspected unlawful sale, recall, data incident, regulator inquiry, customs hold, or repeated courier non-compliance;
- expiry of a legal opinion, license, registration, supplier evidence, processor agreement, or insurance/contract requirement.

Review at a documented cadence even without a trigger. Record each review as a new audit/evidence event; do not overwrite prior conclusions.

## Final sign-off

| Role                                        | Name | Decision | Date | Evidence/signature reference |
| ------------------------------------------- | ---- | -------- | ---- | ---------------------------- |
| Qualified Tunisian legal/regulatory adviser |      |          |      |                              |
| Tax/customs adviser                         |      |          |      |                              |
| Privacy/data-protection adviser             |      |          |      |                              |
| Compliance owner                            |      |          |      |                              |
| Security owner                              |      |          |      |                              |
| Delivery/COD operations owner               |      |          |      |                              |
| Responsible executive                       |      |          |      |                              |

Until all mandatory evidence and sign-offs are complete, `legal_review.completed` and `checkout.enabled` remain false and `prelaunch.mode` remains true.
