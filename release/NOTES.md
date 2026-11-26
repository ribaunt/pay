## Highlights for v0.9.0

This release hardens payments and completes the client libraries. Read the behavior changes before upgrading an existing deployment.

### Behavior changes

- Underpaid links now reach a terminal state at their deadline: they become `expired` when no transfer has been seen, or `late` when a partial transfer exists. They no longer remain `underpaid` forever or occupy a settlement slot indefinitely.
- An expired link can be renewed only once. Repeat or concurrent renewal requests return `409`. This is enforced by a new unique index on `renewedFromId`.
- Single-link event streams are limited to 10 new connections per minute per status token; API-key/session streams and all other routes keep their existing limits. Excess stream starts receive `429` with `Retry-After`.
- `429` responses on every rate-limited route now include `Retry-After` in seconds.

### Fixes

- Store-scoped API keys can no longer cancel or renew another store's link; those requests now return `404`.
- Webhook event lists are validated and normalized; a name with a space after the comma no longer silently disables a subscription, and unknown names return `400`.
- Settlement passes are serialized with a Postgres advisory lock. Overlapping cron calls return `{"processed": 0, "skipped": true}` rather than emitting duplicate events or rewinding the scan cursor.
- A wallet-RPC height failure fails the settlement pass instead of writing a zero-confirmation regression.
- Multiple outputs of one Monero transaction are summed correctly instead of being deduplicated down to one amount.
- The modular wallet-RPC image now gives the `monero` user a writable home, so its ring database can be created.

### Clients and docs

- The TypeScript and Python clients now cover cancel/renew, webhooks, proof verification, currencies, audit, metrics, SSE streams with header tokens, idempotency keys, retries, and offline signature verification.
- `public/openapi.json` describes the full HTTP API, including session-authenticated endpoints and the header-based status token.
- Documentation reflects all of the above.

### Upgrading

Migrations run on startup. Before upgrading an existing database, check for duplicate renewal chains that would block the new unique index:

```sql
SELECT "renewedFromId", COUNT(*)
FROM "PaymentRequest"
WHERE "renewedFromId" IS NOT NULL
GROUP BY 1 HAVING COUNT(*) > 1;
```

If any rows are returned, keep the intended renewal and clear `renewedFromId` on the others before deploying. Fresh installations are unaffected.

For a privacy-preserving deployment, point `MONERO_DAEMON_ADDRESS` at your own node (or use `MONERO_DAEMON_PROXY`) instead of a public daemon.
