---
icon: lucide/package
---

# Installation

Ribaunt Pay is published as a container image. The normal install is two downloaded files and one Compose command; no source checkout or image build is required.

## Requirements

| Requirement | Notes |
| --- | --- |
| Docker Engine + Compose plugin | Both Linux and macOS are supported. |
| A Monero node | `monerod` is **not** bundled. Use a node you control, or one you trust. Mainnet and stagenet are supported. |
| A watch-only wallet | Its primary address, private view key, and optionally the restore height. Spend keys are never used. |
| ~1 GB free disk | PostgreSQL data, wallet files, and the image. Backups need more. |

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

## Install with the published image

Download the Compose file and the example environment file. Both are generated from the newest release, and the Compose file pins the matching image version.

```bash
curl -fsSL https://pay.ribaunt.com/compose.yml -o compose.yml
curl -fsSL https://pay.ribaunt.com/.env.example -o .env
chmod 600 .env
```

Edit `.env`. At minimum set:

| Variable | Purpose |
| --- | --- |
| `MONERO_DAEMON_ADDRESS` | `host:port` of your Monero node. Required. |
| `MONERO_NETWORK` | `mainnet` or `stagenet`. |
| `MONERO_WALLET_ADDRESS` | Primary address of the watch-only wallet. |
| `MONERO_WALLET_VIEW_KEY` | Its 64-character private view key. |
| `MONERO_WALLET_RESTORE_HEIGHT` | Block where the wallet was created; `0` scans from genesis. |

Secrets are generated on first boot inside the container and stored in the `pay-data` volume at `/data/config/.env`, so you do not need to invent them. Values already present in `.env` are used instead. See [Configuration](configuration.md) for every variable.

Start the stack:

```bash
docker compose up -d
```

On first boot the container creates its config, runs the database migrations, imports the wallet, starts settlement and webhook jobs, and prints the sign-in credentials once:

```bash
docker logs pay
```

## Verify the installation

```bash
curl http://localhost:3000/api/health
```

You are looking for `status: ok`. A `degraded` response means one of Postgres, wallet RPC, or the daemon is unreachable. The [health reference](../api/health.md) lists every field.

## Update

Set `PAY_VERSION` in `.env` to the release you want, then:

```bash
docker compose pull
docker compose up -d
```

Migrations run automatically on the next start. Back up the `pay-data` volume first; see [Backups](../guides/backups.md).

## Stop and clean up

```bash
docker compose down        # keep the pay-data volume
docker compose down -v     # delete the volume, including the database and wallet files
```

!!! danger "`-v` is destructive"
    `docker compose down -v` deletes the PostgreSQL database and wallet files. Take a backup first if the data matters.

## Advanced: running from source

Clone the repository and build the images locally when you need to change code, run the dev server, or use the Tor/I2P profiles:

```bash
git clone https://github.com/ribaunt/pay.git
cd pay
cp .env.example .env
chmod 600 .env
docker compose up --build
```

Profiles are selected with `COMPOSE_PROFILES` in `.env`:

| Profile | Ports exposed | Use it for |
| --- | --- | --- |
| `prod` | `3000`, `5432` | Normal source deployment. |
| `dev` | `3001`, `5433`, `18083` | Local development. |
| `prod,tor` | `3000`, `5432` plus onion | Clearnet and Tor. |
| `tor-only` | none | Onion-only. |
| `i2p-only` | none | I2P-only. |

Development requires **Node.js 24+** for the test runner. Python is only needed to preview these docs.

## Building these docs locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install zensical==0.1.2
zensical serve
```

The preview opens at `http://localhost:8000`. `zensical build --strict` validates links and configuration, which is what CI uses.
