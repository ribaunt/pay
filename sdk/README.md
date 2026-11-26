# Ribaunt Pay clients

Two small, dependency-free clients for the Ribaunt Pay HTTP API:

- **TypeScript** — `typescript/src/index.ts`: `PayClient` plus `PaymentEventStream` and signature helpers.
- **Python** — `python/pay_client.py`: `PayClient` plus verification helpers.

Both are hand-written against the API contract in [`public/openapi.json`](../public/openapi.json), which is also served by the app at `/openapi.json`. They are not generated from that file; keep them in sync with the docs in `docs/api/`.

## Common methods

Both clients support: create/list/status/cancel/renew payment links (including `Idempotency-Key`), fiat quotes and currency lists, public proof verification, webhook registration and listing, wallet audit, Prometheus metrics, SSE streams, and signed revenue attestations. The TypeScript client also exposes store listing; both expose offline webhook and attestation signature verification.

Auth is per method: public endpoints send no credentials, API-key endpoints send `x-api-key`, and session endpoints (`attestation`, stores, `me`, `logout`) use a login flow that captures the session and CSRF cookies. TypeScript: `await client.login(email, password)`. Python: `client.login(email, password)`. You can also pass a session cookie and CSRF token via the constructor.

`events(linkId, statusToken)` uses a streaming `fetch`/`urlopen` reader rather than browser `EventSource`, because the bearer token must travel in an `x-status-token` header and must never appear in a URL. TypeScript returns a `PaymentEventStream` (`addEventListener("payment.update", fn)`, `close()`); Python yields `(event, data)` pairs.

Requests have a timeout and retry 429/5xx responses, honoring `Retry-After`. Failures raise `PayError` (TypeScript) or `PayError` (Python) with the HTTP status.

## Tests

```bash
npm run test:sdk
python3 -m unittest discover -s sdk/python
```
