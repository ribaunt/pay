---
icon: lucide/stamp
---

# Payment proofs

A Monero transaction proof lets the recipient demonstrate that a payment reached their address, without exposing anything else. Ribaunt Pay can generate proofs from the recipient's watch-only wallet and verify them for anyone, with no account.

## Generate a proof

You need the transaction hash and the address the funds were sent to. An optional message is included in the signed data.

```bash
curl -X POST https://pay.example.com/api/wallet/payment-proofs \
  -H 'content-type: application/json' \
  -b 'pay_session=<session-token>' \
  -d '{
    "txHash": "3e4f...64 hex characters",
    "address": "8A...",
    "message": "Invoice 1042"
  }'
```

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

The proof is saved on the wallet record with a unique constraint on `(walletId, txHash, address, message)`, so regenerating it updates the existing signature. `GET /api/wallet/payment-proofs` returns the last 100 proofs.

!!! note "The message matters"
    The message is part of the signed payload. Verification must use exactly the same message, including capitalization and whitespace. Leave it out on both sides if you do not need one.

## Verify a proof publicly

Verification needs no session and no API key:

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

| Field | Meaning |
| --- | --- |
| `good` | The proof is valid for this transaction, address, and message. |
| `confirmations` | Number of confirmations at verification time. |
| `inPool` | Whether the transaction is still in the mempool. |
| `receivedXmr` | Amount received at the given address in this transaction. |

The RPC call behind this does not need the wallet that generated the proof to be loaded — any configured wallet can drive `check_tx_proof`. At least one wallet must be configured, or verification returns an error.

## Validation rules

| Input | Rule |
| --- | --- |
| `txHash` | 64 hex characters. |
| `address` | Valid for the active network: `4`/`8...` on mainnet, `5`/`7...` on stagenet. |
| `message` | Optional, at most 500 characters. |
| `signature` | At least 20 and at most 8192 characters. |

Verification is rate-limited to 30 requests per minute. See the [proof API reference](../api/proofs.md) for endpoint details.
