---
icon: lucide/link
---

# Payment links

Create and manage payment requests with the server-to-server API. See the [guide](../guides/payment-links.md) for the full workflow.

## Create a link

`POST /api/payment-links` requires `x-api-key` with `payment:write`.

=== "Fiat price"

    ```bash
    curl -X POST https://pay.example.com/api/payment-links \
      -H 'content-type: application/json' \
      -H "x-api-key: $PAYMENT_API_KEY" \
      -d '{
        "fiatAmount": "10.50",
        "fiatCurrency": "EUR",
        "timeoutSeconds": 1800,
        "requiredConfirmations": 6,
        "label": "Order 1042"
      }'
    ```

=== "XMR price"

    ```bash
    curl -X POST https://pay.example.com/api/payment-links \
      -H 'content-type: application/json' \
      -H "x-api-key: $PAYMENT_API_KEY" \
      -d '{"amountXmr": "0.01", "timeoutSeconds": 0}'
    ```

### Request body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `fiatAmount` | string | one of `fiatAmount` or `amountXmr` | Decimal, up to 12 fractional digits. |
| `fiatCurrency` | string | with `fiatAmount` | Three-letter code such as `USD`. |
| `amountXmr` | string | one of the two | Decimal XMR, up to 12 fractional digits. |
| `timeoutSeconds` | number | no | Clamped to configured bounds; `0` means no expiry. |
| `requiredConfirmations` | number | no | Integer 1–100. |
| `label`, `description` | string | no | Up to 200 characters. |

Optional header: `Idempotency-Key`. It's scoped to the API key and lasts 24 hours.

### Response `201`

```json
{
  "link": {
    "id": "clh1234567890",
    "uri": "monero:8A...?tx_amount=0.01",
    "address": "8A...",
    "amountXmr": "0.01",
    "amountAtomic": "10000000000",
    "fiatAmount": "10",
    "fiatCurrency": "USD",
    "rateUsd": "250.00",
    "rateSources": "coingecko,coincap,coinbase,kraken",
    "requiredConfirmations": 6,
    "status": "pending",
    "expiresAt": "2026-11-18T14:30:00.000Z",
    "statusUrl": "/api/payment-links/clh1234567890/status",
    "statusToken": "base64url-token"
  }
}
```

Keep `statusToken` on your server. Show `uri` or `address` plus `amountXmr` to the customer.

| Error | When |
| --- | --- |
| `400` | Neither amount provided, invalid amount, invalid currency, bad timeout or confirmation count. |
| `401` | Missing or invalid API key. |
| `409` | Idempotency key reused with a different body, or the original request is still processing. |
| `502` | Wallet RPC unavailable. Price-source failures return `500`. |

## List links

`GET /api/payment-links` accepts an API key with `payment:read` or a session.

```bash
curl 'https://pay.example.com/api/payment-links?status=late' \
  -H "x-api-key: $PAYMENT_API_KEY"
```

```json
{ "links": [ { "id": "clh...", "status": "late", "amount": "10000000000", "...": "..." } ] }
```

Returns the 100 most recent records, newest first. `status` is an optional exact-match filter. Rate limit: 60 per minute.

## Read status

`GET /api/payment-links/{id}/status` requires `x-status-token`.

```bash
curl https://pay.example.com/api/payment-links/clh1234567890/status \
  -H "x-status-token: <statusToken>"
```

```json
{
  "id": "clh1234567890",
  "status": "confirmed",
  "amountXmr": "0.01",
  "amountAtomic": "10000000000",
  "fiatAmount": "10",
  "fiatCurrency": "USD",
  "expiresAt": "2026-11-18T14:30:00.000Z",
  "paidAt": "2026-11-18T14:02:11.000Z",
  "cancelledAt": null,
  "lateDetectedAt": null,
  "txHash": "3e4f...",
  "confirmations": 10,
  "receivedAtomic": "10000000000",
  "receivedXmr": "0.01",
  "requiredConfirmations": 10,
  "confirmationsRemaining": 0
}
```

| Error | When |
| --- | --- |
| `404` | Unknown ID, or wrong/missing status token. |
| `429` | More than 60 requests in a minute. |

## Cancel

`POST /api/payment-links/{id}/cancel` accepts an API key with `payment:write` or a session.

```json
{ "id": "clh1234567890", "status": "cancelled" }
```

Only a `pending` link with no `txHash` and no `paidAt` can be cancelled. Otherwise the response is `409`.

## Renew

`POST /api/payment-links/{id}/renew` accepts an API key with `payment:write` or a session. It returns `201` with the same shape as create, wrapped in `{ "link": ... }`.

Renewal requires an `expired` link with no transaction. It creates a new subaddress, a new token, a default-length expiry, and a fresh fiat quote when applicable. `409` covers all other states.

## Settlement cron

`POST /api/cron/payment-links` requires `x-cron-secret`.

```bash
curl -X POST https://pay.example.com/api/cron/payment-links \
  -H "x-cron-secret: $CRON_SECRET"
# {"processed": 12}
```

The pass expires unpaid links, matches incoming transfers, updates confirmations and statuses, and queues webhook events. Run it every minute or two.
