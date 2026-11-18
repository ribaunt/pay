---
icon: lucide/map
---

# Guides

Task-focused walkthroughs for running Ribaunt Pay day to day. Each guide assumes you already have a working stack — if not, begin with the [quickstart](../getting-started/quickstart.md).

<div class="grid cards" markdown>

-   :lucide-container:{ .lg .middle } __Docker deployment__

    ---

    Profiles, ports, volumes, and putting a TLS reverse proxy in front.

    [Open guide](docker-deployment.md)

-   :lucide-eye:{ .lg .middle } __Watch-only wallet__

    ---

    Import a view key, choose a restore height, and manage subaddresses.

    [Open guide](watch-only-wallet.md)

-   :lucide-link:{ .lg .middle } __Payment links__

    ---

    Create links, poll status, cancel, renew, and understand settlement.

    [Open guide](payment-links.md)

-   :lucide-stamp:{ .lg .middle } __Payment proofs__

    ---

    Generate a proof from the recipient wallet and verify it publicly.

    [Open guide](payment-proofs.md)

-   :lucide-webhook:{ .lg .middle } __Webhooks__

    ---

    Register endpoints, verify signatures, and handle retries.

    [Open guide](webhooks.md)

-   :lucide-key-round:{ .lg .middle } __API keys__

    ---

    Scopes, the bootstrap key, and revocation.

    [Open guide](api-keys.md)

-   :lucide-archive:{ .lg .middle } __Backups__

    ---

    Encrypted database and wallet backups, and how to restore them.

    [Open guide](backups.md)

-   :lucide-shield:{ .lg .middle } __Tor and I2P__

    ---

    Onion-only, I2P-only, and clearnet-plus-Tor deployments.

    [Open guide](tor-and-i2p.md)

-   :lucide-activity:{ .lg .middle } __Monitoring__

    ---

    Health checks, Prometheus metrics, and alert rules.

    [Open guide](monitoring.md)

-   :lucide-code:{ .lg .middle } __Development__

    ---

    Local dev mode, tests, migrations, and CI checks.

    [Open guide](development.md)

</div>

## Where the guides fit

The [how-it-works section](../architecture/index.md) explains the design and the data model. The [API section](../api/index.md) documents each endpoint and its response shape. These guides sit between the two: they show what to call and why.
