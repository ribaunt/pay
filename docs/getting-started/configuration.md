---
icon: lucide/sliders-horizontal
---

# Configuration

All configuration lives in `.env`. The app reads it through Compose, which passes only the values each service needs. Production startup validates secrets and fails fast when something is missing.

## Start from the example

```bash
cp .env.example .env
chmod 600 .env
```

Then replace every placeholder. The full variable list is in the [environment reference](../reference/environment.md); this page explains the groups and the decisions behind them.

## The groups

### Database and application

| Variable | Purpose |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Database credentials used by both the DB container and the app. |
| `DATABASE_URL` | Prisma connection string. Compose builds it from the values above. |
| `NEXT_PUBLIC_APP_URL` | Public base URL used when generating links. |
| `NODE_ENV` | `production` enables secret validation and secure cookies. |
| `COMPOSE_PROFILES` | Which services to start. See [Installation](installation.md). |

### Single user

Ribaunt Pay has one account. There are no sign-ups, no anonymous sessions, and no password reset flow.

| Variable | Purpose |
| --- | --- |
| `SINGLE_USER_EMAIL` | The only email accepted at sign-in. |
| `SINGLE_USER_PASSWORD` | Its password. Must be at least 12 characters in production. |

The credentials come from environment variables, not from the database. Logging out increments a session version, which invalidates every cookie issued before that point.

### Secrets

These are checked at startup. Use a password manager or `openssl rand` to generate them; don't reuse values.

| Variable | Rule |
| --- | --- |
| `SESSION_SECRET` | At least 32 characters. Signs the session cookie. |
| `WALLET_ENCRYPTION_KEY` | 64 hex characters (32 bytes) for AES-256-GCM. |
| `MONERO_RPC_USER` / `MONERO_RPC_PASSWORD` | HTTP Digest credentials for `monero-wallet-rpc`. Password at least 16 characters. |
| `MONERO_WALLET_PASSWORD` | Encrypts wallet files on the `wallet_data` volume. At least 16 characters. |
| `PAYMENT_API_KEY` | Bootstrap server-to-server key. At least 24 characters. |
| `CRON_SECRET` | Protects the settlement and webhook dispatch endpoints. At least 24 characters. |
| `BACKUP_PASSPHRASE` | Needed by the backup and restore scripts. |

!!! warning "Changing a key after setup"
    `WALLET_ENCRYPTION_KEY`, `MONERO_WALLET_PASSWORD`, and `SESSION_SECRET` aren't just login details. Changing them breaks the ability to decrypt stored view keys, open wallet files, or validate existing sessions. Back up first and plan the migration.

### Monero

| Variable | Purpose |
| --- | --- |
| `MONERO_NETWORK` | `mainnet` or `stagenet`. Address formats are mutually exclusive. |
| `MONERO_DAEMON_ADDRESS` | Your node's host and port. Empty means the network default, which is fine for local testing only. |
| `MONERO_DAEMON_MODE` | Must be `full-scan`. Light-wallet mode is rejected because it would send the view key to a remote daemon. |
| `MONERO_DAEMON_PROXY` | Optional SOCKS proxy such as `127.0.0.1:9050` for daemon traffic. |
| `MONERO_DAEMON_FALLBACKS` | Comma-separated extra nodes used by the health check when the primary fails. |
| `MONERO_WALLET_RPC_URL` | Internal URL of `monero-wallet-rpc`; Compose sets this to `http://wallet-rpc:18082`. |

### Payments and pricing

| Variable | Default | Purpose |
| --- | --- | --- |
| `PAYMENT_DEFAULT_TIMEOUT_SECONDS` | `1800` | Expiry when a link does not specify one. |
| `PAYMENT_MIN_TIMEOUT_SECONDS` | `60` | Lower bound for a requested timeout. |
| `PAYMENT_MAX_TIMEOUT_SECONDS` | `86400` | Upper bound for a requested timeout. |
| `PAYMENT_REQUIRED_CONFIRMATIONS` | `10` | Confirmations needed before a link becomes `confirmed`. |
| `HEALTH_MAX_SYNC_LAG_BLOCKS` | `10` | Lag above which health reports `syncing`. |
| `PRICE_CACHE_TTL_SECONDS` | `60` | How long a quote is cached. |
| `PRICE_MAX_STALENESS_SECONDS` | `300` | How long a cached quote may be served when sources fail. |
| `PRICE_OUTLIER_THRESHOLD_BPS` | `500` | Outlier filter for the median price, in basis points. |

### Network and privacy

| Variable | Purpose |
| --- | --- |
| `TRUST_PROXY` | Set to `1` only when a trusted reverse proxy overwrites `X-Forwarded-For`. Otherwise client IPs are ignored. |
| `NEXT_TELEMETRY_DISABLED`, `DO_NOT_TRACK` | Baked into the image. No telemetry, remote fonts, CDNs, or analytics. |
| `ACCESS_MODE` | Set by the Tor and I2P profiles; health reports it. |

## Example: a production `.env`

```dotenv
COMPOSE_PROFILES=prod
POSTGRES_USER=pay
POSTGRES_PASSWORD=<generated-32-char-value>
POSTGRES_DB=pay
DATABASE_URL=postgresql://pay:<password>@db:5432/pay?schema=public

SINGLE_USER_EMAIL=admin@example.com
SINGLE_USER_PASSWORD=<generated-20-char-value>

SESSION_SECRET=<hex-32-bytes>
WALLET_ENCRYPTION_KEY=<hex-32-bytes>
PAYMENT_API_KEY=<generated-32-char-value>
CRON_SECRET=<generated-32-char-value>
MONERO_RPC_USER=monero
MONERO_RPC_PASSWORD=<generated-24-char-value>
MONERO_WALLET_PASSWORD=<generated-24-char-value>
BACKUP_PASSPHRASE=<long-passphrase>

MONERO_NETWORK=mainnet
MONERO_DAEMON_ADDRESS=xmr.example.com:18081
MONERO_DAEMON_MODE=full-scan
TRUST_PROXY=0
```

Never commit `.env`. It's already in `.gitignore`; keep the file at mode `600`.

## Applying changes

Most variables are read when a container starts, so restart the stack after editing `.env`:

```bash
docker compose up -d --force-recreate
```

If you change a wallet-related key, read the warning above before restarting. The stored view key may no longer decrypt.
