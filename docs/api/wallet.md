---
icon: lucide/wallet
---

# Wallet

These endpoints read and configure the watch-only wallet. Most require a session cookie; the audit export also accepts an API key with `payment:read`.

## Set up the wallet

`POST /api/wallet/setup` needs a session and allows 5 calls per minute.

```bash
curl -X POST https://pay.example.com/api/wallet/setup \
  -H 'content-type: application/json' \
  -b 'pay_session=<token>' \
  -d '{
    "address": "4...",
    "viewKey": "<64 hex characters>",
    "restoreHeight": 3200000,
    "description": "Storefront"
  }'
```

| Field | Type | Notes |
| --- | --- | --- |
| `address` | string | Primary address for the active network. |
| `viewKey` | string | 64 hex characters. |
| `restoreHeight` | number or string | Optional, defaults to `0`. |
| `description` | string | Optional, up to 200 characters. |

Response:

```json
{
  "wallet": {
    "name": "watch-mainnet-ab12...",
    "address": "4...",
    "balanceXmr": "0",
    "unlockedBalanceXmr": "0",
    "blocksToUnlock": 0
  }
}
```

The view key is encrypted before storage and never returned. Spend keys are never accepted.

## Read wallet info

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/api/wallet` | `{ "wallet": { name, address, balanceXmr, unlockedBalanceXmr, blocksToUnlock } }` |
| `GET` | `/api/wallet/balance` | `{ "balanceXmr": "0.5", "unlockedBalanceXmr": "0.3", "blocksToUnlock": 10 }` |
| `GET` | `/api/wallet/address` | `{ "address": "4..." }` |

## Transfers

`GET /api/wallet/transfers` needs a session.

Query flags accept `1`, `true`, `0`, or `false`:

| Flag | Default |
| --- | --- |
| `incoming` | `true` |
| `outgoing` | `true` |
| `pending` | `true` |
| `failed` | `false` |
| `pool` | `false` |

```bash
curl 'https://pay.example.com/api/wallet/transfers?incoming=1&pool=1' \
  -b 'pay_session=<token>'
```

```json
{
  "transfers": [
    {
      "txid": "3e4f...",
      "type": "in",
      "amountXmr": "0.01",
      "feeXmr": "0.000012",
      "timestamp": "2026-11-18T14:02:11.000Z",
      "blockHeight": 3401000,
      "address": "8A...",
      "paymentId": ""
    }
  ]
}
```

Results are sorted by timestamp, newest first.

## Subaddresses

`GET /api/wallet/subaddresses` needs a session. It reconciles stored records with the RPC and returns them by index:

```json
{
  "subaddresses": [
    { "address": "8A...", "addressIndex": 1, "label": "Order 1042", "used": true, "lastUsedAt": "2026-11-18T14:02:11.000Z" }
  ]
}
```

`POST /api/wallet/subaddresses` takes `{ "label": "optional" }` and returns `201`:

```json
{ "subaddress": { "address": "8A...", "addressIndex": 2, "label": "optional" } }
```

## XMR payment requests

These create a stored request directly, without a fiat quote or status token.

`POST /api/wallet/payment-requests` takes `{ "amountXmr": "0.01", "label": "Order", "timeoutSeconds": 1800 }` and returns `201`:

```json
{
  "payment": {
    "id": "clh...",
    "address": "8A...",
    "uri": "monero:8A...?tx_amount=0.01",
    "amountXmr": "0.01",
    "addressIndex": 1,
    "status": "pending",
    "expiresAt": "2026-11-18T14:30:00.000Z"
  }
}
```

`GET /api/wallet/payment-requests` returns the 100 most recent stored requests.

## Audit export

`GET /api/wallet/audit?format=json|csv` accepts a session or an API key with `payment:read`.

The JSON report contains the wallet address, restore height, network, and up to 1000 payment requests with their transfers, amounts, and timestamps. It never includes keys.

```bash
curl 'https://pay.example.com/api/wallet/audit?format=csv' \
  -H "x-api-key: $PAYMENT_API_KEY" \
  -o pay-audit.csv
```

The CSV has columns `id`, `label`, `status`, `address`, `amountXmr`, `receivedXmr`, `fiatAmount`, `fiatCurrency`, `txHash`, `confirmations`, `createdAt`, `paidAt`, `network`. Cells beginning with `=`, `+`, `-`, `@`, tab, or carriage return are escaped to prevent spreadsheet formula injection.

## Close the wallet

`POST /api/wallet/close` needs a session.

```json
{ "ok": true }
```

The RPC has one open wallet at a time. The next wallet operation reopens the configured file automatically.

Proof endpoints are documented separately in [Payment proofs](proofs.md).
