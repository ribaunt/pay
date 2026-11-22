---
icon: lucide/shield-alert
---

# Threat model

This document describes what Ribaunt Pay is designed to protect against, and
what it explicitly does not. For what data is collected and stored, see the
[privacy model](privacy-model.md).

## Protected assets

- **Spend authority.** The merchant's Monero funds must never be spendable by
  the application or an attacker who compromises it.
- **View key.** The private view key allows reconstruction of incoming payments.
- **Payment separation.** Fresh subaddresses must not be linkable by address.
- **Operator account.** The single user's session and credentials.
- **API keys and webhook secrets.** Credentials for server-to-server access and
  signed event delivery.

## Trust boundaries

| Boundary | Who crosses it | Controls |
| --- | --- | --- |
| Browser → app | Operator | HMAC-signed session cookie, Strict origin check, CSRF token |
| Server → app | Merchant backend | Scoped API keys, SHA-256 key hashes, per-key rate limits |
| App → wallet RPC | App only | No host port, HTTP Digest, internal compose network |
| App → daemon | App only | Full-scan enforced; view key never sent to a remote node |
| App → webhook endpoint | Untrusted URL supplied by API user | URL validation, DNS pinning, no redirects, egress policy |
| Operator → database | Operator / backup system | Encryption at rest for secrets; network isolation |

## Attack scenarios and expected protection

| Attack | Expected protection |
| --- | --- |
| PostgreSQL dump only | View key and webhook secrets remain encrypted. Subaddresses, amounts, transaction hashes and metadata are visible. |
| PostgreSQL dump + encryption key | View key is exposed. Encryption at rest does not help once the key is available to the attacker. |
| Application host compromise | View key is potentially exposed, because the running app holds the decryption key in memory. This is an expected limit without an external KMS/HSM. |
| Ciphertext substitution | Prevented by authenticated additional data (AAD) binding each ciphertext to its purpose and record id. |
| Wallet RPC compromise | Wallet files are encrypted with `MONERO_WALLET_PASSWORD`; the RPC has no host port. The attacker needs both wallet password and RPC credentials. |
| Webhook SSRF / DNS rebinding | All A/AAAA records are resolved and validated, the connection is pinned to a validated IP, redirects are disabled, and validation is repeated per delivery. Network egress policy is a required second layer. |
| Malicious limited API user | Scopes restrict actions, webhook endpoints are scoped to keys/stores, and rate limits are keyed by key id. |
| Cross-site request forgery | Cookie-authenticated mutations require a same-origin `Origin` header and a valid CSRF token. API-key requests are deliberately exempt. |

## Non-goals

- **Not anonymous.** The merchant's server observes incoming payments. The
  merchant's infrastructure can collect identifying information about customers.
- **Not resistant to a compromised application host.** A host compromise can
  expose the view key and all decrypted records.
- **Not a custody solution.** There are no spend keys and no customer funds held
  by Ribaunt Pay.
- **Transport security is a deployment responsibility.** TLS/HSTS and proxy
  configuration belong to the operator; see the
  [production deployment checklist](../guides/production-checklist.md).

## Deployment assumptions

- `MONERO_DAEMON_MODE=full-scan` is enforced; light-wallet mode is rejected.
- `WALLET_ENCRYPTION_KEY` is supplied from the environment in production; a
  development key is never used in production.
- The wallet RPC is reachable only from the app container.
- The operator configures HTTPS, HSTS, database network isolation, encrypted
  backups and outbound network policy.

## Regression coverage

Security claims in this document are covered by the `security/` test suite and
by CI. See [security testing](security.md#security-testing).
