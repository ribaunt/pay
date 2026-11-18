---
icon: lucide/eye
---

# Watch-only wallet

Ribaunt Pay never holds spend keys. It restores a wallet from your **primary address** and **private view key**, then uses that wallet to generate subaddresses and watch incoming transactions.

## What a view key can do

A private view key lets the wallet see incoming outputs and their amounts. It can't spend them. That's why Ribaunt Pay can detect payments and produce proofs without ever being able to move funds.

!!! warning "Treat the view key as sensitive"
    It doesn't allow spending, but it does expose your transaction history to anyone who has it. Store it in `.env`-grade secrecy and never paste it into a public issue or chat.

## Set up through the UI

1. Sign in at `/login` with the credentials from `.env`.
2. Open `/setup`.
3. Enter the primary address, the 64-character hex view key, and a restore height.
4. Submit. The page shows the watch-only address when the wallet is ready.

The equivalent API call is:

```bash
curl -X POST http://localhost:3000/api/wallet/setup \
  -H 'content-type: application/json' \
  -b 'pay_session=<session-token>' \
  -d '{
    "address": "4...",
    "viewKey": "<64 hex characters>",
    "restoreHeight": 3200000,
    "description": "Storefront"
  }'
```

### Choosing a restore height

The restore height is the block where the wallet was created. It tells the RPC where to start scanning. A value of `0` scans from genesis and can take a very long time. If you don't know the exact height, use an earlier block that you know is safe. Scanning extra blocks is harmless, just slower.

The restore height is passed to Monero when the watch-only wallet is created. The app does not call `rescan_blockchain` afterwards: that call blocks `monero-wallet-rpc` for minutes and makes the app unresponsive. If Monero does not honour the height, the wallet continues from its current height.

### Network rules

Addresses are checked against `MONERO_NETWORK`:

| Network | Primary address | Subaddress |
| --- | --- | --- |
| `mainnet` | starts with `4` | starts with `8` |
| `stagenet` | starts with `5` | starts with `7` |

Addresses must be 95 characters long. A mismatched address or view key is rejected after the generated wallet is reopened for validation; no wallet files are kept and no database record is saved.

## What gets stored

`setupWatchOnlyWallet` creates a wallet file on the `wallet_data` volume named from a hash of the address and view key. In PostgreSQL it stores the primary address, restore height, and the **encrypted** view key (`v1.<iv>.<tag>.<ciphertext>` using AES-256-GCM). No endpoint returns the stored view key.

Because `monero-wallet-rpc` serves one open wallet at a time, the app serializes open/close operations and tracks which file is loaded. If the wrong `MONERO_WALLET_PASSWORD` is used later, the error says so explicitly.

## Subaddresses

Every payment link gets a fresh subaddress so incoming payments can't be linked to one another by address.

=== "List subaddresses"

    ```bash
    curl http://localhost:3000/api/wallet/subaddresses \
      -b 'pay_session=<session-token>'
    ```

    The list is reconciled with the RPC on each call, so `used` and `lastUsedAt` reflect what the wallet has seen.

=== "Create one manually"

    ```bash
    curl -X POST http://localhost:3000/api/wallet/subaddresses \
      -H 'content-type: application/json' \
      -b 'pay_session=<session-token>' \
      -d '{"label": "Invoice 1042"}'
    ```

Used subaddresses are also detected during settlement and marked in Postgres.

## Reading the wallet

| Endpoint | What it returns |
| --- | --- |
| `GET /api/wallet` | Wallet name, primary address, total and unlocked balance, blocks to unlock. |
| `GET /api/wallet/balance` | Just the balance fields. |
| `GET /api/wallet/address` | The primary address. |
| `GET /api/wallet/transfers` | Normalized transfers, filterable by `incoming`, `outgoing`, `pending`, `failed`, `pool`. |
| `GET /api/wallet/audit?format=json\|csv` | View-key-only accounting export; never includes keys. |

Amounts are strings in XMR. Internally they are `bigint` piconero values (1 XMR = 1,000,000,000,000 piconero), so no floating-point rounding happens.

## Closing the wallet

`POST /api/wallet/close` closes the loaded wallet in the RPC. The next operation reopens it automatically, so this is mainly useful when you want to release the RPC for another process.

See the [Wallet API reference](../api/wallet.md) for request and response shapes.
