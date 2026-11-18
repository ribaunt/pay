---
icon: lucide/braces
---

# Types

These types describe the JSON bodies used by the API. They are written in TypeScript notation for readability. The service itself is TypeScript, and the source of truth is [`src/lib`](https://github.com/ribaunt/pay/tree/main/src/lib).

## Payment links

### `CreateLinkInput`

```ts
type CreateLinkInput = {
  fiatAmount?: string;          // decimal, up to 12 fractional digits
  fiatCurrency?: string;        // required with fiatAmount, e.g. "USD"
  amountXmr?: string;           // decimal XMR, up to 12 fractional digits
  timeoutSeconds?: number;      // 0 = no expiry
  requiredConfirmations?: number; // 1–100
  label?: string;               // max 200 chars
  description?: string;
};
```

### `CreateLinkResponse`

Returned as `{ "link": CreateLinkResponse }` with status `201`.

```ts
type CreateLinkResponse = {
  id: string;
  uri: string;                  // monero: URI
  address: string;              // fresh subaddress
  amountXmr: string;
  amountAtomic: string;         // piconero
  fiatAmount: string | null;
  fiatCurrency: string | null;
  rateUsd: string | null;
  rateSources: string | null;
  requiredConfirmations: number | null;
  status: "pending";
  expiresAt: string | null;     // ISO 8601
  statusUrl: string;            // path, not absolute
  statusToken: string;          // base64url, shown once
};
```

### `PaymentLinkStatus`

```ts
type PaymentLinkStatus = {
  id: string;
  status: LinkStatus;
  amountXmr: string;
  amountAtomic: string;
  fiatAmount: string | null;
  fiatCurrency: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  lateDetectedAt: string | null;
  txHash: string | null;
  confirmations: number;
  receivedAtomic: string | null;
  receivedXmr: string | null;
  requiredConfirmations: number;
  confirmationsRemaining: number;
};

type LinkStatus =
  | "pending" | "detected" | "confirming" | "confirmed"
  | "underpaid" | "overpaid" | "expired" | "late" | "cancelled";
```

## Wallet types

```ts
type WalletInfo = {
  name: string;                 // wallet filename
  address: string;              // primary address
  balanceXmr: string;
  unlockedBalanceXmr: string;
  blocksToUnlock: number;
};

type Subaddress = {
  address: string;
  addressIndex: number;
  label?: string;
  used?: boolean;
  lastUsedAt?: Date | null;
};

type PaymentRequest = {
  address: string;
  addressIndex: number;
  amountXmr: string;
  amountAtomic: string;
  uri: string;
  label?: string;
};

type NormalizedTransfer = {
  txid: string;
  type: string;                 // in, out, pending, failed, pool
  amountXmr: string;
  feeXmr?: string;
  timestamp: string;            // ISO 8601
  blockHeight: number;
  address?: string;
  paymentId?: string;
};

type PaymentProof = {
  txHash: string;
  address: string;
  message: string;
  signature: string;
};

type PaymentProofVerification = {
  good: boolean;
  confirmations: number;
  inPool: boolean;
  receivedXmr: string;
};
```

## Pricing

```ts
type PriceQuote = {
  currency: string;
  usdPerXmr: number;
  fiatPerUsd: number;
  sources: string[];
  fetchedAt: string;
  stale: boolean;
  degraded: boolean;
};

type QuoteResponse = {
  fiatAmount: string;
  fiatCurrency: string;
  amountXmr: string;
  amountAtomic: string;
  usdPerXmr: number;
  fiatPerUsd: number;
  sources: string[];
  stale: boolean;
  degraded: boolean;
  fetchedAt: string;
};
```

## Authentication

```ts
type ApiKeyRecord = {
  id: string;
  name: string;
  scopes: string;               // comma-separated or "*"
};

type SessionPayload = {
  userId: string;
  expiresAt: number;            // epoch milliseconds
  sessionVersion: number;
};

type UserView = {
  id: string;
  email: string | null;
  name: string | null;
};
```

## Webhooks

```ts
type WebhookEvent =
  | "payment.created" | "payment.detected" | "payment.confirming"
  | "payment.confirmed" | "payment.underpaid" | "payment.overpaid"
  | "payment.expired" | "payment.cancelled" | "payment.late"
  | "payment.renewed";

type WebhookPayload = {
  event: WebhookEvent;
  createdAt: string;
  data: Record<string, unknown>;  // usually id, txHash, confirmations, receivedAtomic
};

type WebhookRegistration = {
  id: string;
  url: string;
  events: string;
  secret: string;               // returned only at registration
};
```

## Health and errors

```ts
type HealthResponse = {
  status: "ok" | "degraded";
  network: "mainnet" | "stagenet";
  accessMode: "clearnet" | "tor" | "i2p";
  remoteNode: {
    configured: boolean;
    mode: "full-scan";
    proxy: "socks5" | "none";
    viewKeySentToDaemon: false;
    lightWallet: false;
  };
  services: { db: boolean; walletRpc: boolean; daemon: boolean };
  sync: {
    walletHeight: number;
    daemonHeight: number;
    syncLag: number;
    status: "synced" | "syncing" | "unavailable";
  };
};

type ApiError = { error: string };
```

## Raw RPC types

Internal types used by `src/lib/monero/types.ts`. They aren't exposed directly by the HTTP API, but they explain field names in wallet responses.

```ts
type AddressResult = {
  address: string;
  info: string;
  addresses: Array<{
    address: string; label: string; address_index: number; used: boolean;
  }>;
};

type BalanceResult = {
  balance: number; unlocked_balance: number;
  blocks_to_unlock: number; time_to_unlock: number;
  multisig_import_needed: boolean;
};

type GetTransfersResult = {
  in?: TransferEntry[]; out?: TransferEntry[];
  pending?: TransferEntry[]; failed?: TransferEntry[]; pool?: TransferEntry[];
};
```
