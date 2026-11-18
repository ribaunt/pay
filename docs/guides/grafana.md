---
icon: lucide/layout-dashboard
---

# Grafana

Grafana turns the metrics scraped by [Prometheus](prometheus.md) into a dashboard for payments, wallet sync, and webhook delivery.

## Add the Prometheus data source

In the Grafana UI, go to **Connections → Data sources → Add new data source**, choose **Prometheus**, and set the URL to your Prometheus server, for example `http://prometheus:9090`. Save and test the connection.

To provision it instead, drop this into Grafana's provisioning directory:

```yaml
# /etc/grafana/provisioning/datasources/prometheus.yml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

Provisioned data sources can't be edited in the UI, so keep the file under version control.

## Import the dashboard

Download the ready-made [dashboard JSON](../assets/grafana-dashboard.json), then in Grafana choose **Dashboards → New → Import** and upload the file. Select your Prometheus data source when prompted.

To provision it automatically, put the JSON in a directory Grafana can read and add a dashboard provider:

```yaml
# /etc/grafana/provisioning/dashboards/ribaunt-pay.yml
apiVersion: 1

providers:
  - name: ribaunt-pay
    orgId: 1
    folder: Ribaunt Pay
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    options:
      path: /var/lib/grafana/dashboards
```

The dashboard includes:

| Panel | Query |
| --- | --- |
| Database up | `pay_db_up` |
| Wallet RPC up | `pay_wallet_rpc_up` |
| Daemon up | `pay_daemon_up` |
| Sync lag | `pay_wallet_sync_lag_blocks` |
| Links created | `rate(pay_payment_links_created_total[5m]) * 60` |
| Status transitions | `sum by (status) (rate(pay_payment_status_transitions_total[5m]))` |
| Webhook deliveries | `sum by (event) (rate(pay_webhook_deliveries_total[5m]))` and delivered/failed rates |
| Price sources | `pay_price_sources_healthy` |

## Build your own panels

The same queries work in Explore or in a new panel. A few that are useful day to day:

```promql
# Confirmed payments in the last 24 hours
increase(pay_payment_status_transitions_total{status="confirmed"}[24h])

# Share of successful webhook deliveries
sum(rate(pay_webhook_delivered_total[15m]))
  / sum(rate(pay_webhook_deliveries_total[15m]))

# Whether the wallet is falling behind
pay_wallet_sync_lag_blocks > 10
```

!!! tip "Use rates for counters"
    Counter values reset whenever the app restarts. A `rate()` or `increase()` over a window gives a meaningful number across restarts; a raw counter doesn't.

## Alerting

You can alert in Grafana instead of Prometheus. Create a rule from any panel with a Prometheus query, set a condition such as `IS BELOW 1` for `pay_wallet_rpc_up`, and choose a contact point.

Pick one place for alerting. Running both the included [Prometheus rules](prometheus.md#load-the-alert-rules) and Grafana rules for the same condition will send duplicate notifications.

## Access control

Ribaunt Pay metrics include counts and status labels, not customer identities, but they still reveal business activity. Keep the Prometheus and Grafana endpoints behind your VPN or an authenticated proxy, and give the scrape job its own `metrics:read` API key rather than reusing an admin key.
