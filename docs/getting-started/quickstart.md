---
icon: lucide/zap
---

# Quickstart

This gets a local production-style stack running with the default `prod` profile. It takes about five minutes once Docker is installed.

## 1. Copy the environment file

```bash
cp .env.example .env
chmod 600 .env
```

Open `.env` and replace every placeholder. The app refuses to start in production if any required secret is missing or too short.

=== "Generate secrets"

    ```bash
    openssl rand -hex 32   # SESSION_SECRET (at least 32 chars)
    openssl rand -hex 32   # WALLET_ENCRYPTION_KEY (exactly 64 hex chars)
    openssl rand -hex 24   # MONERO_RPC_PASSWORD
    openssl rand -hex 24   # MONERO_WALLET_PASSWORD
    openssl rand -hex 24   # POSTGRES_PASSWORD
    openssl rand -hex 24   # CRON_SECRET
    openssl rand -hex 24   # PAYMENT_API_KEY
    openssl rand -hex 24   # BACKUP_PASSPHRASE
    ```

=== "Minimum to edit"

    | Variable | What it is |
    | --- | --- |
    | `SINGLE_USER_EMAIL` | The only email that can sign in. |
    | `SINGLE_USER_PASSWORD` | Its password, at least 12 characters. |
    | `MONERO_DAEMON_ADDRESS` | Your node, for example `node.example.com:18081`. |
    | `MONERO_WALLET_PASSWORD` | Password for the wallet files on the `wallet_data` volume. |

    The [configuration reference](../reference/environment.md) lists everything else.

!!! warning "Do not use the public default node in production"
    An empty `MONERO_DAEMON_ADDRESS` falls back to a public node for the selected network. That leaks your server's IP address to a third party. Use your own node.

## 2. Start the stack

```bash
docker compose up --build
```

This starts PostgreSQL, the Next.js app on port `3000`, and `monero-wallet-rpc` on the internal Compose network. Migrations run automatically when the app container starts.

## 3. Check that it is alive

```bash
curl http://localhost:3000/api/health
```

A healthy response looks like this:

```json
{
  "status": "ok",
  "network": "mainnet",
  "remoteNode": {
    "configured": true,
    "mode": "full-scan",
    "proxy": "none",
    "viewKeySentToDaemon": false,
    "lightWallet": false
  },
  "services": { "db": true, "walletRpc": true, "daemon": true },
  "sync": {
    "walletHeight": 3401234,
    "daemonHeight": 3401235,
    "syncLag": 1,
    "status": "synced"
  }
}
```

If `status` is `degraded`, find which service is `false` — the [health endpoint](../api/health.md) explains each field.

## 4. Sign in and add your wallet

Open <http://localhost:3000>, sign in with the `.env` credentials, then go to `/setup`. Enter:

- the wallet's **primary address** (`4...` on mainnet, `5...` on stagenet),
- its **private view key** (64 hex characters),
- a **restore height** — the block where the wallet was created. Use `0` only if you really want to scan from genesis; it is slow.

Spend keys are never asked for. The view key is encrypted with AES-256-GCM before it is stored.

See [Watch-only wallet](../guides/watch-only-wallet.md) for details.

## 5. Create a payment link

```bash
curl -X POST http://localhost:3000/api/payment-links \
  -H 'content-type: application/json' \
  -H "x-api-key: $PAYMENT_API_KEY" \
  -d '{"fiatAmount": "10", "fiatCurrency": "USD", "timeoutSeconds": 1800}'
```

The response contains a `uri` and `address` to show the customer, plus a `statusUrl` and a separate `statusToken`. Poll the status URL with the token in the `x-status-token` header — the token is deliberately not part of the URL.

```bash
curl http://localhost:3000/api/payment-links/<id>/status \
  -H "x-status-token: <statusToken>"
```

!!! tip "Schedule settlement"
    Nothing advances payment status on its own. Call `POST /api/cron/payment-links` with `x-cron-secret: $CRON_SECRET` every minute or two, and `POST /api/cron/webhooks` to dispatch queued events. A systemd timer, cron job, or external scheduler all work.

## Next steps

- [Payment links](../guides/payment-links.md) — fiat quotes, idempotency, cancellation, and renewal.
- [Webhooks](../guides/webhooks.md) — verify signed events in your application.
- [Docker deployment](../guides/docker-deployment.md) — ports, volumes, and putting a TLS proxy in front.
