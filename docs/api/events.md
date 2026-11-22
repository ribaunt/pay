---
icon: lucide/zap
---

# Events (SSE)

`GET /api/events` streams payment-link updates as Server-Sent Events. It polls the database every second and emits only on real state changes.

## Subscribe to all links

Use an API key with `payment:read` or a session:

```bash
curl -N -H 'x-api-key: $PAYMENT_API_KEY' http://localhost:3000/api/events
```

## Subscribe to one link

Use the link ID and its status token — no API key needed:

```bash
curl -N 'http://localhost:3000/api/events?linkId=<id>&token=<statusToken>'
```

## Event format

```text
event: payment.update
data: { ...PaymentLink... }

: keep-alive
```

`payment.update` is sent when `status`, `confirmations`, or `receivedAtomic` changes. `payment.removed` is sent when a link disappears from the result set. Streams close after five minutes so clients should reconnect.

The `data` object is the canonical [`PaymentLink`](../reference/types.md#paymentlink) shape.
