---
icon: lucide/heart-pulse
---

# Health

`GET /api/health` is public, uncached, and reports both dependency reachability and wallet sync progress.

```bash
curl -fsS https://pay.example.com/api/health
```

## Response

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
  "services": {
    "db": true,
    "walletRpc": true,
    "daemon": true
  },
  "sync": {
    "walletHeight": 3401234,
    "daemonHeight": 3401235,
    "syncLag": 1,
    "status": "synced"
  }
}
```

## Fields

### Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | string | `ok` or `degraded`. |
| `network` | string | `mainnet` or `stagenet`, from `MONERO_NETWORK`. |
| `accessMode` | string | `clearnet`, `tor`, or `i2p`. |

### `remoteNode`

| Field | Meaning |
| --- | --- |
| `configured` | Whether `MONERO_DAEMON_ADDRESS` is set. |
| `mode` | `full-scan` in a valid production configuration. |
| `proxy` | `socks5` when `MONERO_DAEMON_PROXY` is set, otherwise `none`. |
| `viewKeySentToDaemon` | Always `false`. |
| `lightWallet` | Always `false`. |

### `services`

| Field | Meaning |
| --- | --- |
| `db` | `SELECT 1` succeeded against PostgreSQL. |
| `walletRpc` | `get_version` succeeded against `monero-wallet-rpc`. |
| `daemon` | A daemon height was returned by the primary or a fallback node. |

If the wallet RPC is unreachable, wallet and daemon heights are reported as `0` and sync is `unavailable`.

### `sync`

| Field | Meaning |
| --- | --- |
| `walletHeight` | Height of the loaded watch-only wallet. |
| `daemonHeight` | Height from the node. |
| `syncLag` | `max(0, daemonHeight - walletHeight)`. |
| `status` | `synced`, `syncing` when lag exceeds `HEALTH_MAX_SYNC_LAG_BLOCKS`, or `unavailable`. |

## Status codes

| Code | When |
| --- | --- |
| `200` | Database, wallet RPC, and daemon are all reachable. |
| `503` | At least one dependency is unreachable. |

A `syncing` wallet does not change the HTTP status as long as the dependencies answer; watch `sync.status` and `pay_wallet_sync_lag_blocks` for that.

## Side effects

Every health check updates the gauges `pay_db_up`, `pay_wallet_rpc_up`, `pay_daemon_up`, `pay_wallet_height`, `pay_daemon_height`, and `pay_wallet_sync_lag_blocks`. Polling the endpoint keeps those values fresh.

See [Monitoring](../guides/monitoring.md) for alert rules built on these fields.
