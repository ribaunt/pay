---
icon: lucide/triangle-alert
---

# Errors and limits

## Error format

Errors are JSON with a single `error` string:

```json
{ "error": "Invalid API key" }
```

Internal errors are intentionally vague: `Internal server error` for unexpected failures and `Upstream service unavailable` for wallet RPC failures. Detailed messages are reserved for client mistakes such as invalid amounts or addresses.

## Status codes

| Code | Meaning | Common causes |
| --- | --- | --- |
| `400` | Bad request | Invalid amount, address, currency, message, label, restore height, timeout, or confirmation count; malformed JSON. |
| `401` | Unauthorized | Missing or invalid session, API key, cron secret, or webhook scope. |
| `404` | Not found | Unknown payment link ID or wrong status token. |
| `409` | Conflict | Idempotency key reused with a different body; cancelling a link with a transaction; renewing a non-expired link. |
| `429` | Too many requests | Per-route rate limit exceeded. |
| `502` | Bad gateway | `monero-wallet-rpc` unreachable or returned an error. |
| `500` | Internal server error | Unexpected failure, or no wallet configured where one is required. |
| `503` | Service unavailable | Health endpoint found at least one dependency down. |

The mapping is centralized in `apiError()`: auth errors become `401`, conflicts `409`, rate limits `429`, wallet RPC errors `502`, and messages matching `required|invalid|at most|address|url` become `400`.

## Validation rules

| Value | Rule |
| --- | --- |
| XMR amount | Decimal string, at most 12 fractional digits. |
| Fiat amount | Decimal string, regex `^\d+(\.\d{1,12})?$`. |
| `requiredConfirmations` | Integer from 1 to 100. |
| `timeoutSeconds` | Non-negative number; clamped between configured min and max; `0` means no expiry. |
| Primary address | 95 characters, `4`/`8...` on mainnet or `5`/`7...` on stagenet. |
| Private view key | 64 hex characters. |
| Transaction hash | 64 hex characters. |
| Proof signature | 20 to 8192 characters. |
| Label / description | At most 200 characters. |
| Proof message | At most 500 characters. |
| API key name | At most 80 characters. |
| API key scopes | Lowercase letters, colons, commas, and spaces. |

## Rate limits

Limits are stored in PostgreSQL, so they apply across replicas and survive restarts. Buckets reset after 60 seconds. A `429` response includes a `Retry-After` header with the wait time in seconds.

| Route | Limit | Bucket key |
| --- | --- | --- |
| `POST /api/auth/login` | 10 | Client (or `local` without `TRUST_PROXY`) |
| `POST /api/wallet/setup` | 5 | Client |
| `POST /api/payment-links` | 30 | API key ID |
| `GET /api/payment-links` | 60 | API key ID or client |
| `GET /api/payment-links/{id}/status` | 60 | Client |
| `POST /api/payment-links/{id}/cancel` | 30 | API key ID or client |
| `POST /api/payment-links/{id}/renew` | 30 | API key ID or client |
| Wallet subaddresses | 30 / 60 | Client |
| Wallet payment requests, proofs, audit | 30 | API key ID or client |
| `POST /api/webhooks` | 10 | API key ID or client |
| `GET /api/webhooks` | 60 | API key ID or client |
| Price quote and currencies | 60 | Client |
| `POST /api/public/payment-proofs/verify` | 30 | Client |
| Admin API keys | 10 (create) / 60 (list) | Client |
| `GET /api/metrics` | 60 | API key ID or client |
| `GET /api/events` (status token) | 10 stream starts | Hash of link ID and status token |
| `GET /api/events` (key or session) | 60 stream starts | API key ID or client |

!!! note "Event streams"
    The `GET /api/events` limits count new stream connections, not messages. A stream can still run for up to five minutes once opened.

!!! note "Client identity"
    Without `TRUST_PROXY=1`, every unauthenticated request shares the bucket `local`. Set it only when a trusted proxy overwrites `X-Forwarded-For`; otherwise a client can spoof that header.

## Bounded work

A few routes intentionally process only a slice of data per call:

| Route | Bound |
| --- | --- |
| Settlement cron | 200 active payment links per pass. |
| Webhook dispatch | 100 due deliveries per pass. |
| Link listing | 100 most recent requests. |
| Payment proof listing | 100 most recent proofs. |
| Stored payment requests | 100 most recent. |
| Audit JSON report | 1000 most recent requests. |
| Wallet RPC request timeout | 15 seconds. |
| Webhook HTTP request timeout | 5 seconds. |
| Daemon health request timeout | 5 seconds. |

Run the cron endpoints frequently enough that these bounds don't become a backlog.
