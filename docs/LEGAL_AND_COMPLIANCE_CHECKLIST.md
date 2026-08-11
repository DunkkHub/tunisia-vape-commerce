# Optional purchaser/operator legal and compliance checklist

## Boundary

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

This document is a neutral recordkeeping template, not legal advice and not a statement that any product, import, advertisement, sale, collection, or delivery is lawful in any jurisdiction. It does not define a legal conclusion, a required document set, or a software launch gate. The application does not inspect this checklist, require legal approval metadata, or require publication of legal documents before checkout.

The purchaser/operator decides whether to use this checklist, which advisers to engage, what records to retain, and what configuration is appropriate. Keep privileged advice, identity records, credentials, and other sensitive evidence outside this repository in an access-controlled system.

## Optional ownership record

| Field                        | Purchaser/operator entry |
| ---------------------------- | ------------------------ |
| Operating entity             |                          |
| Responsible owner            |                          |
| Jurisdiction and sales scope |                          |
| Products and suppliers       |                          |
| Adviser or reviewer          |                          |
| Controlled evidence location |                          |
| Review date                  |                          |
| Next review date             |                          |

## Optional review topics

The following prompts are intentionally general. They are not assertions about Tunisian law and are not software-readiness conditions:

- authority to operate, import, stock, advertise, sell, and deliver the actual product classes;
- customs, tax, invoice, accounting, and cash-on-delivery treatment;
- product classification, labeling, warnings, traceability, batch/expiry, and recall handling;
- customer information, price display, order confirmation, cancellation, return, refund, and complaint procedures;
- any age restriction and the operator's chosen entry, checkout, pickup, and delivery process;
- privacy notices, cookies, consent/other processing choices, data-subject requests, retention, providers, transfers, and incident response;
- delivery coverage, courier responsibilities, failed delivery, refused delivery, proof, and cash custody;
- advertising, promotions, localized content, customer messages, and audience controls; and
- review triggers when products, suppliers, providers, countries, business processes, or applicable rules change.

For each topic the purchaser/operator chooses to review, record only a reference to the controlled evidence, the decision owner, the configuration/action arising from it, and a review date. Do not put the advice itself in this repository.

## Software configuration mapping

The application exposes the following independent operator-controlled booleans. A fresh structural seed sets all six to `true`:

| Key                                  | Technical effect when enabled                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `age_gate.entry.enabled`             | Requires the signed storefront entry confirmation before age-gated catalog access |
| `age_gate.checkout.enabled`          | Requires checkout age confirmation and records `Order.ageConfirmedAt`             |
| `consent.terms.required`             | Requires the checkout terms confirmation                                          |
| `consent.privacy.required`           | Requires the checkout privacy confirmation                                        |
| `consent.recording.enabled`          | Records the enabled confirmation evidence                                         |
| `delivery.age_verification_required` | Requires an age-verification outcome before delivery completion                   |

`minimum_purchase_age` is required only when an enabled age control needs it. These settings express operator choices; they do not establish legality or approval. Disabling one does not bypass customer/admin realm separation, CSRF, permissions, server-authoritative pricing, delivery pricing, idempotency, stock locking, order-state validation, COD controls, or audit.

Settings are changed through the protected administrator settings API with the required permission, recent authentication, explicit confirmation, reason, optimistic version, and audit event. Migration `20260720010000_configurable_checkout_consent` makes `Order.ageConfirmedAt` nullable so disabling checkout self-attestation does not require false evidence.

## Executable checkout boundary

The checkout policy evaluates only operational inputs:

- checkout is enabled in both environment and stored settings;
- maintenance and prelaunch are disabled;
- a positive minimum age exists when an enabled age control requires it;
- store name, phone, email, and address are configured; and
- an active pickup exists or an active supported zone has a current delivery rate.

It does not evaluate legal approval, this checklist, or the presence of a legal document. Optional document-version references are validated only when supplied as request data for an enabled confirmation.

## Handoff

If the purchaser/operator records a separate suitability decision, keep its owner, scope, date, conditions, and evidence reference in the purchaser/operator's controlled system. Do not encode that decision as a fake application test result or use it to change the engineering verdict in [PRODUCTION_READINESS_REPORT.md](../PRODUCTION_READINESS_REPORT.md).
