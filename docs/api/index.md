---
icon: lucide/braces
---

# API overview

All endpoints live under `/api`. Responses are JSON except `/api/metrics`, which is Prometheus text, and the CSV flavor of the wallet audit.

## Base URL

Use the origin of your own deployment during development:

```text
http://localhost:3000     # prod profile
http://localhost:3001     # dev profile
https://pay.example.com   # behind your TLS proxy
```

## Authentication methods

| Method | Header or cookie | Used by |
| --- | --- | --- |
| Session | Cookie `pay_session` | Wallet, setup, key management, some read endpoints. |
| API key | `x-api-key: <key>` | Server-to-server link creation, listings, webhooks, audit, metrics. |
| Cron secret | `x-cron-secret: <secret>` | Settlement and webhook dispatch. |
| Status token | `x-status-token: <token>` | Reading a payment link's status. |
| None | none | Health, price quotes, login, public proof verification. |

There's no registration endpoint. The only credentials are `SINGLE_USER_EMAIL` and `SINGLE_USER_PASSWORD` from `.env`.

!!! note "One key, one purpose"
    A cron secret doesn't work as an API key, and a status token doesn't authorize anything else. Trying the wrong method returns `401` or `404`.

## Conventions

- Request bodies are JSON with `content-type: application/json`.
- All timestamps are ISO 8601 strings.
- XMR amounts in responses are decimal strings; internally they are integer piconero.
- Errors are `{"error": "message"}` with an HTTP status code. See [Errors and limits](../reference/errors-and-limits.md).
- Repeated requests are rate-limited per API key or per client bucket. Exceeding a limit returns `429`.

## Endpoints

### Public

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | [`/api/health`](health.md) | Service health and sync status. |
| `POST` | [`/api/auth/login`](authentication.md) | Sign in with `.env` credentials. |
| `POST` | [`/api/auth/logout`](authentication.md) | Invalidate all sessions. |
| `GET` | [`/api/auth/me`](authentication.md) | Current session user. |
| `GET` | [`/api/payment-links/{id}/status`](payment-links.md) | Status by token. |
| `GET` | [`/api/prices/currencies`](prices.md) | Supported fiat currencies. |
| `GET` | [`/api/prices/quote`](prices.md) | Convert a fiat amount to XMR. |
| `POST` | [`/api/public/payment-proofs/verify`](proofs.md) | Verify a proof without an account. |

### Server-to-server and cron

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`, `POST` | [`/api/payment-links`](payment-links.md) | List or create links. |
| `POST` | [`/api/payment-links/{id}/cancel`](payment-links.md) | Cancel a waiting link. |
| `POST` | [`/api/payment-links/{id}/renew`](payment-links.md) | Renew an expired link. |
| `GET`, `POST` | [`/api/webhooks`](webhooks.md) | List or register endpoints. |
| `POST` | [`/api/cron/payment-links`](payment-links.md) | Run a settlement pass. |
| `POST` | [`/api/cron/webhooks`](webhooks.md) | Deliver queued events. |
| `GET` | [`/api/metrics`](admin-and-metrics.md) | Prometheus metrics. |
| `GET` | [`/api/wallet/audit`](wallet.md) | View-key-only accounting export. |

### Session-authenticated

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | [`/api/wallet/setup`](wallet.md) | Import a watch-only wallet. |
| `GET` | [`/api/wallet`](wallet.md) | Wallet info. |
| `GET` | [`/api/wallet/balance`](wallet.md) | Balance. |
| `GET` | [`/api/wallet/address`](wallet.md) | Primary address. |
| `GET` | [`/api/wallet/transfers`](wallet.md) | Transfer history. |
| `GET`, `POST` | [`/api/wallet/subaddresses`](wallet.md) | List or create subaddresses. |
| `GET`, `POST` | [`/api/wallet/payment-requests`](wallet.md) | Stored XMR payment requests. |
| `GET`, `POST` | [`/api/wallet/payment-proofs`](proofs.md) | Generate or list proofs. |
| `POST` | [`/api/wallet/close`](wallet.md) | Close the loaded wallet. |
| `GET`, `POST` | [`/api/admin/api-keys`](admin-and-metrics.md) | List or create API keys. |
| `POST` | [`/api/admin/api-keys/{id}/revoke`](admin-and-metrics.md) | Revoke a key. |

## Rate limits

Limits are per minute and stored in PostgreSQL:

| Endpoint group | Limit |
| --- | --- |
| Create payment link | 30 per API key |
| List, status, prices, metrics | 60 |
| Cancel, renew, proof, audit, webhook create, key create | 10–30 depending on route |
| Wallet setup | 5 |
| Login | 10 |

Authenticated API-key calls are bucketed by key ID, not by IP address.
