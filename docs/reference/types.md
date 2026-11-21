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

### `PaymentLink`

One canonical shape is used by every payment-link surface: create, renew,
list, status, the audit report, and `POST /api/wallet/payment-requests`.
Create and renew wrap it as `{ "link": PaymentLink & CreatedLink }`; status and
list return it directly. Fields that don't apply yet are `null`.

```ts
type PaymentLink = {
  id: string;
  status: LinkStatus;
  address: string | null;
  uri: string | null;           // monero: URI
  label: string | null;

  amountXmr: string;            // decimal XMR
  amountAtomic: string;         // piconero
  receivedXmr: string | null;
  receivedAtomic: string | null;

  fiatAmount: string | null;
  fiatCurrency: string | null;
  rateUsd: string | null;
  fxRate: string | null;
  rateSources: string | null;   // comma-separated
  rateFetchedAt: string | null; // ISO 8601
  rateStale: boolean;
  rateDegraded: boolean;

  requiredConfirmations: number;
  confirmations: number;
  confirmationsRemaining: number;
  txHash: string | null;

  createdAt: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  lateDetectedAt: string | null;
};

type CreatedLink = PaymentLink & {
  statusUrl: string;            // path, not absolute
  statusToken: string;          // base64url, shown once
};

type LinkStatus =
  | "pending" | "detected" | "confirming" | "confirmed"
  | "underpaid" | "overpaid" | "expired" | "late" | "cancelled";
```

Webhook `data` uses the same vocabulary — `status`, both amount pairs,
`txHash`, `fiatAmount`, `fiatCurrency`, `confirmations`, `expiresAt`, `paidAt` —
plus `fromId` on `payment.renewed`. There is no `txid` field anywhere on the wire.

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
  receivedAtomic: string;
};
```

## Pricing

```ts
type PriceQuote = {
  currency: string;
  usdPerXmr: number;    // internal oracle value
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
  rateUsd: string;        // same rate* vocabulary as PaymentLink
  fxRate: string;
  rateSources: string;    // comma-separated
  rateFetchedAt: string;
  rateStale: boolean;
  rateDegraded: boolean;
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
  // Canonical payment fields: status, address, both amount pairs, fiatAmount,
  // fiatCurrency, txHash, confirmations, expiresAt, paidAt. payment.renewed
  // also carries fromId.
  data: Record<string, unknown>;
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
