---
icon: lucide/circle-dollar-sign
---

# Monero concepts

A short glossary of the Monero ideas that show up in Ribaunt Pay's configuration and API.

## Atomic units

Monero amounts are integers of **piconero**. One XMR is `1_000_000_000_000` piconero. The app stores amounts as strings containing piconero and converts them with `BigInt`, so no floating-point rounding occurs.

```text
0.01 XMR  = 10000000000 piconero
1 XMR     = 1000000000000 piconero
```

XMR amounts in API requests accept at most 12 decimal places. Before an amount is sent to JSON-RPC, the app checks it is within JavaScript's safe integer range so precision is never silently lost in transit.

## Primary address and subaddress

A primary address identifies the wallet itself and starts with `4` on mainnet or `5` on stagenet. A subaddress is a derived receiving address that starts with `8` on mainnet or `7` on stagenet.

Ribaunt Pay generates a fresh subaddress for every payment link. Two payments to the same wallet therefore use two different addresses, which prevents casual linking by address. Settlement marks a subaddress `used` once a transfer is seen, and you can list all of them through `GET /api/wallet/subaddresses`.

| Network | Primary | Subaddress |
| --- | --- | --- |
| `mainnet` | `4...` | `8...` |
| `stagenet` | `5...` | `7...` |

All addresses must be 95 characters. The app rejects addresses from the wrong network before creating a wallet.

## Private view key

The private view key lets a wallet recognize incoming outputs and their amounts. A private **spend** key is required to move funds. Ribaunt Pay asks only for the view key and the primary address, so it can watch and prove payments but cannot spend them.

The view key is encrypted with AES-256-GCM before being written to PostgreSQL and is never returned by an API. It is still sensitive: anyone who has it can read your incoming transaction history.

## Restore height

The restore height is the block where the wallet was created. It tells the wallet RPC where to begin scanning. Supplying an accurate height makes setup fast; `0` scans from genesis and can take hours on an active wallet.

## Confirmations

A transaction is first seen in the mempool, then included in a block. Each block added after that increases the confirmation count. Ribaunt Pay computes it as `walletHeight - blockHeight + 1`.

A link becomes `confirmed` when confirmations reach its required value — 10 by default, or a per-link override between 1 and 100. More confirmations mean a lower chance of a chain reorganization undoing the payment.

## Remote node modes

A **full-scan** wallet downloads and scans the blockchain locally using the view key. A light wallet would upload the view key to a remote daemon. Ribaunt Pay requires `MONERO_DAEMON_MODE=full-scan` in production, and health reports `viewKeySentToDaemon: false`.

`MONERO_DAEMON_PROXY` routes daemon traffic through a SOCKS proxy such as Tor. `MONERO_DAEMON_FALLBACKS` lists extra daemons for the health check.

## Transaction proofs

A transaction proof is a signature generated with the recipient's view key. It demonstrates that a specific transaction paid a specific address. Ribaunt Pay can generate proofs from the watch-only wallet and verify them for anyone via `POST /api/public/payment-proofs/verify`, with no account required.

The proof covers the transaction hash, address, and an optional message. Verification also reports the confirmations and amount received.
