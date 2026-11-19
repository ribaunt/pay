---
icon: lucide/sliders-horizontal
---

# Environment variables

Every setting lives in `.env` at the repository root. Compose passes the relevant values to each container. Variables marked **required** must be set in production; placeholders cause a startup error.

## Database and app

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `POSTGRES_USER` | `pay` | no | Database user. |
| `POSTGRES_PASSWORD` | none | **yes** | At least 16 characters. |
| `POSTGRES_DB` | `pay` | no | Database name. |
| `POSTGRES_PORT` | `5432` | no | Host port for the DB in the `prod` profile. |
| `DATABASE_URL` | none | no | Prisma connection string; Compose builds it from the values above. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | no | Public base URL of the app. |
| `NODE_ENV` | `production` | no | Enables validation and secure cookies when `production`. |
| `COMPOSE_PROFILES` | `prod` | no | Comma-separated profiles to start. |

## Account and secrets

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `SINGLE_USER_EMAIL` | none | **yes** | The only accepted sign-in email. |
| `SINGLE_USER_PASSWORD` | none | **yes** | At least 12 characters. |
| `SESSION_SECRET` | none | **yes** | At least 32 characters; signs session cookies. |
| `WALLET_ENCRYPTION_KEY` | none | **yes** | Exactly 64 hex characters (32 bytes) for AES-256-GCM. |
| `PAYMENT_API_KEY` | none | **yes** | At least 24 characters; bootstrap server key. |
| `CRON_SECRET` | none | **yes** | At least 24 characters; protects cron endpoints. |
| `BACKUP_PASSPHRASE` | none | for backups | Passphrase for the encryption scripts. |

Generate random values with `openssl rand -hex 32` or your password manager. Don't reuse a value across variables.

## Monero

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `MONERO_NETWORK` | `mainnet` | no | `mainnet` or `stagenet`. Unknown values are rejected. |
| `MONERO_DAEMON_ADDRESS` | empty | recommended | Host and port of your node. Empty uses a public network default, suitable for local testing only. |
| `MONERO_DAEMON_MODE` | `full-scan` | no | Must be `full-scan`; anything else is rejected in production. |
| `MONERO_DAEMON_PROXY` | empty | no | SOCKS proxy address, e.g. `127.0.0.1:9050`. |
| `MONERO_DAEMON_FALLBACKS` | empty | no | Comma-separated extra daemon addresses used by the health check. |
| `MONERO_RPC_USER` | `monero` | **yes** | Digest username for `monero-wallet-rpc`. |
| `MONERO_RPC_PASSWORD` | none | **yes** | At least 16 characters. |
| `MONERO_WALLET_PASSWORD` | none | **yes** | At least 16 characters; encrypts wallet files. |
| `MONERO_WALLET_ADDRESS` | empty | no | Primary address imported automatically on first boot. |
| `MONERO_WALLET_VIEW_KEY` | empty | no | Private view key for the address above. Never log or commit it. |
| `MONERO_WALLET_RESTORE_HEIGHT` | `0` | no | Starting block for scanning; `0` scans from genesis. |
| `MONERO_WALLET_DESCRIPTION` | empty | no | Optional label stored with the wallet. |
| `MONERO_WALLET_RPC_URL` | `http://localhost:18082` | no | Set to `http://wallet-rpc:18082` by Compose. |

## Payments and pricing

| Variable | Default | Description |
| --- | --- | --- |
| `PAYMENT_DEFAULT_TIMEOUT_SECONDS` | `1800` | Expiry used when a link omits `timeoutSeconds`. |
| `PAYMENT_MIN_TIMEOUT_SECONDS` | `60` | Lower bound for a requested timeout. |
| `PAYMENT_MAX_TIMEOUT_SECONDS` | `86400` | Upper bound for a requested timeout. |
| `PAYMENT_REQUIRED_CONFIRMATIONS` | `10` | Default confirmations for a link. |
| `HEALTH_MAX_SYNC_LAG_BLOCKS` | `10` | Lag above which health reports `syncing`. |
| `PRICE_CACHE_TTL_SECONDS` | `60` | Quote cache lifetime. |
| `PRICE_MAX_STALENESS_SECONDS` | `300` | Maximum age of a cached quote served during an outage. |
| `PRICE_OUTLIER_THRESHOLD_BPS` | `500` | Outlier filter around the median price, in basis points. |
| `PRICE_HTTP_TIMEOUT_MS` | `5000` | Per-request timeout for price sources. |

## Network and privacy

| Variable | Default | Description |
| --- | --- | --- |
| `TRUST_PROXY` | `0` | Set to `1` only when a trusted proxy **overwrites** `X-Forwarded-For`. |
| `NEXT_TELEMETRY_DISABLED` | `1` | Baked into the image. Keep it set. |
| `DO_NOT_TRACK` | `1` | Baked into the image. Keep it set. |
| `ACCESS_MODE` | `clearnet` | Set by the Tor and I2P profiles; reported by health. |

## Production validation

`assertProductionEnv()` runs on authenticated and server-to-server paths when `NODE_ENV=production`. It checks:

- All required variables are present.
- `SESSION_SECRET` is at least 32 characters.
- `WALLET_ENCRYPTION_KEY` matches `/^[0-9a-fA-F]{64}$/`.
- `MONERO_DAEMON_MODE` is `full-scan`.
- `SINGLE_USER_PASSWORD` is at least 12 characters.
- `MONERO_RPC_PASSWORD`, `MONERO_WALLET_PASSWORD`, and `POSTGRES_PASSWORD` are at least 16 characters.
- `PAYMENT_API_KEY` and `CRON_SECRET` are at least 24 characters.

Integer settings such as timeouts are read through a helper that rejects negative or non-finite values. `MONERO_NETWORK` rejects anything other than the two supported names.

!!! warning "Restart after changes"
    Compose injects environment at container start. After editing `.env`, recreate containers with `docker compose up -d --force-recreate`. Changing encryption or wallet keys needs a planned migration. See [Configuration](../getting-started/configuration.md).
