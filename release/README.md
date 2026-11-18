# Ribaunt Pay appliance

One image, one volume, one command.

## Install

```bash
curl -fsSL https://pay.ribaunt.com/install.sh | sh
```

Or with Docker Compose:

```bash
curl -O https://pay.ribaunt.com/compose.yml
MONERO_DAEMON_ADDRESS=your-node.example.com:18081 docker compose -f compose.yml up -d
```

## What is inside

- Next.js app on port 3000
- PostgreSQL 16 on loopback only
- verified `monero-wallet-rpc` on loopback only
- automatic migrations on first boot
- generated secrets in `/data/config/.env` (mode 600)

No `monerod` is bundled. Point `MONERO_DAEMON_ADDRESS` at a node you trust.

## First boot

Credentials are printed once to `docker logs pay` and stored in the config file. Change them there and restart if needed.

## Backup

```bash
docker run --rm -v pay-data:/data -v "$PWD":/backup alpine tar czf /backup/pay-data.tgz -C /data .
```

Encrypt the archive before storing it off-host.
