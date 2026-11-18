---
icon: lucide/activity
---

# Monitoring

Ribaunt Pay exposes a health endpoint and a Prometheus metrics endpoint. No external monitoring service is bundled.

For a full setup, see the [Prometheus](prometheus.md) and [Grafana](grafana.md) guides.

## Health

```bash
curl -fsS https://pay.example.com/api/health
```

The endpoint is public and returns `200` when everything is reachable, `503` when it's not.

```json
{
  "status": "ok",
  "network": "mainnet",
  "accessMode": "clearnet",
  "remoteNode": {
    "configured": true,
    "mode": "full-scan",
    "proxy": "none",
    "viewKeySentToDaemon": false,
    "lightWallet": false
  },
  "services": { "db": true, "walletRpc": true, "daemon": true },
  "sync": {
    "walletHeight": 3401234,
    "daemonHeight": 3401234,
    "syncLag": 0,
    "status": "synced"
  }
}
```

| Field | Meaning |
| --- | --- |
| `status` | `ok` only when database, wallet RPC, and daemon are all reachable. |
| `network` | Active Monero network. |
| `accessMode` | `clearnet`, `tor`, or `i2p`. |
| `remoteNode.configured` | Whether `MONERO_DAEMON_ADDRESS` is set. |
| `remoteNode.mode` | Always `full-scan` in production. |
| `remoteNode.proxy` | `socks5` when `MONERO_DAEMON_PROXY` is set, otherwise `none`. |
| `remoteNode.viewKeySentToDaemon` | Always `false`; a visible assertion of the privacy model. |
| `services` | Reachability of each dependency. |
| `sync.status` | `synced`, `syncing` (lag above `HEALTH_MAX_SYNC_LAG_BLOCKS`), or `unavailable`. |

Every call also updates gauges such as `pay_db_up` and `pay_wallet_sync_lag_blocks`, so scraping the health endpoint keeps the metrics fresh.

## Metrics

`GET /api/metrics` returns Prometheus text format. It requires a session or an API key with `metrics:read`.

```bash
curl https://pay.example.com/api/metrics \
  -H "x-api-key: $PAYMENT_API_KEY"
```

| Metric | Type | Meaning |
| --- | --- | --- |
| `pay_db_up` | gauge | Database reachable. |
| `pay_wallet_rpc_up` | gauge | Wallet RPC reachable. |
| `pay_daemon_up` | gauge | Monero daemon reachable. |
| `pay_wallet_height` | gauge | Wallet scan height. |
| `pay_daemon_height` | gauge | Daemon height. |
| `pay_wallet_sync_lag_blocks` | gauge | Difference between the two heights. |
| `pay_payment_links_created_total` | counter | Links created. |
| `pay_payment_status_transitions_total{status="..."}` | counter | Status changes by destination status. |
| `pay_price_sources_healthy` | gauge | Number of responding XMR price sources. |
| `pay_webhook_deliveries_total{event="..."}` | counter | Events queued. |
| `pay_webhook_delivered_total{event="..."}` | counter | Successful deliveries. |
| `pay_webhook_failures_total{event="..."}` | counter | Failed attempts. |
| `pay_settlement_errors_total` | counter | Settlement runs that failed. |
| `pay_rate_limit_hits_total{route="..."}` | counter | Rejected requests by route. |

!!! note "Process-local counters"
    Counters and gauges live in the app process, not in PostgreSQL. They reset on restart and are per replica. Scrape each instance if you run more than one.

## Alert rules

Ready-made Prometheus rules are in [`alerts/payment.yml`](https://github.com/ribaunt/pay/blob/main/alerts/payment.yml):

| Alert | Condition |
| --- | --- |
| `PayDatabaseDown` | `pay_db_up == 0` for 1 minute. |
| `PayWalletRpcDown` | `pay_wallet_rpc_up == 0` for 1 minute. |
| `PayDaemonDown` | `pay_daemon_up == 0` for 2 minutes. |
| `PayWalletSyncLagHigh` | Lag above 10 blocks for 5 minutes. |
| `PayPriceSourcesDegraded` | Fewer than two healthy price sources for 5 minutes. |
| `PayWebhookFailures` | Failure rate above 0.1/s for 5 minutes. |
| `PaySettlementErrors` | Any settlement error in 10 minutes. |
| `PayRateLimitHits` | More than one rejected request per second for 5 minutes. |

Load the file into Prometheus via `rule_files`, or adapt the expressions for your alerting system.

## Things worth watching

- **Settlement heartbeat.** If `POST /api/cron/payment-links` stops running, links stay `pending` forever even though customers have paid. Alert on the absence of status transitions, not just on errors.
- **Sync lag.** A wallet that's far behind the daemon can miss recent transfers.
- **Webhook dead letters.** Deliveries that reach six attempts are marked `dead` and need manual replay or inspection.
- **Price degradation.** Fewer than two sources means quotes are less trustworthy; links still get created with a locked rate.
