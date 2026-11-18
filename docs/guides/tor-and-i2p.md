---
icon: lucide/shield
---

# Tor and I2P

Ribaunt Pay can run without publishing any clearnet ports. The Compose file provides an onion-only stack, an I2P-only stack, and an optional onion service alongside the normal production stack.

## Add Tor to a clearnet deployment

```bash
docker compose --profile tor up -d
sh scripts/onion-address.sh
```

This starts a Tor container pointing at the app. It does **not** publish a SOCKS proxy. The hostname is persisted in the `tor_data` volume, so it stays the same across restarts.

Equivalently, set `COMPOSE_PROFILES=prod,tor` in `.env` and run `docker compose up -d`.

## Onion-only

```bash
COMPOSE_PROFILES=tor-only docker compose up -d
sh scripts/onion-address.sh
```

The `tor-only` profile starts its own app, database, wallet RPC, and Tor service with **no clearnet ports**. `GET /api/health` reports `accessMode: tor`.

## I2P-only

```bash
COMPOSE_PROFILES=i2p-only docker compose up -d
sh scripts/i2p-address.sh
```

This starts an `i2pd` container with a tunnel configured in `i2pd/tunnels.conf`, again with no clearnet ports. Health reports `accessMode: i2p`.

!!! note "Separate data volumes"
    Each privacy profile uses its own database and wallet volumes (`postgres_data_onion`, `wallet_data_onion`, `postgres_data_i2p`, `wallet_data_i2p`). Switching profiles doesn't reuse the clearnet wallet. Import your view key again, or copy and restore the data deliberately.

## Route the Monero daemon through Tor

Set a SOCKS proxy for daemon connections:

```dotenv
MONERO_DAEMON_PROXY=127.0.0.1:9050
MONERO_DAEMON_ADDRESS=your-node.example.com:18081
```

`MONERO_DAEMON_PROXY` controls traffic from the app to the daemon. Health reports it as `proxy: socks5`. The view key is never sent to the daemon in any mode, and `MONERO_DAEMON_MODE` must be `full-scan`.

If the proxy runs in the same Compose network, use its service name and port instead of `127.0.0.1`.

## Fallback daemons

```dotenv
MONERO_DAEMON_FALLBACKS=node2.example.com:18081,node3.example.com:18081
```

The health check tries the primary address first, then each fallback in order. All of them are checked with a 5-second timeout.

## Verification

```bash
curl -fsS http://localhost:3000/api/health
```

Onion-only and I2P-only stacks have no localhost port. Run the health request from another container on the same Compose network, or through the onion/I2P address.

Check that `remoteNode.viewKeySentToDaemon` is `false` and `lightWallet` is `false`. Those fields exist to make a privacy regression obvious at a glance.
