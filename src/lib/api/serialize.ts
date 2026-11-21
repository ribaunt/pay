import { atomicToXmr } from "@/lib/monero/money";
import { getPaymentConfig } from "@/lib/config";

/**
 * Canonical wire shapes for payment data.
 *
 * Every amount is exposed as a pair: `<name>Xmr` (decimal string) and
 * `<name>Atomic` (piconero integer string). Every rate uses the `rate*`
 * prefix, every transaction id is `txHash`, and every timestamp is an ISO
 * string or null. API responses and webhook payloads both build from here so
 * the two surfaces cannot drift apart.
 */

export type PaymentRecordLike = {
  id: string;
  storeId?: string | null;
  address?: string | null;
  uri?: string | null;
  amount: string;
  receivedAtomic?: string | null;
  status: string;
  label?: string | null;
  fiatAmount?: string | null;
  fiatCurrency?: string | null;
  rateUsd?: string | null;
  fxRate?: string | null;
  rateSources?: string | null;
  rateFetchedAt?: Date | string | null;
  rateStale?: boolean;
  rateDegraded?: boolean;
  requiredConfirmations?: number | null;
  confirmations?: number;
  zeroConf?: boolean;
  txHash?: string | null;
  createdAt?: Date | string | null;
  expiresAt?: Date | string | null;
  paidAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  lateDetectedAt?: Date | string | null;
};

function iso(value?: Date | string | null): string | null {
  if (value === null || value === undefined || value === "") return null;
  return value instanceof Date ? value.toISOString() : value;
}

function atomic(value: string | bigint | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return BigInt(value).toString();
}

/** Amount pair used by every response surface. */
export function amountPair(value: string | bigint | number) {
  const amountAtomic = atomic(value)!;
  return { amountXmr: atomicToXmr(amountAtomic), amountAtomic };
}

/** Received pair used by every response surface (nullable before detection). */
export function receivedPair(value?: string | bigint | number | null) {
  const receivedAtomic = atomic(value);
  return {
    receivedXmr: receivedAtomic === null ? null : atomicToXmr(receivedAtomic),
    receivedAtomic,
  };
}

/** Coverage fields shared by API views and webhook payloads. */
function coverageFields(record: PaymentRecordLike, required: number, confirmations: number) {
  const expected = BigInt(atomic(record.amount) ?? "0");
  const received = BigInt(atomic(record.receivedAtomic) ?? "0");
  const covered = received > expected ? expected : received;
  const zeroConf = record.zeroConf ?? false;
  const complete = received >= expected;
  const unlocked = complete && (zeroConf || confirmations >= required) ? covered : 0n;

  return {
    zeroConf,
    coveredXmr: atomicToXmr(covered),
    coveredAtomic: covered.toString(),
    unlockedXmr: atomicToXmr(unlocked),
    unlockedAtomic: unlocked.toString(),
    complete,
  };
}

function rateFields(record: PaymentRecordLike) {
  return {
    rateUsd: record.rateUsd ?? null,
    fxRate: record.fxRate ?? null,
    rateSources: record.rateSources ?? null,
    rateFetchedAt: iso(record.rateFetchedAt),
    rateStale: record.rateStale ?? false,
    rateDegraded: record.rateDegraded ?? false,
  };
}

/** Canonical payment-link view shared by create, renew, list and status. */
export function paymentLinkView(record: PaymentRecordLike) {
  const required = record.requiredConfirmations ?? getPaymentConfig().requiredConfirmations;
  const confirmations = record.confirmations ?? 0;

  return {
    id: record.id,
    status: record.status,
    storeId: record.storeId ?? null,
    address: record.address ?? null,
    uri: record.uri ?? null,
    label: record.label ?? null,
    ...amountPair(record.amount),
    ...receivedPair(record.receivedAtomic),
    ...coverageFields(record, required, confirmations),
    fiatAmount: record.fiatAmount ?? null,
    fiatCurrency: record.fiatCurrency ?? null,
    ...rateFields(record),
    requiredConfirmations: required,
    confirmations,
    confirmationsRemaining: Math.max(0, required - confirmations),
    txHash: record.txHash ?? null,
    createdAt: iso(record.createdAt),
    expiresAt: iso(record.expiresAt),
    paidAt: iso(record.paidAt),
    cancelledAt: iso(record.cancelledAt),
    lateDetectedAt: iso(record.lateDetectedAt),
  };
}

/** Canonical webhook `data` payload shared by every payment event. */
export function paymentEventData(
  record: PaymentRecordLike,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: record.id,
    status: record.status,
    storeId: record.storeId ?? null,
    address: record.address ?? null,
    ...amountPair(record.amount),
    ...receivedPair(record.receivedAtomic),
    ...coverageFields(
      record,
      record.requiredConfirmations ?? getPaymentConfig().requiredConfirmations,
      record.confirmations ?? 0
    ),
    fiatAmount: record.fiatAmount ?? null,
    fiatCurrency: record.fiatCurrency ?? null,
    txHash: record.txHash ?? null,
    confirmations: record.confirmations ?? 0,
    expiresAt: iso(record.expiresAt),
    paidAt: iso(record.paidAt),
    ...overrides,
  };
}
