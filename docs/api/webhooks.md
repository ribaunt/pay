---
icon: lucide/webhook
---

# Webhooks

Register endpoints, inspect them, and drive delivery. The [webhook guide](../guides/webhooks.md) covers signature verification and retry behavior.

## Register an endpoint

`POST /api/webhooks` accepts an API key with `webhook:write` or a session. It allows 10 calls per minute.

The bootstrap `PAYMENT_API_KEY` only has payment scopes and returns `401` here. Create a dedicated key with `webhook:write,webhook:read` as described in [API keys](../guides/api-keys.md), then use that key below.

```bash
curl -X POST https://pay.example.com/api/webhooks \
  -H 'content-type: application/json' \
  -H "x-api-key: $WEBHOOK_API_KEY" \
  -d '{ "url": "https://app.example.com/hooks/pay", "events": "*" }'
```

| Field | Type | Notes |
| --- | --- | --- |
| `url` | string | Required. HTTPS in production, public host, no credentials or redirects. |
| `events` | string | Optional comma-separated event names. Whitespace around names is ignored; unknown names return `400`. Defaults to `*`. |

Response `201`:

```json
{
  "webhook": {
    "id": "clh...",
    "url": "https://app.example.com/hooks/pay",
    "events": "*",
    "secret": "whsec_..."
  }
}
```

The secret is shown once. It's encrypted in PostgreSQL and never returned again.

Webhook delivery performs outbound SSRF protection on every attempt: all A and
AAAA records are resolved and validated, a mixed public/private DNS response is
rejected, and the connection is pinned to the validated IP while the original
hostname is preserved for TLS verification. Redirects are disabled, and the
delivery has timeout, response-size and connection limits. Literal IP targets
are rejected because pinning cannot be enforced on that path.

| Error | Reason |
| --- | --- |
| `400` | Missing URL, non-HTTPS in production, credentials in URL, private address, a hostname that resolves to a private address, or an unknown event name in `events`. |
| `401` | Unauthorized. |

## List endpoints

`GET /api/webhooks` accepts an API key with `webhook:read` or a session.

```json
{
  "webhooks": [
    {
      "id": "clh...",
      "url": "https://app.example.com/hooks/pay",
      "events": "*",
      "enabled": true,
      "createdAt": "2026-11-18T12:00:00.000Z"
    }
  ]
}
```

Secrets aren't included. With an API key, only endpoints registered by that key are listed; a session lists all of them.

## Dispatch queued events

`POST /api/cron/webhooks` requires `x-cron-secret`.

```bash
curl -X POST https://pay.example.com/api/cron/webhooks \
  -H "x-cron-secret: $CRON_SECRET"
# {"sent": 3, "failed": 1}
```

Each run takes up to 100 due deliveries. A delivery is retried with `2^attempts` second backoff up to six attempts, after which it's marked `dead`.

## Event names

`payment.created`, `payment.detected`, `payment.confirming`, `payment.confirmed`, `payment.underpaid`, `payment.overpaid`, `payment.expired`, `payment.cancelled`, `payment.late`, `payment.renewed`.

## Delivery shape

```http
POST /hooks/pay HTTP/1.1
content-type: application/json
x-pay-event: payment.confirmed
x-pay-delivery-id: clh...
x-pay-signature: sha256=<hex>

{
  "event": "payment.confirmed",
  "createdAt": "2026-11-18T14:12:33.000Z",
  "data": {
    "id": "clh1234567890",
    "status": "confirmed",
    "address": "8A...",
    "amountXmr": "0.01",
    "amountAtomic": "10000000000",
    "receivedXmr": "0.01",
    "receivedAtomic": "10000000000",
    "fiatAmount": "10",
    "fiatCurrency": "USD",
    "txHash": "3e4f...",
    "confirmations": 10,
    "expiresAt": "2026-11-18T14:30:00.000Z",
    "paidAt": "2026-11-18T14:02:11.000Z"
  }
}
```

Every payment event carries this same `data` shape, so consumers never need
per-event field handling. `txHash` is used (never `txid`), and amounts always
appear as both `Xmr` and `Atomic` strings. `payment.renewed` adds `fromId`.
Unset timestamps and amounts are `null`.

The signature is `sha256=` plus the HMAC-SHA256 of `deliveryId + "." + event + "." + rawBody` using the endpoint secret. Deduplicate on `x-pay-delivery-id`; retries reuse the same ID.
