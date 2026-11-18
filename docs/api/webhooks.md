---
icon: lucide/webhook
---

# Webhooks

Register endpoints, inspect them, and drive delivery. The [webhook guide](../guides/webhooks.md) covers signature verification and retry behavior.

## Register an endpoint

`POST /api/webhooks` accepts an API key with `webhook:write` or a session. It allows 10 calls per minute.

```bash
curl -X POST https://pay.example.com/api/webhooks \
  -H 'content-type: application/json' \
  -H "x-api-key: $PAYMENT_API_KEY" \
  -d '{ "url": "https://app.example.com/hooks/pay", "events": "*" }'
```

| Field | Type | Notes |
| --- | --- | --- |
| `url` | string | Required. HTTPS in production, public host, no credentials or redirects. |
| `events` | string | Optional comma-separated event names. Defaults to `*`. |

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

| Error | Reason |
| --- | --- |
| `400` | Missing URL, non-HTTPS in production, credentials in URL, private address, or a hostname that resolves to a private address. |
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
    "txHash": "3e4f...",
    "confirmations": 10,
    "receivedAtomic": "10000000000"
  }
}
```

The signature is `sha256=` plus the HMAC-SHA256 of `deliveryId + "." + event + "." + rawBody` using the endpoint secret. Deduplicate on `x-pay-delivery-id`; retries reuse the same ID.
