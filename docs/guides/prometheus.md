---
icon: lucide/chart-line
---

# Prometheus

Prometheus can scrape Ribaunt Pay directly. This guide sets up a scrape job, loads the included alert rules, and explains the limits of process-local metrics.

## Before you start

You need:

- A running Ribaunt Pay stack with `GET /api/health` returning `ok`.
- An API key with the `metrics:read` scope. The bootstrap `PAYMENT_API_KEY` only has `payment:read,payment:write`, so create a dedicated key:

```bash
curl -X POST https://pay.example.com/api/admin/api-keys \
  -H 'content-type: application/json' \
  -b 'pay_session=<session-token>' \
  -d '{"name": "prometheus", "scopes": "metrics:read"}'
```

Save the returned `secret` somewhere your Prometheus host can read it, for example `/etc/prometheus/secrets/pay_metrics_key` with mode `600`.

!!! note "The metrics endpoint isn't public"
    `GET /api/metrics` accepts a session cookie or an API key with `metrics:read`. Prometheus can't use a browser session, so an API key is the practical choice.

## Configure the scrape job

On current Prometheus (3.x), `http_headers` can send the custom `x-api-key` header. Using `files` keeps the secret out of the main config file:

```yaml
# prometheus.yml
global:
  scrape_interval: 30s
  evaluation_interval: 15s

scrape_configs:
  - job_name: ribaunt-pay
    metrics_path: /api/metrics
    scheme: https
    static_configs:
      - targets: ["pay.example.com"]
    http_headers:
      x-api-key:
        files: ["/etc/prometheus/secrets/pay_metrics_key"]
```

If your Prometheus predates `http_headers`, it can't set arbitrary request headers. Put a small reverse proxy in front of the app that injects `x-api-key`, and point the scrape job at the proxy instead.

Check the config before restarting:

```bash
promtool check config /etc/prometheus/prometheus.yml
curl -H "x-api-key: $(cat /etc/prometheus/secrets/pay_metrics_key)" \
  https://pay.example.com/api/metrics | head
```

If Prometheus reports `up == 0` for the job, check the API key scope first. A key without `metrics:read` gets rejected just like an unknown key.

## Load the alert rules

The repository ships a rules file at [`alerts/payment.yml`](https://github.com/ribaunt/pay/blob/main/alerts/payment.yml). Copy it to your Prometheus rules directory and reference it:

```yaml
rule_files:
  - /etc/prometheus/rules/payment.yml
```

Validate it with:

```bash
promtool check rules /etc/prometheus/rules/payment.yml
```

The file defines alerts for a down database, wallet RPC, or daemon; high wallet sync lag; degraded price sources; webhook failures; settlement errors; and rate-limit hits. The [Monitoring guide](monitoring.md#alert-rules) lists each rule.

## Useful queries

```promql
# Wallet behind the chain
pay_wallet_sync_lag_blocks > 10

# Payments created per hour
rate(pay_payment_links_created_total[1h]) * 3600

# Confirmed payments in the last day
increase(pay_payment_status_transitions_total{status="confirmed"}[24h])

# Webhook success ratio over 15 minutes
sum(rate(pay_webhook_delivered_total[15m])) /
  sum(rate(pay_webhook_deliveries_total[15m]))

# How many XMR price sources answered
pay_price_sources_healthy
```

## What to watch out for

- **Counters reset on restart.** They live in the app process, not in PostgreSQL. Use `rate()` or `increase()` so restarts are handled gracefully.
- **One target per replica.** Counters are per process. Scrape each instance separately; don't aggregate them behind a load balancer.
- **Health gauges need traffic.** `pay_db_up`, `pay_wallet_rpc_up`, and the height gauges are updated when `GET /api/health` is called. The health endpoint returns JSON, not Prometheus text, so don't point a scrape job at it. Call it from an uptime check or a small cron job instead, for example once a minute:
    ```bash
    curl -fsS https://pay.example.com/api/health > /dev/null
    ```

- **Background work still needs a scheduler.** Prometheus observes payment state but doesn't advance it. Keep the `POST /api/cron/payment-links` and `POST /api/cron/webhooks` calls running.

## Next step

Add a dashboard in [Grafana](grafana.md) using the included dashboard JSON.
