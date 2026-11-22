---
icon: lucide/key-round
---

# Authentication

Ribaunt Pay uses four independent credentials. This page explains each one and where it's accepted.

## Session cookies

Sign in with the credentials from `.env`:

```bash
curl -X POST https://pay.example.com/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email": "admin@example.com", "password": "..."}' \
  -c cookies.txt
```

```json
{ "user": { "id": "single-user", "email": "admin@example.com", "name": null } }
```

The response sets `pay_session`, an HMAC-SHA256-signed token containing the user ID, expiry, and session version. It's HTTP-only, SameSite=Lax, Secure in production, and valid for seven days.

```bash
curl -b cookies.txt https://pay.example.com/api/auth/me
# {"user": {"id": "single-user", "email": "admin@example.com", "name": null}}

curl -X POST -b cookies.txt https://pay.example.com/api/auth/logout
# {"ok": true}
```

Logout increments the user's `sessionVersion`, so every cookie issued before it stops working, even if someone copied it elsewhere. There's no `/api/auth/register` or `/api/auth/anonymous`.

Wrong credentials return `401` with `{"error": "Invalid credentials"}`. Login is limited to 10 attempts per minute.

## API keys

Send a key in the `x-api-key` header:

```bash
curl https://pay.example.com/api/payment-links \
  -H "x-api-key: $PAYMENT_API_KEY"
```

Keys are stored as SHA-256 hashes. The `PAYMENT_API_KEY` environment variable acts as a bootstrap key: on first use the app creates a record named `bootstrap-env-key` with `payment:write,payment:read` scopes. Create separate keys for each integration through [the admin API](admin-and-metrics.md).

| Scope | Grants |
| --- | --- |
| `payment:read` | List links, read audit. |
| `payment:write` | Create, cancel, renew links. |
| `webhook:read` | List webhook endpoints. |
| `webhook:write` | Register webhook endpoints. |
| `metrics:read` | Read Prometheus metrics. |
| `*` | Everything. |

An unknown key, a revoked key, an expired key, or a key missing the required scope all produce `401`.

## Cron secret

Settlement and webhook dispatch are protected by `CRON_SECRET`:

```bash
curl -X POST https://pay.example.com/api/cron/payment-links \
  -H "x-cron-secret: $CRON_SECRET"
```

A missing or wrong value returns `401`. These endpoints never accept an API key. The protected jobs are:

- `POST /api/cron/payment-links` — settlement.
- `POST /api/cron/webhooks` — webhook dispatch.
- `POST /api/cron/wallet-store` — wallet file backup.
- `POST /api/cron/retention` — per-category data retention purge.

## Browser sessions and CSRF

Session-authenticated state changes (`POST`, `PUT`, `PATCH`, `DELETE`) require a
same-origin `Origin` header and a CSRF token from `GET /api/auth/csrf`, sent as
`x-csrf-token`. Missing or invalid values return `403`. API-key requests are
exempt because they do not use browser cookies.

## Status tokens

Creating a link returns a `statusToken` alongside a `statusUrl`. Present it as a header:

```bash
curl https://pay.example.com/api/payment-links/<id>/status \
  -H "x-status-token: <statusToken>"
```

The token is 32 random bytes in base64url. Only its SHA-256 hash is stored. A missing or incorrect token returns `404`, so the link can't be probed by ID alone. Tokens are never part of a URL.

## Public endpoints

These need no credential:

- `GET /api/health`
- `GET /api/prices/currencies` and `GET /api/prices/quote`
- `POST /api/auth/login`
- `POST /api/public/payment-proofs/verify`

They are still rate-limited, and `TRUST_PROXY` controls whether `X-Forwarded-For` is used for the bucket.
