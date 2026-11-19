---
icon: lucide/rocket
---

# Get started

This section takes you from a fresh machine to a working payment server.

The fastest path is the [quickstart](quickstart.md). If you want to understand each piece before you run it, start with [installation](installation.md) and then [configuration](configuration.md).

<div class="grid cards" markdown>

-   :lucide-list-checks:{ .lg .middle } __Quickstart__

    ---

    Copy the example environment file, fill in the secrets, and bring the stack up.

    [Read it](quickstart.md)

-   :lucide-package:{ .lg .middle } __Installation__

    ---

    Docker, Python tooling, and the pieces that make up the stack.

    [Read it](installation.md)

-   :lucide-sliders-horizontal:{ .lg .middle } __Configuration__

    ---

    Every environment variable, what it controls, and which ones are mandatory.

    [Read it](configuration.md)

</div>

## Before you begin

You need three things:

1. **Docker with the Compose plugin.** The app image, the wallet RPC image, and PostgreSQL all run as containers.
2. **A Monero node you control or trust.** The stack doesn't ship `monerod`; scanning happens locally in watch-only mode.
3. **A wallet's primary address and private view key.** You don't need the spend key, and you should never provide it.

!!! warning "Use a dedicated wallet"
    Point Ribaunt Pay at a wallet used for receiving payments. The server creates subaddresses and stores payment metadata; keeping your personal spending wallet separate makes bookkeeping and privacy easier.

## The shape of the setup

```text
.env  →  docker compose  →  app :3000
                         →  wallet-rpc :18082 (internal only)
                         →  postgres :5432
```

Set the wallet address and view key in `.env` before starting; the container imports the watch-only wallet on first boot. There is no web UI — creating links, watching payments, and delivering webhooks are all done through the API.
