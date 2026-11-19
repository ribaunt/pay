---
icon: lucide/zap
---

# Quickstart

This gets the published Ribaunt Pay image running with Docker Compose in a few minutes.

## 1. Download the Compose files

```bash
curl -fsSL https://pay.ribaunt.com/compose.yml -o compose.yml
curl -fsSL https://pay.ribaunt.com/env.example -o .env
chmod 600 .env
```

The Compose file is generated for the newest release and pins that image version.

## 2. Fill in `.env`

Set at least:

- `MONERO_DAEMON_ADDRESS` — `host:port` of your Monero node.
- `MONERO_NETWORK` — `mainnet` or `stagenet`.
- `MONERO_WALLET_ADDRESS` — the wallet's primary address (`4...` on mainnet, `5...` on stagenet).
- `MONERO_WALLET_VIEW_KEY` — its 64-character private view key.
- `MONERO_WALLET_RESTORE_HEIGHT` — block where the wallet was created. Use `0` only if you really want to scan from genesis.

Spend keys are never requested. The view key is encrypted with AES-256-GCM before it is stored.

!!! warning "Don't use the public default node in production"
    An empty `MONERO_DAEMON_ADDRESS` falls back to a public node for the selected network. That leaks your server's IP address to a third party. Use your own node.

## 3. Start the stack

```bash
docker compose up -d
docker logs pay       # one-time sign-in credentials on first boot
curl http://localhost:3000/api/health
```

A healthy response looks like this:

```json
{
  "status": "ok",
  "network": "mainnet",
  "services": { "db": true, "walletRpc": true, "daemon": true },
  "sync": { "walletHeight": 3401234, "daemonHeight": 3401235, "status": "synced" }
}
```

If `status` is `degraded`, check which service is `false`. The [health endpoint](../api/health.md) explains each field.

## 4. Create a payment link

Ribaunt Pay is API-only — there is no web UI. Create an API key with `payment:write`, then:

```bash
curl -X POST http://localhost:3000/api/payment-links \
  -H 'content-type: application/json' \
  -H "x-api-key: $PAYMENT_API_KEY" \
  -d '{"fiatAmount": "10", "fiatCurrency": "USD", "timeoutSeconds": 1800}'
```

The response contains a `uri` and `address` to show the customer, plus a `statusUrl` and a separate `statusToken`. Poll the status URL with the token in the `x-status-token` header so the token stays out of URLs:

```bash
curl http://localhost:3000/api/payment-links/<id>/status \
  -H "x-status-token: <statusToken>"
```

Settlement and webhook delivery run on a timer inside the container, so no external scheduler is needed.

## Next steps

- [Payment links](../guides/payment-links.md): fiat quotes, idempotency, cancellation, and renewal.
- [Webhooks](../guides/webhooks.md): verify signed events in your application.
- [Docker deployment](../guides/docker-deployment.md): ports, volumes, and putting a TLS proxy in front.
