---
icon: lucide/book-open
---

# Reference

Lookup material for the values, types, and limits you encounter while working with Ribaunt Pay.

<div class="grid cards" markdown>

-   :lucide-braces:{ .lg .middle } __Types__

    ---

    Request and response shapes used across the API, in TypeScript notation.

    [Open reference](types.md)

-   :lucide-sliders-horizontal:{ .lg .middle } __Environment variables__

    ---

    Every setting, its default, and which ones production validates.

    [Open reference](environment.md)

-   :lucide-circle-dollar-sign:{ .lg .middle } __Monero concepts__

    ---

    Atomic units, subaddresses, view keys, confirmations, and network prefixes.

    [Open reference](monero-concepts.md)

-   :lucide-triangle-alert:{ .lg .middle } __Errors and limits__

    ---

    Status codes, error messages, and per-route rate limits.

    [Open reference](errors-and-limits.md)

</div>

## Quick lookups

| Looking for… | Go to |
| --- | --- |
| The shape of a create-link response | [Types](types.md#createlinkresponse) |
| Which secret must be at least 32 characters | [Environment variables](environment.md#production-validation) |
| How many decimal places an XMR amount allows | [Monero concepts](monero-concepts.md#atomic-units) |
| Why a request returned `409` | [Errors and limits](errors-and-limits.md#status-codes) |
| What the database stores | [Data model](../architecture/data-model.md) |
