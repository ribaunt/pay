---
icon: lucide/sliders-horizontal
---

# Admin and metrics

Manage API keys and scrape process metrics. Both require authentication; neither is public.

## List API keys

`GET /api/admin/api-keys` needs a signed-in session.

```json
{
  "keys": [
    {
      "id": "clh...",
      "name": "storefront",
      "prefix": "pk_abc12345...",
      "scopes": "payment:write,payment:read",
      "createdAt": "2026-11-18T12:00:00.000Z",
      "expiresAt": null,
      "revokedAt": null,
      "lastUsedAt": "2026-11-18T13:55:00.000Z"
    }
  ]
}
```

Key hashes and secrets are never included.

## Create an API key

`POST /api/admin/api-keys` needs a session and allows 10 calls per minute.

```bash
curl -X POST https://pay.example.com/api/admin/api-keys \
  -H 'content-type: application/json' \
  -b 'pay_session=<token>' \
  -d '{ "name": "storefront", "scopes": "payment:write,payment:read" }'
```

| Field | Default | Notes |
| --- | --- | --- |
| `name` | required | At most 80 characters. |
| `scopes` | `payment:write,payment:read` | Lowercase letters, colons, commas, and spaces only. |

Response `201`:

```json
{
  "key": {
    "id": "clh...",
    "name": "storefront",
    "scopes": "payment:write,payment:read",
    "prefix": "pk_abc12345...",
    "secret": "pk_abc12345........................"
  }
}
```

Copy `secret` right away. It starts with `pk_`, contains 24 random bytes, and is stored only as a hash.

## Revoke an API key

`POST /api/admin/api-keys/{id}/revoke` needs a session.

```json
{ "id": "clh...", "revokedAt": "2026-11-18T14:00:00.000Z" }
```

Revocation takes effect on the next request. Unknown IDs produce an error.

## Metrics

`GET /api/metrics` accepts a session or an API key with `metrics:read`.

```bash
curl https://pay.example.com/api/metrics \
  -H "x-api-key: $PAYMENT_API_KEY"
```

```text
# TYPE pay_db_up gauge
pay_db_up 1
# TYPE pay_payment_links_created_total counter
pay_payment_links_created_total 12
# TYPE pay_payment_status_transitions_total counter
pay_payment_status_transitions_total{status="confirmed"} 5
```

Content type is `text/plain; version=0.0.4`. The full metric list and suggested alerts are in [Monitoring](../guides/monitoring.md). For scrape configuration and dashboards, see [Prometheus](../guides/prometheus.md) and [Grafana](../guides/grafana.md).

!!! note "Per-process values"
    Counters live in memory. They reset on restart and aren't shared between replicas. Health checks refresh the dependency gauges, so scrape regularly.
