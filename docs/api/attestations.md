# Revenue attestations

`GET /api/admin/attestations` returns a **signed aggregate** of confirmed payments in a period. It contains no link IDs, addresses, transaction hashes, or customer data.

```bash
curl -b 'pay_session=<token>' \
  'http://localhost:3000/api/admin/attestations?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z&storeId=<optional>'
```

```json
{
  "kind": "ribaunt-pay-revenue-attestation",
  "version": 1,
  "from": "2026-11-01T00:00:00.000Z",
  "to": "2026-12-01T00:00:00.000Z",
  "network": "stagenet",
  "confirmedCount": 3,
  "totalXmr": "0.15",
  "totalAtomic": "150000000000",
  "fiatTotal": "25.00",
  "fiatCurrency": "USD",
  "generatedAt": "...",
  "signature": "<hex HMAC-SHA256>"
}
```

The signature is HMAC-SHA256 over the JSON of every field except `signature`, keyed with `SESSION_SECRET`. A verifier with that secret can check the statement offline.

!!! note "Not zero-knowledge"
    This is a signed aggregate, not a zero-knowledge proof. It hides individual payments but requires the verifier to trust the holder of the signing secret.
