---
icon: lucide/package
---

# Installation

Ribaunt Pay is designed to be deployed with Docker Compose. Everything that needs to be installed on the host is Docker itself; the app, database, and wallet RPC all come from images.

## Requirements

| Requirement | Notes |
| --- | --- |
| Docker Engine + Compose plugin | Both Linux and macOS are supported. The Compose file uses profiles, so you need a reasonably recent Compose version. |
| A Monero node | `monerod` is **not** bundled. Use a node you control, or one you trust. Mainnet and stagenet are supported. |
| A watch-only wallet | You need its primary address and private view key. Spend keys are not used. |
| ~1 GB free disk | PostgreSQL data, wallet files, and images. Backups need more. |

For local development without Docker you also need **Node.js 24+** (the test runner uses module mocks that need it) and Python only if you want to preview these docs.

## Install Docker

=== "Linux"

    Follow the [official Docker Engine installation guide](https://docs.docker.com/engine/install/) for your distribution, then add your user to the `docker` group so you can run Compose without `sudo`.

    ```bash
    docker --version
    docker compose version
    ```

=== "macOS"

    Install [Docker Desktop](https://docs.docker.com/desktop/install/mac-install/) and start it. Then check both commands:

    ```bash
    docker --version
    docker compose version
    ```

## Get the source

```bash
git clone https://github.com/ribaunt/pay.git
cd pay
cp .env.example .env
chmod 600 .env
```

Fill in the secrets before starting. The container environment is strict in production: missing or short values cause a startup error rather than a silently insecure deployment. See [Configuration](configuration.md).

## Choose a Compose profile

Profiles select which services come up. Set `COMPOSE_PROFILES` in `.env`, or pass `--profile` on the command line.

| Profile | Ports exposed on the host | Use it for |
| --- | --- | --- |
| `prod` | `3000` (app), `5432` (Postgres) | Normal deployment. Wallet RPC stays internal. |
| `dev` | `3001` (hot reload), `5433` (DB), `18083` (wallet RPC) | Local development. |
| `prod,tor` | Same as `prod`, plus an onion service | Clearnet and Tor at the same time. |
| `tor-only` | None | Onion-only deployment with no clearnet ports. |
| `i2p-only` | None | I2P-only deployment with no clearnet ports. |

!!! note "Ports are a convenience, not a requirement"
    You can close the Postgres port in production by removing its `ports` entry from `docker-compose.yml`. The app talks to the database over the internal network.

## Run the stack

```bash
docker compose up --build
```

For development:

```bash
COMPOSE_PROFILES=dev docker compose up -d --build
npm run seed
APP_URL=http://localhost:3001 npm run test:integration
```

The first build downloads and verifies the official Monero CLI release for `monero-wallet-rpc`. The Dockerfile pins the release hash, checks it against the GPG-signed hash list, and deletes every binary except `monero-wallet-rpc`.

## Verify the installation

```bash
curl http://localhost:3000/api/health
```

You are looking for `status: ok`. A `degraded` response means one of Postgres, wallet RPC, or the daemon is unreachable. The [health reference](../api/health.md) lists every field.

## Stop and clean up

```bash
docker compose down        # keep data volumes
docker compose down -v     # delete data volumes — this removes the database and wallet files
```

!!! danger "`-v` is destructive"
    `docker compose down -v` deletes the PostgreSQL and wallet volumes. Take a [backup](../guides/backups.md) first if the data matters.

## Building these docs locally

The documentation site uses [Zensical](https://zensical.org/). It is independent of the app:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install zensical==0.1.2
zensical serve
```

The preview opens at `http://localhost:8000`. `zensical build --strict` validates links and configuration, which is what CI uses.
