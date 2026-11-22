---
icon: lucide/lock-keyhole
---

# Security policy

## Reporting a vulnerability

Please do not open a public issue for security vulnerabilities. Report them
privately using GitHub's private vulnerability reporting on this repository, or
contact the maintainers directly. Include affected versions, reproduction steps
and impact. You should receive an acknowledgement within seven days.

## Supported versions

Security fixes are applied to the latest release. Older releases may receive
backports at the maintainers' discretion.

## Scope

- In scope: the Ribaunt Pay application, its container images, API, wallet RPC
  isolation and documentation.
- Out of scope: customer misconfiguration, compromised host operating systems,
  the Monero protocol itself, and third-party reverse proxies.

## Related documents

- [Threat model](threat-model.md) — attacker capabilities, trust boundaries,
  compromise scenarios and assumptions.
- [Privacy model](privacy-model.md) — what data is collected, stored, exposed
  and protected.
- [Production deployment checklist](../guides/production-checklist.md) —
  operator responsibilities that the application cannot enforce.

## Security testing

Security claims are backed by automated regression tests in `src/**/*.test.ts`
and `tests/integration`, covering:

- SSRF and DNS rebinding (all A/AAAA records, pinned connections, numeric hosts).
- CSRF origin/token validation and API-key exemption.
- Constant-time credential comparison and login rate limits.
- Encryption envelope integrity, AAD binding and old/new key rotation.
- Scoped API keys and object-level access.
- Secret leakage in logs.
