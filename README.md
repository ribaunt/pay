<img src="assets/icon.svg" width="64" height="64" alt="">

# Ribaunt Pay

Privacy-focused Next.js + PostgreSQL starter with Monero watch-only wallet support, fully containerized with Docker Compose.

## Documentation

Full documentation: **[pay.ribaunt.com](https://pay.ribaunt.com)** — installation, configuration, guides, architecture, API reference, and types. To build the site locally, see [docs/guides/development.md](docs/guides/development.md#working-on-these-docs).

## Stack

- Next.js 16 (App Router, TypeScript, standalone output)
- PostgreSQL 16
- Prisma ORM
- monero-wallet-rpc (official prebuilt CLI release, verified against GPG-signed hashes)

## Run with Docker

The published image is the normal way to run Ribaunt Pay:

```bash
curl -fsSL https://pay.ribaunt.com/compose.yml -o compose.yml
curl -fsSL https://pay.ribaunt.com/env.example -o .env
chmod 600 .env
# fill in MONERO_DAEMON_ADDRESS, MONERO_NETWORK and the MONERO_WALLET_* values
docker compose up -d
docker logs pay        # one-time sign-in credentials on first boot
curl http://localhost:3000/api/health
```

The Compose file pins the latest release image. Set `PAY_VERSION` in `.env` to choose another version. There is no web UI — everything else is API-driven.

To run from source instead (development or custom Tor/I2P profiles):

```bash
git clone https://github.com/ribaunt/pay.git
cd pay
cp .env.example .env
chmod 600 .env
docker compose up --build
```

`COMPOSE_PROFILES` in `.env` selects the mode:

- `prod` — hardened server on `:3000`, wallet RPC internal only.
- `dev` — isolated DB on `:5433`, hot reload on `:3001`, wallet RPC debug `:18083`.
- `prod,tor` — production stack plus the optional onion service.
- `tor-only` — onion service only; no clearnet ports are published.
- `i2p-only` — I2P HTTP tunnel only; no clearnet ports are published.

Services in prod:
- App → http://localhost:3000
- Postgres → localhost:5432
- Monero wallet RPC → internal only (`wallet-rpc:18082`), no host port

Dev workflow:

```bash
COMPOSE_PROFILES=dev docker compose up -d --build
npm run seed
APP_URL=http://localhost:3001 npm run test:integration
```

**No `monerod` is bundled.** Point `MONERO_DAEMON_ADDRESS` at your own node. The public default in `.env.example` leaks your server IP to a third party and should only be used for local testing.

## Network mode

Set `MONERO_NETWORK=mainnet` or `MONERO_NETWORK=stagenet`. Modes are mutually exclusive:

- Mainnet accepts only `4...` primary and `8...` subaddresses.
- Stagenet accepts only `5...` primary and `7...` subaddresses.
- The wallet RPC entrypoint refuses unknown modes and adds `--stagenet` only in stagenet mode.
- `GET /api/health` reports the active network.

## Privacy model

- **No telemetry.** `NEXT_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1` are baked into the image. No remote fonts, CDNs, or analytics.
- **Verified binaries.** `Dockerfile.wallet` pins Monero v0.18.5.4, imports the binaryFate and luigi1111 release keys with pinned fingerprints, verifies the GPG-signed `hashes.txt`, and checks the tarball SHA-256 before extraction. The `monerod` binary from the tarball is deleted; only `monero-wallet-rpc` ships.
- **Single-user, env-only sign-in.** There are no sign-ups and no anonymous sessions. The only accepted credentials are `SINGLE_USER_EMAIL` and `SINGLE_USER_PASSWORD` from `.env`.
- **Payment proofs.** Generate transaction proofs from the recipient's watch-only wallet and verify them publicly without an account.
- **Wallet RPC** uses HTTP Digest auth and has no host port.
- **View keys** are encrypted with AES-256-GCM before Postgres storage and are never returned by any API.
- **Fresh subaddress per payment request** so incoming payments are not linkable to one address. Used subaddresses are detected via `get_address` and tracked with `used` / `lastUsedAt`.
- **Full-scan remote-node mode.** `MONERO_DAEMON_MODE=full-scan` is required; light-wallet mode is rejected because it would send the view key to a remote daemon. Optional `MONERO_DAEMON_PROXY` routes daemon traffic through a SOCKS proxy such as Tor, and `MONERO_DAEMON_FALLBACKS` provides health-check fallbacks.
- **Multiple API keys** with scopes and revocation; the env key is bootstrap-only and stored as a hash.
- **Postgres-backed, shared rate limits** — no IP addresses are stored for authenticated API-key calls, and `X-Forwarded-For` is ignored unless `TRUST_PROXY=1`.
- **Strong production secrets** are required and length-checked; no weak defaults.
- **Webhook defense:** HTTPS-only in production, DNS-resolution checks, redirect disabled, and webhook secrets encrypted at rest.
- **Security headers** on all responses.
- **SBOM + signed artifacts** are generated in CI with Syft and cosign.
- **TLS / reverse proxy** is intentionally left to the deployment environment (nginx, Caddy, Traefik).

## Payment links, timeouts and fiat pricing

Create a payment link from a server-side client with `POST /api/payment-links`, authenticated by `x-api-key: $PAYMENT_API_KEY`:

- send `{ "fiatAmount": "10", "fiatCurrency": "USD", "timeoutSeconds": 1800 }`, or
- send `{ "amountXmr": "0.01", "timeoutSeconds": 1800 }`.

`timeoutSeconds` is optional, bounded by `PAYMENT_MIN_TIMEOUT_SECONDS` / `PAYMENT_MAX_TIMEOUT_SECONDS`, and `0` means no expiry. The response contains `statusUrl` and a separate `statusToken`. Check status with `GET <statusUrl>` and header `x-status-token: <statusToken>`; no account needed. Tokens are never placed in URLs.

Fiat quotes use a multi-source oracle: CoinGecko, CoinCap, Coinbase and Kraken for XMR/USD, plus Frankfurter/exchangerate.host for FX. Prices are aggregated by median with outlier filtering, cached for `PRICE_CACHE_TTL_SECONDS`, and the locked rate is stored on the payment request.

Run settlement with `POST /api/cron/payment-links`, authenticated by `x-cron-secret: $CRON_SECRET`. It expires unpaid links, detects incoming payments, and advances status through `detected`, `confirming`, `confirmed`, `expired`, `late` and `cancelled`.

Cancel a waiting link with `POST /api/payment-links/[id]/cancel` (session or `x-api-key`). Cancellation is only accepted while status is `pending` and no `txHash`/`paidAt` exists. Once a transaction is seen, cancellation returns `409`.

`GET /api/payment-links?status=late` lists links for manual review. Late payments keep updating confirmations but are never auto-refunded.

Additional payment behavior:
- `Idempotency-Key` on `POST /api/payment-links` prevents duplicate links on retries.
- `requiredConfirmations` can be set per link (1–100).
- Underpayments become `underpaid`; additional transfers to the same subaddress top them up. Overpayments are recorded with `receivedAtomic`.
- `POST /api/payment-links/[id]/renew` creates a fresh subaddress and expiry for an expired link with no transaction.
- Webhooks deliver signed events (`payment.detected`, `payment.confirmed`, `payment.underpaid`, `payment.late`, `payment.cancelled`, etc.) with HMAC-SHA256. Register via `POST /api/webhooks`; dispatch with `POST /api/cron/webhooks`.

## Optional Tor / onion access

```bash
docker compose --profile tor up -d
sh scripts/onion-address.sh
```

The `tor` profile starts a hidden service pointing at the app. It publishes no SOCKS proxy. The onion hostname is persisted in the `tor_data` volume.

`COMPOSE_PROFILES=tor-only docker compose up -d` starts an onion-only stack with **no clearnet ports**. `COMPOSE_PROFILES=i2p-only docker compose up -d` does the same over I2P; read the address with `sh scripts/i2p-address.sh`.

## Watch-only setup

Set `MONERO_WALLET_ADDRESS`, `MONERO_WALLET_VIEW_KEY` and optionally `MONERO_WALLET_RESTORE_HEIGHT` in `.env`. The wallet is imported automatically on first boot. Spend keys are never requested, sent, or stored. The same import is available later through `POST /api/wallet/setup`.

## API

Public:
- `GET /api/health` — status of Postgres and wallet RPC
- `GET /api/payment-links/[id]/status` with `x-status-token: <token>` — payment status
- `POST /api/auth/login` — sign in with `.env` credentials
- `POST /api/auth/logout`
- `GET /api/auth/me` — current session info
- `POST /api/public/payment-proofs/verify` — verify a payment proof without an account

There is no `/api/auth/register` or `/api/auth/anonymous` endpoint.

Server-to-server / cron:
- `GET/POST /api/payment-links` — list or create fiat/XMR payment links (`x-api-key`)
- `POST /api/payment-links/[id]/cancel`, `/renew`
- `GET /api/prices/currencies`, `GET /api/prices/quote`
- `GET/POST /api/webhooks`, `POST /api/cron/webhooks`
- `GET/POST /api/admin/api-keys`, `POST /api/admin/api-keys/[id]/revoke`
- `GET /api/metrics` — Prometheus metrics; ready-made alert rules live in [alerts/payment.yml](/Users/musti/.t3/projects/pay/alerts/payment.yml)
- `POST /api/cron/payment-links` — settle/expire links (`x-cron-secret`)

Authenticated:
- `POST /api/wallet/setup` — `{ address, viewKey, restoreHeight?, description? }`
- `GET /api/wallet` — wallet name, primary address, balances
- `GET /api/wallet/balance`, `GET /api/wallet/address`
- `GET /api/wallet/transfers` — filter with `incoming`, `outgoing`, `pending`, `failed`, `pool` flags
- `GET/POST /api/wallet/subaddresses` — list or create a fresh subaddress
- `GET /api/wallet/audit?format=json|csv` — view-key-only accounting export; never includes keys
- `POST /api/wallet/payment-requests` — `{ amountXmr, label? }` → payment URI
- `GET /api/wallet/payment-requests` — stored payment requests
- `GET/POST /api/wallet/payment-proofs` — list or generate `{ txHash, address, message? }`
- `POST /api/wallet/close`

Monero amounts are strings/bigint in piconero (1 XMR = 1e12 piconero). Migrations run on startup.

## Client libraries

Dependency-free [TypeScript and Python clients](sdk/README.md) cover payment links, webhooks, proofs, prices, SSE streams with header tokens, idempotency keys, retries and offline signature verification. The full HTTP contract is served at `/openapi.json`.

## Releases

Signed, multi-arch images are published as `ghcr.io/ribaunt/pay`, `ghcr.io/ribaunt/pay-app`, and `ghcr.io/ribaunt/pay-wallet-rpc`. Pushing a `v*` tag runs `.github/workflows/release.yml`, which validates, builds, signs, attests, and creates a GitHub Release. The all-in-one appliance can be installed with `release/install.sh`.

## Backups

```bash
BACKUP_PASSPHRASE=... sh scripts/backup.sh          # writes encrypted .enc files to ./backups
BACKUP_PASSPHRASE=... sh scripts/restore.sh <db.sql.enc> <wallet.tar.gz.enc>
```

Backups use AES-256-CBC with PBKDF2 and are created with `umask 077`. Keep `.env` and `./backups` at mode `0600`/`0700`.

## Tests

```bash
npm test          # unit tests, Node 24+ required for module mocks
npm run test:sdk  # TypeScript SDK tests
python3 -m unittest discover -s sdk/python   # Python SDK tests
npm run test:watch
npm run test:integration   # against a running stack
```

Tests use the built-in Node test runner with `tsx`; Vitest/Vite were removed.

CI runs unit tests, type-check, build and production audit on every push/PR, plus an integration smoke test with generated throwaway secrets.

`npm audit` reports **0 vulnerabilities** for both production and dev dependencies. CI downloads Syft and cosign with pinned versions and verifies SHA-256 digests before use.

Covers amount conversion, digest auth, wallet logic, payment proofs, auth tokens, encryption, rate limiting, and production env validation, with RPC and Prisma mocked.

Verified live: security headers, header-only cron secret, status token via header, non-root wallet RPC with no credentials in argv, encrypted backup/restore round-trip, and synced health. Logout increments the user's session version and invalidates older cookies.

## License

Ribaunt Pay is released under the [Apache License 2.0](LICENSE).

The `monero-wallet-rpc` binary shipped in the wallet and appliance images is a
third-party component licensed under BSD-3-Clause, with portions under MIT. Its
notices are reproduced in [NOTICE](NOTICE), which is also included in the images
and release assets. Monero's name is used only to describe compatibility; it is
not an endorsement.
