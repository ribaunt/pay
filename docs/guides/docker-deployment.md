---
icon: lucide/container
---

# Docker deployment

The Compose file defines several independent profiles. Each profile is a complete stack; switching profiles changes which services exist, not just which ports are published.

## Profiles at a glance

| Command | Services | Host ports |
| --- | --- | --- |
| `docker compose up -d` (profile `prod`) | app, db, wallet-rpc | `3000`, `5432` |
| `COMPOSE_PROFILES=dev docker compose up -d` | app-dev, db-dev, wallet-rpc-dev | `3001`, `5433`, `18083` |
| `COMPOSE_PROFILES=prod,tor docker compose up -d` | prod stack + Tor | `3000`, `5432` (plus onion address) |
| `COMPOSE_PROFILES=tor-only docker compose up -d` | onion stack | none |
| `COMPOSE_PROFILES=i2p-only docker compose up -d` | I2P stack | none |

The production app image is built from `Dockerfile` in three stages: dependencies, build (Prisma generate + Next.js build), and a standalone runtime as a non-root user. The wallet image is built from `Dockerfile.wallet`.

## Services

### `app`

Runs the standalone Next.js server as user `nextjs`. On startup it runs `prisma migrate deploy` before serving requests, so schema changes are applied automatically. It talks to `db:5432` and `wallet-rpc:18082` over the internal network.

### `db`

PostgreSQL 16, pinned by digest. A health check gates the app's startup. The `postgres_data` volume holds the database.

### `wallet-rpc`

`monero-wallet-rpc` v0.18.5.4, running as a non-root user with all Linux capabilities dropped. It has **no host port** in production. The app authenticates with HTTP Digest using `MONERO_RPC_USER` and `MONERO_RPC_PASSWORD`. Wallet files live in the `wallet_data` volume.

!!! note "No monerod"
    The wallet image deletes every binary from the Monero release except `monero-wallet-rpc`. Point `MONERO_DAEMON_ADDRESS` at your own node.

## Volumes and persistence

| Volume | Holds |
| --- | --- |
| `postgres_data` | Database files, API key hashes, payment requests, webhooks, rate-limit buckets. |
| `wallet_data` | Watch-only wallet files created by `generate_from_keys`. |
| `tor_data` / `tor_data_onion` | The onion service hostname and keys. |
| `i2p_data` | I2P router data and tunnels. |
| `postgres_data_dev`, `wallet_data_dev`, `dev_node_modules` | Development-only copies. |

`docker compose down` keeps volumes. `docker compose down -v` deletes them. Never run that without a [backup](backups.md).

## Ports and exposure

The production app listens on `3000`. Terminate TLS in front of it with nginx, Caddy, Traefik, or your platform's load balancer. The app deliberately doesn't handle certificates.

For a reverse proxy, set `TRUST_PROXY=1` only if the proxy **overwrites** `X-Forwarded-For`. Otherwise a client can spoof the header and bypass rate limits. With `TRUST_PROXY=0` (the default), API-key requests don't store any client IP at all.

```nginx
server {
    listen 443 ssl;
    server_name pay.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;  # overwrite, not append
    }
}
```

Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and a restrictive CSP) are set by the app on every response.

## Resource limits and hardening

Each service runs with `no-new-privileges`, all capabilities dropped, a PID limit of 200, and a 512 MB memory limit. PostgreSQL adds back only the capabilities it needs for file ownership. The app and wallet RPC run as non-root users.

## Checking the deployment

```bash
docker compose ps
curl -fsS https://pay.example.com/api/health
```

Look for `status: ok`, `services.db`, `services.walletRpc`, and `services.daemon` all `true`, and `sync.status` of `synced`. The [health endpoint reference](../api/health.md) explains the fields.

## Scheduling background work

Payment state changes and webhook delivery are driven by two endpoints. Run them on a schedule from the host or another container:

```bash
# every minute or two
curl -X POST https://pay.example.com/api/cron/payment-links \
  -H "x-cron-secret: $CRON_SECRET"

curl -X POST https://pay.example.com/api/cron/webhooks \
  -H "x-cron-secret: $CRON_SECRET"
```

Both require `x-cron-secret`; there's no other way to trigger them.

## Upgrading

```bash
git pull
docker compose up -d --build
```

Migrations run on startup. Back up the database and wallet volume before an upgrade, especially when changing Monero-related settings.

## Documentation deployment

This documentation site is built with `zensical build --clean --strict` in `.github/workflows/docs.yml` and published to GitHub Pages at `pay.ribaunt.com`. The `docs/CNAME` file sets the custom domain, and `zensical.toml` sets the matching `site_url`.

For the custom domain to work, add a DNS `CNAME` record for `pay.ribaunt.com` pointing at `<owner>.github.io`, then enable GitHub Pages with GitHub Actions as the publishing source in the repository settings.

Local preview:

```bash
zensical serve
```
