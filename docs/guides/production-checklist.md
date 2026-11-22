---
icon: lucide/clipboard-check
---

# Production deployment checklist

TLS, reverse proxying and network policy are deliberately left to the deployment
environment. Use this checklist before exposing Ribaunt Pay publicly.

## Transport and proxy

- [ ] HTTPS is enforced for every public route.
- [ ] HSTS is configured at the proxy. The app also sets
      `Strict-Transport-Security`; if your proxy already does, set
      `HSTS_HEADER=0` so only one policy is emitted.
- [ ] Reverse-proxy access logs are enabled, and you know what they contain.
- [ ] `TRUST_PROXY=1` is set **only** when a trusted proxy overwrites
      `X-Forwarded-For` and `X-Forwarded-Host`. Otherwise leave it `0`.
- [ ] Client IP rate limiting is verified in both proxy and direct modes.

## Network

- [ ] PostgreSQL is not published on a public interface.
- [ ] The wallet RPC has no host port and is reachable only from the app
      container.
- [ ] Outbound egress is restricted at the firewall. Webhook delivery is
      validated and pinned by the app, but network policy is the second layer.
- [ ] Daemon connections use a node you control; `MONERO_DAEMON_MODE=full-scan`
      is enforced. Tor/I2P deployments remain first-class options.

## Secrets and encryption

- [ ] `SESSION_SECRET` is at least 32 random characters.
- [ ] `WALLET_ENCRYPTION_KEY` is 64 hex characters, stored separately from
      PostgreSQL backups.
- [ ] A development encryption key is never used in production (the app refuses
      to start without a valid key).
- [ ] Key rotation is planned: set a new `WALLET_ENCRYPTION_KEY_ID`, keep old
      keys in `WALLET_ENCRYPTION_PREVIOUS_KEYS` permanently for backup restores,
      and use `scripts/rotate-encryption-key.ts`. Never reuse a key id with
      different material.

## Backups

- [ ] Backups are encrypted with `BACKUP_PASSPHRASE`.
- [ ] A restore has been tested, including access to records encrypted with
      retired keys.
- [ ] Retention is configured per category
      (`RETENTION_PAYMENT_REQUESTS_DAYS`, `RETENTION_WEBHOOK_DELIVERIES_DAYS`,
      `RETENTION_RATE_LIMIT_BUCKETS_DAYS`). Records needed for accounting and
      reconciliation are not purged too aggressively.

## Application hardening

- [ ] Single-user credentials are strong; login rate limits are active.
- [ ] Cookie-authenticated mutations send a same-origin `Origin` header and the
      `x-csrf-token` from `GET /api/auth/csrf`. API-key requests are unaffected.
- [ ] Logs are checked for secrets, addresses, view keys and cookies.

See the [threat model](../architecture/threat-model.md) for what Ribaunt Pay does
and does not protect against.
