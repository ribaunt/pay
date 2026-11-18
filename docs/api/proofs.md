---
icon: lucide/stamp
---

# Payment proofs

Generate proofs from the recipient's watch-only wallet and verify them without an account.

## Generate a proof

`POST /api/wallet/payment-proofs` — session required, 30 per minute.

```bash
curl -X POST https://pay.example.com/api/wallet/payment-proofs \
  -H 'content-type: application/json' \
  -b 'pay_session=<token>' \
  -d '{
    "txHash": "3e4f...",
    "address": "8A...",
    "message": "Invoice 1042"
  }'
```

| Field | Rule |
| --- | --- |
| `txHash` | 64 hex characters. |
| `address` | Valid for the active network. |
| `message` | Optional, at most 500 characters. |

Response `201`:

```json
{
  "proof": {
    "txHash": "3e4f...",
    "address": "8A...",
    "message": "Invoice 1042",
    "signature": "InProofV1..."
  }
}
```

## List proofs

`GET /api/wallet/payment-proofs` — session required.

```json
{ "proofs": [ { "id": "clh...", "txHash": "3e4f...", "address": "8A...", "message": "Invoice 1042", "signature": "...", "createdAt": "..." } ] }
```

The 100 newest proofs are returned.

## Verify a proof

`POST /api/public/payment-proofs/verify` — public, 30 per minute.

```bash
curl -X POST https://pay.example.com/api/public/payment-proofs/verify \
  -H 'content-type: application/json' \
  -d '{
    "txHash": "3e4f...",
    "address": "8A...",
    "message": "Invoice 1042",
    "signature": "InProofV1..."
  }'
```

```json
{
  "good": true,
  "confirmations": 12,
  "inPool": false,
  "receivedXmr": "0.01"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `good` | boolean | Proof matches the transaction, address, and message. |
| `confirmations` | number | Current confirmations. |
| `inPool` | boolean | Transaction is still in the mempool. |
| `receivedXmr` | string | Amount received at the address. |

Verification requires at least one configured wallet to drive the RPC call, but it does not have to be the wallet that created the proof. No session, API key, or personal data is needed.

| Error | Reason |
| --- | --- |
| `400` | Invalid hash, address, message, or signature format. |
| `500` | No wallet configured, or the RPC call failed. |
