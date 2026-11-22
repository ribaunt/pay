---
icon: lucide/shield-check
---

# Privacy model

Ribaunt Pay is built around a simple idea: accepting a payment should not require giving up control of a wallet or identifying the person paying.

## What never leaves your host

| Thing | Why |
| --- | --- |
| **Spend keys** | Never requested, sent, or stored. Setup asks only for a primary address and a private view key. |
| **View key to the daemon** | `MONERO_DAEMON_MODE` must be `full-scan`. Light-wallet mode is rejected at startup because it would send the view key to a remote daemon. |
| **Telemetry** | `NEXT_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1` are baked into the image. No remote fonts, CDNs, or analytics. |
| **Client IPs for API calls** | Rate limits for API-key callers are keyed by key ID. `X-Forwarded-For` is ignored unless `TRUST_PROXY=1`. |
| **Status token in a URL** | The token travels in `x-status-token`, so it is less likely to land in logs, browser history, or referrers. |

`GET /api/health` reports `viewKeySentToDaemon: false` and `lightWallet: false` so a regression is visible without reading code.

## What is stored

The server does keep data, because it has to:

- The primary address, restore height, and a description.
- The private view key, encrypted with AES-256-GCM before it reaches PostgreSQL. The envelope is `v2.<key_id>.<iv>.<tag>.<ciphertext>` with authenticated additional data binding it to its purpose and record id. Legacy `v1` records remain readable.
- Payment requests with amounts, subaddresses, expiries, transaction hashes, and confirmation counts.
- Fresh subaddresses and whether they were used.
- Payment proofs and their signatures.
- API keys as SHA-256 hashes, plus names, prefixes, scopes, and usage timestamps.
- Webhook endpoints, their encrypted secrets, and delivery attempts.
- Rate-limit buckets.

No endpoint returns the stored view key, an API key hash, or a webhook secret after registration.

## Wallet isolation

Each payment gets a fresh subaddress from the watch-only wallet. That prevents an observer from linking separate payments by address. The wallet RPC has no host port in production and uses HTTP Digest authentication; only the app container can reach it.

Wallet files are encrypted with `MONERO_WALLET_PASSWORD` and live in a dedicated volume. The app serializes open/close transitions because the RPC serves one wallet at a time.

## Verified binaries

`Dockerfile.wallet` pins Monero v0.18.5.4 and its SHA-256 hashes, imports the release signing keys with pinned fingerprints, verifies the GPG-signed `hashes.txt`, and checks the downloaded tarball hash before extraction. It then deletes everything except `monero-wallet-rpc`. That includes `monerod`, so the container can't silently become a public node.

## Accounts and access

There's exactly one account, defined by `SINGLE_USER_EMAIL` and `SINGLE_USER_PASSWORD` in `.env`. There's no `/api/auth/register` and no anonymous session. Sessions are HMAC-signed, HTTP-only, SameSite=Lax, and Secure in production. Logging out increments the user's session version, which invalidates every older cookie. Credential comparison is constant-time and login is rate limited per source and per account.

Cookie-authenticated mutations additionally require a strict same-origin `Origin` header and a CSRF token issued by `GET /api/auth/csrf`. API-key requests do not carry the session cookie and are deliberately exempt from browser CSRF rules.

Server-to-server access uses scoped API keys. The bootstrap key in `.env` is stored as a hash on first use, and each additional key can be revoked independently. Cron endpoints use a separate shared secret.

Production startup checks secret length and format and refuses to run with weak placeholders. `SESSION_SECRET` must be at least 32 characters, encryption keys exactly 32 bytes in hex, and the RPC, wallet, API, and cron secrets have their own minimums.

## Outbound safety

Webhook URLs are validated before registration and again before delivery:

- HTTPS only in production.
- No embedded credentials.
- No private, loopback, link-local, or `.local`/`.internal` hosts, checked both as literals and after DNS resolution. All A and AAAA records are checked; a mixed public/private response is rejected.
- The outbound connection is pinned to a validated IP while the original hostname is preserved for TLS verification and the `Host` header. This closes the DNS rebinding gap between validation and connection.
- Redirects disabled, response size and connection limits enforced, and validation repeated on every delivery.

This prevents someone with `webhook:write` from using the app to probe your internal network. Network-level egress restrictions are still recommended as a second layer.

## Transport and headers

TLS and reverse proxying are deliberately left to the deployment environment. The app sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security`, and a restrictive content security policy on every response. See the [production deployment checklist](../guides/production-checklist.md).

## Data retention

Retention is configurable per record category and never applied to open payment
requests. Defaults are conservative because merchants may need records for
accounting, reconciliation and dispute resolution:

- Completed/cancelled payment requests: 365 days by default.
- Webhook deliveries: 30 days by default.
- Rate-limit buckets: 1 day by default.
- View key, primary address and API key hashes: retained indefinitely.

Set `RETENTION_*_DAYS=0` to disable purging a category and run the retention cron
endpoint after each release. Records may be needed for legitimate accounting
purposes, so do not set aggressive values without reviewing that need.

CI generates SPDX SBOMs with Syft and signs them with cosign, with pinned tool versions and verified download hashes.

## What privacy doesn't mean

- A watch-only wallet still reveals incoming amounts and history to whoever holds the view key.
- Payment metadata lives in your PostgreSQL instance; anyone with database access can read it.
- Fiat links make outbound HTTPS calls to public price APIs. Those calls contain the requested currency, not customer identities.
- If you publish clearnet ports, your reverse proxy will see client addresses unless you configure it otherwise.

For a fully private deployment use `tor-only` or `i2p-only`, point the daemon at a node you control, and route it through a SOCKS proxy.

For attacker capabilities, trust boundaries and compromise scenarios, see the [threat model](threat-model.md). To report a vulnerability, see the [security policy](security.md).
