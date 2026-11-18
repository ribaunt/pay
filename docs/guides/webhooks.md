---
icon: lucide/webhook
---

# Webhooks

Webhooks let your application react to payment events instead of polling. Events are queued in PostgreSQL when a status changes, then delivered by a separate cron job.

## Register an endpoint

```bash
curl -X POST https://pay.example.com/api/webhooks \
  -H 'content-type: application/json' \
  -H "x-api-key: $PAYMENT_API_KEY" \
  -d '{
    "url": "https://app.example.com/hooks/pay",
    "events": "payment.confirmed,payment.underpaid"
  }'
```

```json
{
  "webhook": {
    "id": "clh...",
    "url": "https://app.example.com/hooks/pay",
    "events": "payment.confirmed,payment.underpaid",
    "secret": "whsec_..."
  }
}
```

Copy the secret now: it is shown only once and stored encrypted at rest. Omit `events` to receive everything (`*`).

### URL rules

- HTTPS is required in production; plain HTTP is only accepted outside production.
- No credentials in the URL.
- No private or loopback addresses, including `localhost`, `*.local`, `*.internal`, RFC1918 ranges, link-local, and IPv6 ULA/link-local.
- The hostname is resolved at registration and again at dispatch; any private result is rejected.
- Redirects are not followed.

These checks stop an API key holder from turning a webhook into a request to your internal network.

## Events

| Event | Fired when |
| --- | --- |
| `payment.created` | A link is created. |
| `payment.detected` | A transfer is first seen. |
| `payment.confirming` | Entered a block with too few confirmations. |
| `payment.confirmed` | Required confirmations reached. |
| `payment.underpaid` | Received less than requested. |
| `payment.overpaid` | Received more than requested. |
| `payment.expired` | Expired with no transaction. |
| `payment.cancelled` | Cancelled before any transaction. |
| `payment.late` | A payment arrived after expiry, or a late payment was updated. |
| `payment.renewed` | An expired link was renewed. |

Only actual status transitions emit events, so a link does not fire `payment.confirming` on every settlement pass.

## Delivery format

Each delivery is a `POST` with `content-type: application/json`:

```json
{
  "event": "payment.confirmed",
  "createdAt": "2026-11-18T14:12:33.000Z",
  "data": {
    "id": "clh1234567890",
    "txHash": "3e4f...",
    "confirmations": 10,
    "receivedAtomic": "10000000000"
  }
}
```

Three headers help you verify and deduplicate:

| Header | Purpose |
| --- | --- |
| `x-pay-event` | Event name. |
| `x-pay-delivery-id` | Stable ID for this delivery; use it to make handling idempotent. |
| `x-pay-signature` | `sha256=<hex HMAC>` over `deliveryId + "." + event + "." + raw body`. |

## Verify the signature

Compute the HMAC-SHA256 of the exact raw request body, prefixed with the delivery ID and event name:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, headers, secret) {
  const expected = "sha256=" + createHmac("sha256", secret)
    .update(`${headers["x-pay-delivery-id"]}.${headers["x-pay-event"]}.${rawBody}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(headers["x-pay-signature"] ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Read the body as raw text — parsing and re-serializing JSON changes the bytes and breaks the signature. Respond with a 2xx status to mark the delivery done.

## Dispatch and retries

Call the dispatch endpoint on a schedule:

```bash
curl -X POST https://pay.example.com/api/cron/webhooks \
  -H "x-cron-secret: $CRON_SECRET"
```

!!! note "Two different endpoints"
    `POST /api/webhooks` registers an endpoint. `POST /api/cron/webhooks` delivers queued events. Both are needed.

Each run takes up to 100 due deliveries. On failure the app retries with exponential backoff (`2^attempts` seconds: 2, 4, 8, 16, 32, 64). After six attempts the delivery is marked `dead`. A disabled endpoint fails its pending deliveries rather than silently dropping them.

## Listing and removing

`GET /api/webhooks` lists endpoints with `id`, `url`, `events`, `enabled`, and `createdAt` — never the secret. There is no delete endpoint; set `enabled` to `false` directly in the database to stop deliveries.

See the [Webhooks API reference](../api/webhooks.md) for all request and response fields.
