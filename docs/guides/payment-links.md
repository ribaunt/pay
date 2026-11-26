---
icon: lucide/link
---

# Payment links

A payment link is a server-to-server created request with an amount, an optional expiry, and a fresh subaddress. The customer never signs in; your app checks status with a secret token or listens for webhooks.

## Create a link

```bash
curl -X POST https://pay.example.com/api/payment-links \
  -H 'content-type: application/json' \
  -H "x-api-key: $PAYMENT_API_KEY" \
  -d '{"fiatAmount": "10", "fiatCurrency": "USD", "timeoutSeconds": 1800}'
```

Or price it directly in XMR:

```bash
curl -X POST https://pay.example.com/api/payment-links \
  -H 'content-type: application/json' \
  -H "x-api-key: $PAYMENT_API_KEY" \
  -d '{"amountXmr": "0.01", "requiredConfirmations": 6, "label": "Order 1042"}'
```

Successful requests return `201`:

```json
{
  "link": {
    "id": "clh1234567890",
    "uri": "monero:8A...?tx_amount=0.01",
    "address": "8A...",
    "amountXmr": "0.01",
    "amountAtomic": "10000000000",
    "fiatAmount": null,
    "fiatCurrency": null,
    "rateUsd": null,
    "rateSources": null,
    "requiredConfirmations": 6,
    "status": "pending",
    "expiresAt": "2026-11-18T14:30:00.000Z",
    "statusUrl": "/api/payment-links/clh1234567890/status",
    "statusToken": "base64url-token"
  }
}
```

Give the customer `uri` (or `address` plus `amountXmr`). Keep `statusToken` on your server.

### Request fields

| Field | Type | Notes |
| --- | --- | --- |
| `fiatAmount` | string | Decimal with up to 12 fractional digits. In practice, supply either this or `amountXmr`. |
| `fiatCurrency` | string | Required with `fiatAmount`, e.g. `USD`, `EUR`. |
| `amountXmr` | string | Decimal XMR amount, up to 12 decimal places. |
| `timeoutSeconds` | number | Optional. `0` means no expiry. Values are clamped between the configured minimum and maximum. |
| `requiredConfirmations` | number | Optional, 1–100. Overrides the server default for this link. |
| `label`, `description` | string | Optional labels up to 200 characters. |

!!! tip "Fiat rates are locked"
    When you use `fiatAmount`, the app fetches a quote, converts it to an atomic XMR amount with fixed-point math (rounding up), and stores the rate, FX rate, and source list on the request. Later price movements don't change the amount the customer owes.

## Check status

Status is public in the sense that no account is required, but it's protected by a token that's **never placed in the URL**:

```bash
curl https://pay.example.com/api/payment-links/<id>/status \
  -H "x-status-token: <statusToken>"
```

```json
{
  "id": "clh1234567890",
  "status": "confirming",
  "amountXmr": "0.01",
  "amountAtomic": "10000000000",
  "confirmations": 3,
  "requiredConfirmations": 6,
  "confirmationsRemaining": 3,
  "txHash": "3e4f...",
  "receivedAtomic": "10000000000",
  "receivedXmr": "0.01",
  "expiresAt": "2026-11-18T14:30:00.000Z",
  "paidAt": "2026-11-18T14:02:11.000Z"
}
```

A wrong or missing token returns `404`, which keeps the link's existence private.

## Statuses

| Status | Meaning |
| --- | --- |
| `pending` | Waiting for a transaction. |
| `detected` | A transfer was seen in the mempool or at block height 0. |
| `confirming` | In a block, with fewer confirmations than required. |
| `confirmed` | Enough confirmations. This is the usual success state. |
| `underpaid` | The received amount is below the requested amount. More transfers can top it up; at the deadline it becomes `expired` or `late`. |
| `overpaid` | More than requested was received; still waiting for confirmations. |
| `late` | Payment arrived after expiry. Confirmations keep updating, but it is never auto-refunded. |
| `expired` | No transaction before the expiry time. |
| `cancelled` | Cancelled by the merchant before any transaction was seen. |

!!! note "Waiting for settlement"
    Nothing changes status by itself. Run `POST /api/cron/payment-links` with `x-cron-secret` on a schedule. Each pass handles up to 200 active links, serving links that still need first detection before historical links.

## Idempotency

Set an `Idempotency-Key` header when creating links from a backend that may retry:

```bash
curl -X POST https://pay.example.com/api/payment-links \
  -H "x-api-key: $PAYMENT_API_KEY" \
  -H 'idempotency-key: order-1042-charge' \
  -H 'content-type: application/json' \
  -d '{"amountXmr": "0.01"}'
```

The key is scoped to the API key and valid for 24 hours. Repeating the same key with the same body returns the original response instead of creating a second link. Reusing it with a different body returns `409`.

## Cancel a link

```bash
curl -X POST https://pay.example.com/api/payment-links/<id>/cancel \
  -H "x-api-key: $PAYMENT_API_KEY"
```

Cancellation only works while status is `pending` and no transaction hash or `paidAt` exists. Once a transfer is seen, the call returns `409`. Accepting a session cookie also works.

## Renew an expired link

```bash
curl -X POST https://pay.example.com/api/payment-links/<id>/renew \
  -H "x-api-key: $PAYMENT_API_KEY"
```

Renewing is allowed only for an `expired` link with no transaction. It creates a new request with a fresh subaddress, a new status token, a new expiry using the default timeout, and a refreshed fiat quote if the original was priced in fiat. The response has the same shape as create.

The new record records `renewedFromId` and emits `payment.renewed`.

## List links

```bash
curl 'https://pay.example.com/api/payment-links?status=late' \
  -H "x-api-key: $PAYMENT_API_KEY"
```

Returns the 100 most recent requests, newest first. The `status` filter is optional. `GET` accepts either an API key with `payment:read` or a signed-in session.

## Rate limits

Creating links is limited to 30 requests per minute per API key; status checks and listings to 60 per minute. Exceeding a limit returns `429`. Limits are stored in PostgreSQL, so they are shared across replicas and restarts.
