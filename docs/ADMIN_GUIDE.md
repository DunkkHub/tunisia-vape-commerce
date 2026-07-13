# Administrator guide

## Access boundary

Administrator access is separate from customer access:

- Customer UI login: /login
- Administrator UI login: /admin/login
- Customer API authentication: /api/v1/auth/customer/*
- Administrator API authentication: /api/v1/auth/admin/*

Use the dedicated admin hostname in controlled staging/production. Do not sign into admin from a shared or untrusted device. Customer credentials/cookies cannot authorize admin APIs, and an admin password alone is insufficient: a full administrator session requires mandatory TOTP or a one-time recovery code.

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

For customer accounts, suspension revokes only customer sessions and is reversible. Permanent disable is suspended-first and prevents future access while preserving order, payment, delivery, consent, audit, and other required historical records. It is not privacy erasure. Route a customer's erasure/anonymization request through the legally reviewed privacy workflow and retention policy.

## Login and recovery

- Repeated failures are throttled and security-logged. Do not weaken limits to solve an individual account issue.
- Use self-session view to revoke unfamiliar sessions. Suspension/password reset/security response can revoke all.
- Recovery codes are single use. After using one, review login history and regenerate the set.
- TOTP reset is a high-risk, recent-authenticated, audited recovery procedure with identity verification and preferably a second administrator.
- If compromise is suspected, suspend/revoke first and follow incident response.

## Dashboard checks

At the start of an operational shift, review:

- Checkout/legal/maintenance/prelaunch state
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
- Price changes require the correct permission and are audited with safe before/after values.
- Upload only approved raster images, supply meaningful localized alt text, and wait for security processing before publication.
- Never edit stock as a catalog field. Use inventory receipt, adjustment, transfer, reservation, or disposition commands with reason/evidence.
- Returned stock remains in inspection until an Inventory Manager explicitly restocks/quarantines/damages/expires it.

## Orders and delivery

- Validate address/zone/phone-confirmation/manual-review requirements before confirmation.
- Use only transitions offered by the server; an error indicates a real permission/state/version/precondition failure.
- Never mark delivered without the configured age-verification and cash outcomes.
- Failed age verification starts refusal/return handling and cannot be overridden directly to delivered.
- Manifest/CSV files contain sensitive customer data; download only when necessary and dispose according to policy.
- See docs/DELIVERY_OPERATIONS.md for the complete state machine.

## COD

Treat expected, collected, held, remitted, discrepant, and reconciled as different values. Do not close a batch from a dashboard total alone.

- Record exact collection against the correct delivery/order.
- Create remittance from eligible unallocated collection events.
- Count cash independently and attach approved minimal evidence.
- Reconciliation requires cash.reconcile, recent authentication, and threshold-based dual review.
- Resolve differences through discrepancy/compensating events; never edit original collection or remittance rows.

Follow docs/COD_RECONCILIATION.md.

## Customer support and privacy

- Search by normalized phone/email/order number only for a legitimate support purpose.
- Add factual notes without unnecessary sensitive data or unverifiable accusations.
- One failed delivery does not automatically justify blocking a customer.
- Suspension/blocking requires the permission, reason, scope/expiry, evidence and audit; permanent block is elevated.
- Data exports are queued, minimal, time-limited, formula-safe and audited.
- Deletion/anonymization requests follow legal retention review; historical financial/order integrity is preserved.
- Do not store identity-document photographs by default.

## Compliance and store gates

Checkout remains closed until legal review is recorded, checkout is enabled, and minimum age, store data, and a valid delivery method are configured. Legal-document publication is maintained as human compliance evidence, but it is not an executable checkout-readiness prerequisite.

Legal publication creates a version; never edit a version customers already accepted. Product/brand/category suspension must take effect immediately. Changing minimum age, warnings, legal publication, age-at-delivery policy, checkout state, or legal-review state requires compliance permission, recent authentication, confirmation, and audit.

Prelaunch and maintenance are operational controls, not legal bypasses. Never temporarily toggle a legal prerequisite to complete a real order.

## Reports and exports

Choose a precise Africa/Tunis display range and confirm its UTC cutoff. Reports distinguish order creation/confirmation/delivery from cash collection/remittance/reconciliation. Large exports run in background, expire quickly, omit unnecessary PII, neutralize spreadsheet formulas, and create an audit record.

## Dangerous actions

Role/permission changes, admin suspension/MFA reset, customer permanent block, inventory correction, product deletion, price changes, checkout/compliance/legal changes, delivery override, cash reconciliation, and bulk export require explicit confirmation. The API also checks permission, recent auth, expected version/state, reason and audit. If any of those controls is missing, stop and report it.

## End of shift

- Resolve or hand over pending orders/returns/failed jobs with named owners.
- Confirm courier manifest custody and open deliveries.
- Perform COD close/reconciliation or explicitly carry forward discrepancies.
- Revoke temporary access, discard expired exports, and sign out.
- Report unusual security, cash, age, inventory, or customer-data events through the incident channel.
