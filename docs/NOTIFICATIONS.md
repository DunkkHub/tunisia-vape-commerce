# Notification operations

Legal and regulatory suitability is the responsibility of the purchaser/operator and is outside the software production-readiness assessment.

## Durable boundary

MySQL is the notification authority. Password reset, checkout order receipt, administrator order transitions, customer cancellation, coalesced security alerts, low-stock alerts, and internal new-order alerts create the `Notification` and version-1 `notification.dispatch.requested` `OutboxEvent` in the same API transaction. Empty operational-alert recipient settings disable that email without suppressing the underlying security event, stock projection, order, or audit evidence. The event contract is:

```json
{
  "eventType": "notification.dispatch.requested",
  "eventVersion": 1,
  "deterministicKey": "notification-dispatch:v1:<notificationId>",
  "payload": { "notificationId": "<notificationId>" }
}
```

The worker's bounded notification bridge remains a recovery path for an older/queued notification without its event. Its deterministic upsert cannot duplicate an event already created by the API.

BullMQ receives only the outbox ID, event type, and version. The worker reloads and validates the event aggregate and notification from MySQL. Recipient and message content are never copied into the queue job.

## Claim, send, and finalize

Notification delivery uses three phases:

1. A short `READ COMMITTED` transaction locks the outbox event and notification, rejects mismatched aggregates, marks both processing, closes any expired processing attempt, and creates the next numbered `NotificationDeliveryAttempt`.
2. The worker decrypts only the fields required for that message, renders an allowlisted localized plain-text template, and calls the provider outside the database transaction with strict timeouts.
3. A second short transaction records the provider message ID and changes the attempt, notification, and outbox together to delivered/processed, failed/retry, or dead-letter.

If a provider accepted a message but the final database commit failed, the retry uses the same SHA-256-derived provider idempotency key. SMTP receives a deterministic `Message-ID` and `X-Idempotency-Key`; the SMS webhook receives an `Idempotency-Key` header and the same identifier in its body. SMTP acceptance alone cannot guarantee provider-side deduplication, so duplicate suppression must also be verified with the selected provider.

An already delivered/cancelled notification is an idempotent no-op and its outbox event is closed without sending again. Expired processing attempts are retained as failed evidence rather than overwritten.

## Encryption and logging

`encryptedRecipient` and the password-reset payload token use the API's AES-256-GCM field format. The worker derives the key from `FIELD_ENCRYPTION_KEY`, authenticates/decrypts in memory, renders/sends, and does not persist plaintext. Temporary key/cleartext buffers are cleared where Node buffers permit; JavaScript strings are kept to the smallest delivery scope.

The worker never logs recipient, encrypted recipient, reset token, subject, body, provider credential, authorization header, or provider response body. Logs contain only notification/outbox IDs, channel, event, attempt number, provider name, outcome, and allowlisted error code.

## Adapter modes

| `NOTIFICATION_ADAPTER` | Environment       | `EMAIL`                        | `SMS`                                     | `CONSOLE`                                 |
| ---------------------- | ----------------- | ------------------------------ | ----------------------------------------- | ----------------------------------------- |
| `console`              | Development/test  | Rejected                       | Rejected                                  | Safe development no-op                    |
| `smtp`                 | Development/test  | Real SMTP (Mailpit by default) | Explicit `console-development` simulation | Explicit `console-development` simulation |
| `smtp-webhook`         | Production target | SMTP                           | Authenticated HTTPS webhook when enabled  | Rejected                                  |
| `disabled`             | Development/test  | Rejected                       | Rejected                                  | Rejected                                  |

Production accepts only `smtp-webhook`. `disabled`, `console`, and SMTP-only modes fail worker configuration before a heartbeat can report ready; they cannot silently claim production delivery. `SMS_ENABLED=false` is an explicit supported production mode: it requires no SMS credentials, and any queued SMS is closed as `CANCELLED` with `NOTIFICATION_CHANNEL_DISABLED` rather than creating retry or dead-letter noise.

## Local Mailpit email

Development Compose defaults the worker to `NOTIFICATION_ADAPTER=smtp` with:

```text
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_REQUIRE_TLS=false
EMAIL_FROM=no-reply@local.test
```

Start the stack and open Mailpit:

```powershell
docker compose up -d mysql redis mailpit
docker compose up -d --build migrate api worker web nginx
```

- Storefront/gateway: `http://localhost:8080`
- Mailpit UI: `http://localhost:8025`

Request a password reset for an existing active customer and verify the localized email and `/password-reset/confirm?token=...` link in Mailpit. Do not paste the token into logs, tickets, screenshots, or test fixtures. Local `smtp` mode labels SMS simulations as `console-development`; it does not claim an SMS was delivered.

## Production SMTP

Production requires all of:

- `NOTIFICATION_ADAPTER=smtp-webhook`
- `FIELD_ENCRYPTION_KEY` matching the API key (32+ non-placeholder characters)
- HTTPS `WEB_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and a 16+ character `SMTP_PASSWORD`
- `EMAIL_FROM` and optional `EMAIL_FROM_NAME`
- either `SMTP_SECURE=true` for implicit TLS or `SMTP_REQUIRE_TLS=true` for mandatory STARTTLS
- bounded `NOTIFICATION_CONNECT_TIMEOUT_MS` and `NOTIFICATION_REQUEST_TIMEOUT_MS`

Set `SMS_ENABLED=false` when the operator has not selected an SMS provider. SMTP remains mandatory
and fully operational in that mode; `SMS_WEBHOOK_URL` and `SMS_WEBHOOK_AUTH_TOKEN` must be empty or
omitted.

TLS certificate validation is always enabled. Production rejects Mailpit/localhost and reserved development sender domains.

## Production SMS HTTPS contract

When `SMS_ENABLED=true`, configure `SMS_WEBHOOK_URL` (HTTPS only), a 24+ character
`SMS_WEBHOOK_AUTH_TOKEN`, and `SMS_SENDER`. The worker sends a redirect-disabled request:

```http
POST <SMS_WEBHOOK_URL>
Authorization: Bearer <credential>
Idempotency-Key: <sha256 identifier>
Content-Type: application/json
Accept: application/json
```

```json
{
  "messageId": "<same sha256 identifier>",
  "to": "+21620111222",
  "sender": "TunisiaVape",
  "body": "<localized allowlisted text>",
  "locale": "fr-TN",
  "event": "ORDER_CONFIRMED"
}
```

The provider must return a bounded JSON response with exactly one printable identifier:

```json
{ "messageId": "provider-message-id" }
```

HTTP 429/5xx, timeout/unavailability, 4xx rejection, and malformed response use distinct safe codes. All failures consume the bounded outbox attempt policy; the final failure marks the attempt, notification, and outbox `DEAD_LETTER` together.

## Templates

The worker renders French or Arabic from the stored locale and an allowlisted event/payload shape. It supports password reset; internal security and low-stock alerts; internal new-order alerts; and these customer order events: received, confirmed, on hold, preparing, handed to courier, out for delivery, attempted, rescheduled, delivered, refused, failed, cancelled, and return update.

Operational recipients and locale are validated settings: `notifications.security_alert_email`, `notifications.low_stock_alert_email`, `notifications.order_alert_email`, and `notifications.operational_alert_locale`. The structural seed leaves all three recipients empty so a fresh installation never sends internal data to a fabricated address. The operator publishes real recipients through the guarded settings workflow.

Unknown events, invalid order numbers, malformed encrypted fields, unsupported channels, invalid email addresses, and non-Tunisian SMS recipients fail closed. Arbitrary database HTML or message text is not rendered.

## Monitoring and acceptance

Monitor notification/outbox retries and dead letters, oldest available event, expired leases, provider latency/safe codes, worker heartbeat age, and the difference between synchronous provider acceptance and confirmed downstream delivery. The current implementation has no delivery-receipt webhook or dead-letter replay UI.

Before production acceptance:

- exercise SMTP and SMS success, timeout, retry, rejection, malformed response, final dead-letter, and idempotent replay with provider test accounts;
- verify credential rotation and TLS behavior;
- inspect logs/traces/queue state for recipient, token, message, and credential leakage;
- verify the exact French/Arabic customer copy and link hostname;
- configure dashboards and actionable alerts; and
- retain the final release-test and provider evidence.
