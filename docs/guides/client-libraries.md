---
icon: lucide/code
---

# Client libraries

Ribaunt Pay ships two small, dependency-free clients: TypeScript and Python. They are hand-written against the [OpenAPI contract](../api/index.md) and maintained alongside the server; they are not generated from it.

Both clients cover payment links (create, list, status, cancel, renew, with `Idempotency-Key`), fiat quotes and currencies, public proof verification, webhook registration and listing, audit exports, Prometheus metrics, SSE streams, revenue attestations, and offline signature verification.

## TypeScript

Copy [`sdk/typescript/src/index.ts`](https://github.com/ribaunt/pay/blob/main/sdk/typescript/src/index.ts) into your project. No runtime dependencies beyond Node's built-in `node:crypto`.

```ts
import { PayClient, verifyWebhookSignature } from "./index";

const pay = new PayClient("https://pay.example.com", process.env.PAYMENT_API_KEY!);

const { link } = await pay.createLink(
  { fiatAmount: "10", fiatCurrency: "USD", timeoutSeconds: 1800 },
  "order-123" // Idempotency-Key
);

// Public status checks use the token in a header, never in the URL.
const current = await pay.status(link.id, link.statusToken);

// Live updates: fetch-based stream because EventSource cannot send headers.
const stream = pay.events(link.id, link.statusToken);
stream.addEventListener("payment.confirmed", (data) => console.log(data));
// ... later: stream.close();

// Session-only endpoints log in once and capture CSRF cookies.
await pay.login(process.env.EMAIL!, process.env.PASSWORD!);
const report = await pay.attestation("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z");
```

Verify a delivered webhook with `verifyWebhookSignature(secret, deliveryId, event, rawBody, signature)`, and an attestation with `verifyAttestation(attestation, sessionSecret)`. See [Webhooks](../api/webhooks.md) and [Attestations](../api/attestations.md).

## Python

Copy [`sdk/python/pay_client.py`](https://github.com/ribaunt/pay/blob/main/sdk/python/pay_client.py) into your project. It uses only the standard library.

```python
import os

from pay_client import PayClient, verify_webhook_signature

pay = PayClient("https://pay.example.com", os.environ["PAYMENT_API_KEY"])

created = pay.create_link(
    fiatAmount="10", fiatCurrency="USD", timeoutSeconds=1800,
    idempotency_key="order-123",
)
link = created["link"]
current = pay.status(link["id"], link["statusToken"])

for event, data in pay.events(link["id"], link["statusToken"]):
    print(event, data)

pay.login(os.environ["EMAIL"], os.environ["PASSWORD"])
report = pay.attestation("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")
```

The Python event iterator blocks while the stream is open; read it in a dedicated thread or process. Both clients close their response bodies when the iterator/stream is released.

## Behavior shared by both

- Public endpoints send no credentials, API-key endpoints send `x-api-key`, and session endpoints use a login flow that captures the session and CSRF cookies. You can also pass a session cookie and CSRF token directly to the constructor.
- Requests have a configurable timeout and retry `429`/`5xx` responses, honoring `Retry-After`. Failures raise `PayError` with the HTTP status.
- The status token is always sent in `x-status-token`; it never appears in a URL, proxy log, or browser history.

Run the SDK suites with:

```bash
npm run test:sdk
python3 -m unittest discover -s sdk/python
```
