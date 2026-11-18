---
icon: lucide/key-round
---

# API keys

Server-to-server calls use API keys. Keys are scoped, revocable, and stored only as SHA-256 hashes in PostgreSQL.

## The bootstrap key

`PAYMENT_API_KEY` in `.env` works immediately. The first time it is used, the app creates a key record named `bootstrap-env-key` with scopes `payment:write,payment:read`. The plaintext key is never stored.

```bash
curl https://pay.example.com/api/payment-links \
  -H "x-api-key: $PAYMENT_API_KEY"
```

!!! tip "Create a real key for each integration"
    The env key is meant for bootstrapping. Issue separate keys for each service so you can revoke one without taking down the others.

## Create a key

Creating keys requires a signed-in session:

```bash
curl -X POST https://pay.example.com/api/admin/api-keys \
  -H 'content-type: application/json' \
  -b 'pay_session=<session-token>' \
  -d '{"name": "storefront", "scopes": "payment:write,payment:read"}'
```

```json
{
  "key": {
    "id": "clh...",
    "name": "storefront",
    "scopes": "payment:write,payment:read",
    "prefix": "pk_abc12345...",
    "secret": "pk_abc12345........................"
  }
}
```

The `secret` is returned once. `prefix` is what you will see in listings later. Names may be up to 80 characters; scopes may contain lowercase letters, colons, commas, and spaces.

## Scopes

| Scope | Allows |
| --- | --- |
| `payment:write` | Create, cancel, and renew payment links. |
| `payment:read` | List links, read the audit report. |
| `webhook:read` | List webhook endpoints. |
| `webhook:write` | Register webhook endpoints. |
| `metrics:read` | Scrape Prometheus metrics. |

A scope string of `*` means everything. A key with the wrong scope gets `401`, the same as an unknown key. The cron endpoints do not use API keys — they use `x-cron-secret`.

## List and revoke

```bash
curl https://pay.example.com/api/admin/api-keys \
  -b 'pay_session=<session-token>'
```

The listing includes `id`, `name`, `prefix`, `scopes`, `createdAt`, `expiresAt`, `revokedAt`, and `lastUsedAt` — but no key hash or secret.

```bash
curl -X POST https://pay.example.com/api/admin/api-keys/<id>/revoke \
  -b 'pay_session=<session-token>'
```

Revocation sets `revokedAt`. The key stops working immediately, even if its value is still in `.env`. To restore access, issue a new key and update the client.

## Operational notes

- Keys have no built-in expiry through the API; set `expiresAt` in the database if you need one.
- Successful verification updates `lastUsedAt` in the background.
- Rate limits for API-key calls are keyed by key ID, so one integration cannot exhaust another's budget.
- Client IP addresses are not stored for authenticated API calls, and `X-Forwarded-For` is ignored unless `TRUST_PROXY=1`.

The full shapes are in the [Admin and metrics reference](../api/admin-and-metrics.md).
