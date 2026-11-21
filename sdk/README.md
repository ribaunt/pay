# Ribaunt Pay clients

Generated from the canonical API contract in [`public/openapi.json`](../public/openapi.json).

- **TypeScript**: `typescript/src/index.ts` — `PayClient` with `createLink`, `listLinks`, `status`, `quote`, and `events` (SSE via `EventSource`).
- **Python**: `python/pay_client.py` — dependency-free `PayClient` with `create_link`, `list_links`, `status`, `quote`, and `attestation`.

Every response uses the standardized field names: `amountXmr`/`amountAtomic`,
`receivedXmr`/`receivedAtomic`, `txHash`, and the `rate*` family.

The OpenAPI document is also served by the app at `/openapi.json`.
