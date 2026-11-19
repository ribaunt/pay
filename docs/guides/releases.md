---
icon: lucide/package
---

# Releases

Ribaunt Pay is published as signed, multi-architecture container images.

## Images

| Image | Purpose |
| --- | --- |
| `ghcr.io/ribaunt/pay` | All-in-one appliance: app, PostgreSQL, and `monero-wallet-rpc`. |
| `ghcr.io/ribaunt/pay-app` | Next.js app only, for modular Compose deployments. |
| `ghcr.io/ribaunt/pay-wallet-rpc` | Verified `monero-wallet-rpc` only. |

Each release tag publishes `vX.Y.Z`, `X.Y.Z`, and `latest` tags for `linux/amd64` and `linux/arm64`.

## Install with Compose

The docs site serves a Compose file pinned to the newest release and a matching environment template:

```bash
curl -fsSL https://pay.ribaunt.com/compose.yml -o compose.yml
curl -fsSL https://pay.ribaunt.com/.env.example -o .env
chmod 600 .env
docker compose up -d
```

## Install the appliance without Compose

```bash
curl -fsSL https://pay.ribaunt.com/install.sh | sh
```

The installer prompts for your Monero daemon address, creates the `pay-data` volume, pulls the image, and starts the container. First-run credentials are printed once to `docker logs pay`. It resolves the newest release automatically; set `PAY_VERSION` to pin a different version. This copy is published with the docs site on every release.

Manual install:

```bash
docker volume create pay-data
docker run -d --name pay --restart unless-stopped \
  -p 3000:3000 \
  -v pay-data:/data \
  -e MONERO_NETWORK=mainnet \
  -e MONERO_DAEMON_ADDRESS=your-node.example.com:18081 \
  ghcr.io/ribaunt/pay:latest
```

## What a release contains

- image digests
- SPDX SBOMs
- cosign signatures for images and SBOMs
- SLSA build provenance attestations
- `install.sh`
- `compose.yml`
- checksums

## Release process

Pushing a `v*` tag runs `.github/workflows/release.yml`:

1. Validate: tests, lint, build, audit, docs.
2. Build and push all three images for both architectures.
3. Sign images and SBOMs with keyless cosign.
4. Attest build provenance.
5. Create a GitHub Release with notes, assets, and digests.

The workflow can also be started manually with a `version` input.

!!! warning "Upgrades"
    Back up the `pay-data` volume before upgrading. Migrations run automatically on the next start.
