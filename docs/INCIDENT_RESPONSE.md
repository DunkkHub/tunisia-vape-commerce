# Incident response

## Purpose

This runbook covers security, privacy, availability, inventory/order integrity, delivery, and COD incidents. It does not replace legal advice. Notification deadlines, affected-person communications, evidence handling, and regulator/law-enforcement engagement require qualified Tunisian guidance.

## Roles

- Incident Commander: owns severity, decisions, timeline, and handoffs.
- Technical Lead: containment, diagnosis, recovery, and change review.
- Security/Privacy Lead: evidence, exposure assessment, credential rotation, notification advice.
- Operations/COD Lead: courier cash, inventory, delivery, and manual reconciliation.
- Communications Lead: approved internal/customer/provider updates.
- Scribe: immutable UTC timeline, decisions, actors, evidence references, and action items.

One person may fill multiple roles in a small team, but high-risk cash/data decisions require a second reviewer.

## Severity

| Severity | Examples                                                                                                                                                                                  | Initial response target             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| SEV-1    | Active admin compromise, confirmed customer-data exfiltration, incorrect COD reconciliation at scale, widespread duplicate orders/oversell, destructive corruption, checkout causing harm | Immediate; page all required owners |
| SEV-2    | Contained privilege abuse, material checkout outage, delivery/age controls failing, backup gap, significant provider compromise                                                           | Within 30 minutes                   |
| SEV-3    | Limited degraded feature, isolated failed job, suspicious activity without confirmed impact                                                                                               | Same business day                   |
| SEV-4    | Weakness or alert requiring planned remediation, no active impact                                                                                                                         | Triage into owned work              |

Targets are provisional until an on-call policy is approved.

## First response

1. Open a private incident record with UTC start, reporter, symptoms, affected environment, and current severity.
2. Assign commander/scribe and establish a private communications channel.
3. Preserve logs, audit/security events, metrics, traces, image digest, configuration versions, database/binlog point, queue state, and provider evidence. Use hashes/read-only copies.
4. Contain the narrowest safe boundary. Enable maintenance or disable checkout immediately when order, age, stock, price, delivery, cash, or customer safety integrity is uncertain.
5. Rotate/revoke exposed credentials and sessions. Do not wait for full root cause.
6. Determine scope by data/time/principals/resources, not assumptions.
7. Recover through reviewed changes and verify invariants before reopening.
8. Provide factual, timestamped updates without speculation or sensitive exploit detail.

Do not delete attacker accounts, logs, queues, or compromised resources until evidence is preserved. Do not edit historical business/audit records to hide the incident.

## Playbooks

### Administrator account or session compromise

- Suspend the admin and revoke all admin sessions, pending challenges, invitations, reset tokens, and recent-auth assertions.
- Rotate affected credentials/TOTP/recovery codes and any secret accessible to the principal.
- Review login, MFA, role/permission, export, setting, compliance, product price, inventory, delivery, COD, and audit events.
- Reconcile every privileged mutation with a trusted operator and create compensating events rather than rewriting history.
- Assess whether browser, email, endpoint, session store, or shared secret compromise affects other admins.

### Customer credential stuffing or account takeover

- Tighten realm-specific throttles/challenge policy, revoke affected sessions/tokens, and avoid account-confirming responses.
- Identify unauthorized address/order/profile/consent changes and preserve events.
- Notify affected customers only through an approved process after privacy/legal assessment.

### Data exposure

- Stop the exposure path, revoke download URLs/keys, preserve access records, and identify exact fields/subjects/time window.
- Check exports, backups, object versions, logs, analytics, provider copies, and caches.
- Engage qualified privacy/legal counsel for notification and retention decisions.
- Do not place exposed personal data in the incident ticket or chat.

### Inventory, pricing, duplicate-order, or checkout corruption

- Disable checkout and pause relevant workers.
- Record affected idempotency keys, orders, reservations, movements, prices/rules and transaction/binlog window.
- Do not mass-cancel, release, or restock until a reviewed reconciliation query/classification exists.
- Correct through idempotent compensating domain commands with actor/reason/audit.
- Prove final-unit, nonnegative stock, authoritative totals, and retry scenarios before reopening.

### Delivery age-control failure

- Block affected assignments/transitions and checkout if the control is systemic.
- Identify products, deliveries, courier/operators, age results, evidence and notification timeline.
- A failed/unknown required age check cannot be changed directly to delivered. Use approved return/exception investigation.
- Engage legal/operations leadership immediately; preserve minimal necessary evidence.

### COD discrepancy or suspected theft

- Freeze reconciliation for affected courier/remittance, preserve manifests, collections, evidence, shift/time and audit.
- Calculate expected custody from immutable delivery/collection/remittance events.
- Require two-person review for adjustment; do not modify original collection/remittance.
- Record a discrepancy and compensating reconciliation event with reason/evidence.
- Coordinate personnel/law-enforcement steps only through approved legal/HR policy.

### Malware or supply-chain compromise

- Stop deployment/promotion, isolate affected runner/image/host, preserve artifacts/SBOM/provenance and revoke CI/registry/deploy credentials.
- Identify first compromised version and all environments/digests.
- Rebuild from reviewed source and clean infrastructure with patched/pinned dependencies; do not trust a rebuild on a compromised runner.

### Availability, MySQL, Redis, or object-storage failure

- Prefer safe degradation: checkout off when authoritative dependencies are unavailable.
- Do not fail open authentication, authorization, compliance, stock, delivery, or COD.
- For MySQL corruption/loss follow docs/BACKUP_AND_RECOVERY.md.
- Redis loss revokes sessions safely and queues are rebuilt only from durable records/idempotent jobs.

## Recovery gates

Before reopening:

- Root cause or safe containment is understood.
- Compromised credentials/sessions are revoked and boundary tests pass.
- Database/object integrity and migration state pass.
- Inventory, idempotency, order, delivery, age, and COD invariants pass for the affected window.
- Queues/outbox are reconciled without duplicate external effects.
- Monitoring and alerts detect recurrence.
- Incident Commander, technical owner, and relevant security/legal/operations owner approve the staged reopening.

Reopen in stages: health/read-only, admin investigation, limited internal writes, then checkout. Keep an immediate rollback/disable path.

## Communications

Only the Communications Lead sends external updates. State verified impact, safe actions, time of next update, and support route. Avoid unsupported legal conclusions, blame, attack instructions, exact defenses, or promises about data that have not been verified.

Provider and customer notification obligations, language (French/Arabic), and timelines must be pre-approved with Tunisian counsel and contractual contacts.

## Post-incident review

Within five business days for SEV-1/2, document:

- Customer/business impact and actual UTC timeline
- Detection source and why controls did or did not work
- Technical and organizational contributing factors
- Recovery, actual data loss, RPO/RTO and manual reconciliation
- Evidence retained and notification decisions
- Corrective actions with owner, severity, due date and verification
- Required updates to threat model, tests, runbooks, alerts and training

The review is blameless but accountable. Track actions to verified closure and include unresolved material risk in the readiness report.
